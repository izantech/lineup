import { describe, expect, it } from "vitest";

import { tacticToWorkflow } from "../src/lib/tactic-convert.js";
import type { TacticDefinition } from "../src/lib/tactic-convert.js";

describe("tacticToWorkflow", () => {
  it("basic conversion: stages get correct IDs, types, agents, and sequential depends_on", () => {
    const tactic: TacticDefinition = {
      name: "basic",
      stages: [
        { type: "clarify" },
        { type: "plan" },
        { type: "implement" },
        { type: "verify" },
      ],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.name).toBe("basic");
    expect(workflow.stages).toHaveLength(4);

    const [s0, s1, s2, s3] = workflow.stages;
    expect(s0.id).toBe("clarify");
    expect(s0.type).toBe("builtin");
    expect(s0.depends_on).toEqual([]);

    expect(s1.id).toBe("plan");
    expect(s1.type).toBe("agent");
    expect(s1.agent).toBe("architect");
    expect(s1.depends_on).toEqual(["clarify"]);

    expect(s2.id).toBe("implement");
    expect(s2.agent).toBe("developer");
    expect(s2.depends_on).toEqual(["plan"]);

    expect(s3.id).toBe("verify");
    expect(s3.agent).toBe("reviewer");
    expect(s3.depends_on).toEqual(["implement"]);
  });

  it("gate insertion: approval stage injected after gated stage with correct depends_on", () => {
    const tactic: TacticDefinition = {
      name: "with-gate",
      stages: [
        { type: "plan", gate: "approval" },
        { type: "implement" },
      ],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.stages).toHaveLength(3);
    const [plan, approval, implement] = workflow.stages;

    expect(plan.id).toBe("plan");
    expect(approval.id).toBe("plan-approval");
    expect(approval.type).toBe("approval");
    expect(approval.depends_on).toEqual(["plan"]);

    expect(implement.depends_on).toEqual(["plan-approval"]);
  });

  it("optional stages: optional flag is propagated", () => {
    const tactic: TacticDefinition = {
      name: "optional-test",
      stages: [
        { type: "research", optional: true },
      ],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.stages[0].optional).toBe(true);
  });

  it("verification auto-append: verify stage appended when verification array present but no verify stage", () => {
    const tactic: TacticDefinition = {
      name: "auto-verify",
      stages: [{ type: "implement" }],
      verification: ["all tests pass", "no lint errors"],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.stages).toHaveLength(2);
    const verifyStage = workflow.stages[1];
    expect(verifyStage.id).toBe("verify");
    expect(verifyStage.type).toBe("agent");
    expect(verifyStage.agent).toBe("reviewer");
    expect(verifyStage.depends_on).toEqual(["implement"]);
    expect(verifyStage.description).toContain("all tests pass");
    expect(verifyStage.description).toContain("no lint errors");
  });

  it("duplicate ID resolution: two stages of the same type get unique IDs", () => {
    const tactic: TacticDefinition = {
      name: "dup-ids",
      stages: [
        { type: "plan" },
        { type: "plan" },
      ],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.stages).toHaveLength(2);
    expect(workflow.stages[0].id).toBe("plan");
    expect(workflow.stages[1].id).toBe("plan-2");
  });

  it("unknown type error: throws for unrecognized stage type", () => {
    const tactic: TacticDefinition = {
      name: "bad-type",
      stages: [{ type: "bogus" }],
    };

    expect(() => tacticToWorkflow(tactic)).toThrow("Unknown tactic stage type: bogus");
  });

  it("variables passthrough: variables appear in workflow output", () => {
    const tactic: TacticDefinition = {
      name: "vars-test",
      stages: [{ type: "clarify" }],
      variables: [
        { name: "target", description: "The target system", default: "prod" },
        { name: "scope" },
      ],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.variables).toHaveLength(2);
    const [v0, v1] = workflow.variables!;
    expect(v0.name).toBe("target");
    expect(v0.description).toBe("The target system");
    expect(v0.default).toBe("prod");

    expect(v1.name).toBe("scope");
    expect(v1.required).toBe(true);
  });

  it("infers sequential inputs from prior research outputs for explain stages", () => {
    const tactic: TacticDefinition = {
      name: "explain",
      stages: [
        { type: "research" },
        { type: "explain" },
      ],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.stages).toHaveLength(2);
    expect(workflow.stages[1].inputs).toEqual([
      {
        source: "research",
        fields: ["what_found", "how_it_works", "constraints", "gaps"]
      }
    ]);
  });

  it("preserves research outputs as the input source across inserted approval gates", () => {
    const tactic: TacticDefinition = {
      name: "research-gated",
      stages: [
        { type: "research", gate: "approval" },
        { type: "plan" },
      ],
    };

    const workflow = tacticToWorkflow(tactic);

    expect(workflow.stages).toHaveLength(3);
    expect(workflow.stages[2].depends_on).toEqual(["research-approval"]);
    expect(workflow.stages[2].inputs).toEqual([
      {
        source: "research",
        fields: ["what_found", "how_it_works", "constraints", "gaps"]
      }
    ]);
  });
});
