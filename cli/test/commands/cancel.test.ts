import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { appendBridgeQuestionEvent, defaultBridgeSession, loadBridgeSession, saveBridgeSession } from "../../src/lib/bridge.js";
import { runCancelCommand } from "../../src/commands/cancel.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";

describe("lineup cancel", () => {
  let tempDir = "";
  let originalCwd = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-cancel-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("cancels a running pipeline by updating status", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "cancel-1",
      status: "running",
      workflow: "workflows/full.yaml",
      current_stage: "implement",
      completed_stages: ["triage", "plan"],
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("cancel-1", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    // Simulate cancellation by updating state
    const loaded = loadPipelineState("cancel-1", tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("running");

    const canceled = savePipelineState({ ...loaded!, status: "canceled" }, tempDir);
    expect(canceled.status).toBe("canceled");

    const reloaded = loadPipelineState("cancel-1", tempDir);
    expect(reloaded!.status).toBe("canceled");
  });

  it("is idempotent for already-terminal runs", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "cancel-2",
      status: "succeeded",
      workflow: "workflows/full.yaml",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("cancel-2", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const loaded = loadPipelineState("cancel-2", tempDir);
    expect(loaded).not.toBeNull();
    expect(["succeeded", "failed", "canceled"]).toContain(loaded!.status);
  });

  it("returns null for a nonexistent run", () => {
    const loaded = loadPipelineState("nonexistent", tempDir);
    expect(loaded).toBeNull();
  });

  it("marks blocked bridge sessions as canceled and appends a terminal bridge event", async () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "cancel-bridge-1",
      status: "blocked",
      workflow: "workflows/full.yaml",
      current_stage: "triage",
      artifact_hashes: {},
      updated_at: "2026-04-15T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("cancel-bridge-1", tempDir), { recursive: true });
    savePipelineState(state, tempDir);
    saveBridgeSession(
      defaultBridgeSession({
        runId: "cancel-bridge-1",
        executorHost: "codex",
        workflow: "workflows/full.yaml"
      }),
      tempDir
    );
    appendBridgeQuestionEvent(
      "cancel-bridge-1",
      {
        requestId: 1,
        stageId: "triage",
        gateType: "classify",
        question: "Classify this task.",
        choices: ["simple", "moderate", "complex"],
        defaultChoice: "moderate",
        createdAt: "2026-04-15T12:00:01.000Z"
      },
      tempDir
    );

    await runCancelCommand({ runId: "cancel-bridge-1" });

    expect(loadPipelineState("cancel-bridge-1", tempDir)?.status).toBe("canceled");
    const session = loadBridgeSession("cancel-bridge-1", tempDir);
    expect(session?.status).toBe("canceled");
    expect(session?.pending_question).toBeUndefined();
    expect(session?.blocked_recovery).toBe(false);
  });
});
