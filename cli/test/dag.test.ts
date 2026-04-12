import { describe, expect, it } from "vitest";

import { buildTaskWaves, compilePlanToTasks, type ApprovedPlan } from "../src/lib/dag.js";
import { validateTasksJson } from "../src/lib/validation.js";

function makePlan(overrides: Partial<ApprovedPlan> = {}): ApprovedPlan {
  return {
    apiVersion: "lineup/v3",
    kind: "Plan",
    status: "approved",
    summary: "Compile the approved plan",
    approaches: [
      {
        name: "native",
        strategy: "Compile plan changes into deterministic task waves",
      },
    ],
    recommendation: {
      approach: "native",
      rationale: "Matches the native engine direction",
    },
    changes: [
      {
        file: "src/app.ts",
        change: "Update the app entrypoint",
        rationale: "Needed for the feature",
      },
      {
        file: "src/lib.ts",
        change: "Refactor shared library logic",
        rationale: "Needed for the feature",
      },
      {
        file: "src/app.ts",
        change: "Apply a follow-up app update",
        rationale: "Depends on the library refactor",
      },
    ],
    acceptance_criteria: [
      {
        criterion: "Task graph is deterministic",
      },
    ],
    risks: [
      {
        risk: "Wave drift",
        mitigation: "Use a deterministic scheduler",
      },
    ],
    ...overrides,
  };
}

describe("compilePlanToTasks", () => {
  it("produces a stable artifact for identical approved plan input", () => {
    const plan = makePlan();
    const first = compilePlanToTasks(plan, {
      compiledAt: "2026-04-12T00:00:00.000Z",
      gitTreeSha: "abc123",
      planHash: "plan-hash",
    });
    const second = compilePlanToTasks(plan, {
      compiledAt: "2026-04-12T00:00:00.000Z",
      gitTreeSha: "abc123",
      planHash: "plan-hash",
    });

    expect(first).toEqual(second);
    expect(first.artifact.tasks).toHaveLength(3);
    expect(first.artifact.tasks.map((task) => task.id)).toEqual(["CHANGE-001", "CHANGE-002", "CHANGE-003"]);
    expect(first.waves).toEqual([["CHANGE-001", "CHANGE-002"], ["CHANGE-003"]]);
    expect(() => validateTasksJson(first.artifact, "fixture/tasks.json")).not.toThrow();
  });

  it("separates overlapping write scopes into later waves", () => {
    const plan = makePlan({
      changes: [
        {
          file: "src/lib",
          change: "Update the library folder",
          rationale: "Prepare the shared surface",
        },
        {
          file: "src/lib/utils.ts",
          change: "Update the nested utility file",
          rationale: "Touches the same subtree",
        },
        {
          file: "src/other.ts",
          change: "Update a disjoint file",
          rationale: "Independent change",
        },
      ],
      dependencies: [],
    });

    const { artifact, waves } = compilePlanToTasks(plan, {
      compiledAt: "2026-04-12T00:00:00.000Z",
    });

    expect(waves).toEqual([["CHANGE-001", "CHANGE-003"], ["CHANGE-002"]]);
    expect(buildTaskWaves(artifact.tasks)).toEqual(waves);
  });

  it("preserves dependency order and source-order tiebreakers", () => {
    const plan = makePlan({
      dependencies: [
        {
          from_change: 3,
          to_change: 1,
          description: "Follow-up work depends on the initial app update",
        },
      ],
    });

    const { waves } = compilePlanToTasks(plan, {
      compiledAt: "2026-04-12T00:00:00.000Z",
    });

    expect(waves).toEqual([["CHANGE-001", "CHANGE-002"], ["CHANGE-003"]]);
  });

  it("fails on dependency cycles with a stable error", () => {
    const plan = makePlan({
      dependencies: [
        {
          from_change: 1,
          to_change: 2,
          description: "Second change depends on the first",
        },
        {
          from_change: 2,
          to_change: 1,
          description: "First change depends on the second",
        },
      ],
    });

    expect(() =>
      compilePlanToTasks(plan, {
        compiledAt: "2026-04-12T00:00:00.000Z",
      })
    ).toThrow(/cycle/i);
  });
});
