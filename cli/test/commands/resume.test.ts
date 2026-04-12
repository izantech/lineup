import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";

describe("lineup resume", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-resume-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads a failed run and verifies it is resumable", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-1",
      status: "failed",
      workflow: "workflows/full.yaml",
      git_tree_sha: "abc123",
      current_stage: "implement",
      completed_stages: ["triage", "plan", "plan-approval"],
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("resume-1", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const loaded = loadPipelineState("resume-1", tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("failed");
    expect(["failed", "blocked", "canceled"]).toContain(loaded!.status);
    expect(loaded!.current_stage).toBe("implement");
  });

  it("rejects a succeeded run as non-resumable", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-2",
      status: "succeeded",
      workflow: "workflows/full.yaml",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("resume-2", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const loaded = loadPipelineState("resume-2", tempDir);
    expect(loaded).not.toBeNull();
    expect(["failed", "blocked", "canceled"]).not.toContain(loaded!.status);
  });

  it("returns null for a nonexistent run", () => {
    const loaded = loadPipelineState("nonexistent", tempDir);
    expect(loaded).toBeNull();
  });
});
