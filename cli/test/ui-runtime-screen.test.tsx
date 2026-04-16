import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeDashboard, getLayoutMode } from "../src/lib/ui/runtime-screen.js";
import type { PipelineStateRecord } from "../src/lib/state.js";
import type { WorkflowDefinition } from "../src/lib/types.js";

const workflow: WorkflowDefinition = {
  apiVersion: "lineup/v3",
  kind: "Workflow",
  name: "full-pipeline",
  stages: [
    {
      id: "triage",
      type: "builtin",
      description: "Classify the task."
    },
    {
      id: "plan",
      type: "agent",
      agent: "architect",
      description: "Produce the implementation plan."
    }
  ]
};

function createState(): PipelineStateRecord {
  return {
    apiVersion: "lineup/v3",
    kind: "PipelineState",
    run_id: "runtime-tui",
    status: "running",
    workflow: "workflows/full.yaml",
    execution_host: "codex",
    runner_host: "codex",
    current_stage: "plan",
    completed_stages: ["triage"],
    stage_state: {
      triage: {
        status: "succeeded",
        started_at: "2026-04-12T10:00:00.000Z",
        updated_at: "2026-04-12T10:00:05.000Z",
        finished_at: "2026-04-12T10:00:05.000Z",
        last_message: "Triage complete."
      },
      plan: {
        status: "running",
        started_at: "2026-04-12T10:00:06.000Z",
        updated_at: "2026-04-12T10:00:10.000Z",
        last_message: "Planning in progress.",
        attempt: 1,
        max_attempts: 2
      }
    },
    pending_gate: {
      request_id: "9",
      stage_id: "plan",
      gate_type: "approval",
      question: "Approve the generated plan?",
      choices: ["approve", "reject"],
      default_choice: "approve",
      created_at: "2026-04-12T10:00:10.000Z",
      expires_at: "2026-04-12T10:05:10.000Z"
    },
    artifact_hashes: {
      plan: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd"
    },
    updated_at: "2026-04-12T10:00:10.000Z",
    started_at: "2026-04-12T10:00:00.000Z"
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
}

describe("runtime TUI screens", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes human-mode timers without new stage events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T10:00:10.000Z"));

    const app = render(
      <RuntimeDashboard
        surface="human"
        state={createState()}
        summary={{
          statusLine: "status: running",
          workflowLine: "workflow: workflows/full.yaml",
          stageLine: "current_stage: plan",
          completedLine: "completed_stages: triage (1)",
          timingLines: [],
          taskLines: [],
          changeLines: [],
          nextLines: [],
          artifactLines: []
        }}
        workflow={workflow}
        viewportSize={{ columns: 120 }}
      />
    );

    await flush();
    expect(app.lastFrame()).toContain("elapsed: 10s");
    expect(app.lastFrame()).toContain("4s");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(app.lastFrame()).toContain("elapsed: 12s");
    expect(app.lastFrame()).toContain("6s");

    app.unmount();
  });

  it("refreshes watch-mode dashboards and keeps pending actions visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T10:00:10.000Z"));

    const app = render(
      <RuntimeDashboard
        surface="watch"
        state={createState()}
        summary={{
          statusLine: "status: running",
          workflowLine: "workflow: workflows/full.yaml",
          stageLine: "current_stage: plan",
          completedLine: "completed_stages: triage (1)",
          timingLines: [],
          taskLines: [],
          changeLines: ["completed stages: triage", "artifacts created: plan"],
          nextLines: ["watch progress with `lineup show runtime-tui --watch`", "inspect plan with `lineup artifacts show plan --run runtime-tui`"],
          artifactLines: ["plan: abc123abc123  lineup artifacts show plan --run runtime-tui"]
        }}
        viewportSize={{ columns: 96 }}
      />
    );

    await flush();
    expect(app.lastFrame()).toContain("Pending Question");
    expect(app.lastFrame()).toContain("Changes");
    expect(app.lastFrame()).toContain("Artifacts");
    expect(app.lastFrame()).toContain("Next Actions");
    expect(app.lastFrame()).toContain("elapsed: 10s");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(app.lastFrame()).toContain("elapsed: 13s");

    app.unmount();
  });

  it("switches to compact layouts for narrow terminals", () => {
    expect(getLayoutMode(70)).toBe("compact");
    expect(getLayoutMode(100)).toBe("stacked");
    expect(getLayoutMode(140)).toBe("wide");
  });
});
