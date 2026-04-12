import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";

describe("lineup show", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-show-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads pipeline state by run id", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "show-run-1",
      status: "succeeded",
      workflow: "workflows/full.yaml",
      git_tree_sha: "abc123def456",
      current_stage: "verify",
      completed_stages: ["triage", "plan"],
      artifact_hashes: { plan: "deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678" },
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("show-run-1", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const loaded = loadPipelineState("show-run-1", tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe("show-run-1");
    expect(loaded!.status).toBe("succeeded");
    expect(loaded!.completed_stages).toEqual(["triage", "plan"]);
    expect(loaded!.artifact_hashes.plan).toBeDefined();
  });

  it("returns null for missing run", () => {
    const loaded = loadPipelineState("nonexistent", tempDir);
    expect(loaded).toBeNull();
  });
});
