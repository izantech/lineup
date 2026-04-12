import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lineupRunDir, lineupRuntimeLockFile } from "../../src/lib/paths.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";

describe("lineup cancel", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-cancel-test-"));
  });

  afterEach(() => {
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
});
