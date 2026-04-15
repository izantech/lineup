import { describe, expect, it } from "vitest";

import { detectTerminalCapabilities } from "../src/lib/ui/terminal.js";
import { renderPendingBridgeQuestionLines, renderWatchDashboard } from "../src/lib/ui/runtime.js";
import type { PipelineStateRecord } from "../src/lib/state.js";

describe("terminal UI helpers", () => {
  it("falls back to plain non-color ASCII-safe capabilities for non-tty streams", () => {
    const capabilities = detectTerminalCapabilities({ isTTY: false, columns: 0 } as NodeJS.WriteStream, {});

    expect(capabilities).toEqual({
      isTTY: false,
      supportsColor: false,
      supportsUnicode: false,
      width: 80
    });
  });

  it("renders watch dashboards without ANSI escapes for non-tty output", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "watch-ui",
      status: "blocked",
      workflow: "workflow.yaml",
      execution_host: "codex",
      runner_host: "codex",
      current_stage: "plan-approval",
      completed_stages: ["triage", "plan"],
      stage_state: {
        triage: {
          status: "succeeded",
          started_at: "2026-04-12T10:00:00.000Z",
          updated_at: "2026-04-12T10:00:10.000Z",
          finished_at: "2026-04-12T10:00:10.000Z",
          last_message: "Triage complete."
        },
        "plan-approval": {
          status: "blocked",
          started_at: "2026-04-12T10:01:00.000Z",
          updated_at: "2026-04-12T10:01:15.000Z",
          last_message: "Awaiting approval."
        }
      },
      pending_gate: {
        request_id: "7",
        stage_id: "plan-approval",
        gate_type: "approval",
        question: "Approve the generated plan?",
        choices: ["approve", "reject"],
        default_choice: "approve",
        created_at: "2026-04-12T10:01:00.000Z",
        expires_at: "2026-04-12T10:06:00.000Z"
      },
      artifact_hashes: {
        plan: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd"
      },
      updated_at: "2026-04-12T10:01:15.000Z",
      started_at: "2026-04-12T10:00:00.000Z"
    };

    const lines = renderWatchDashboard(state, process.cwd(), { isTTY: false, columns: 0 } as unknown as NodeJS.WriteStream);
    const output = lines.join("\n");

    expect(output).toContain("Pending Question");
    expect(output).toContain("command: lineup bridge answer watch-ui 7 --choice \"approve\"");
    expect(output).not.toContain("\u001B[");
  });

  it("renders pending bridge questions with answer guidance", () => {
    const lines = renderPendingBridgeQuestionLines(
      "bridge01",
      {
        requestId: 9,
        stageId: "clarify",
        gateType: "clarify",
        question: "What should this optimize for?",
        choices: ["speed", "quality"],
        defaultChoice: "quality",
        createdAt: "2026-04-12T11:00:00.000Z",
        expiresAt: "2026-04-12T11:05:00.000Z"
      },
      false,
      { isTTY: false, columns: 0 } as unknown as NodeJS.WriteStream
    );

    expect(lines.join("\n")).toContain("command: lineup bridge answer bridge01 9 --choice \"quality\"");
  });
});
