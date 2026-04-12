import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";
import { observePipelineRuns } from "../../src/lib/observer.js";

describe("lineup runs", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-runs-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedRun(runId: string, status: string, workflow: string): void {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: runId,
      status: status as PipelineStateRecord["status"],
      workflow,
      completed_stages: ["triage"],
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z"
    };
    mkdirSync(lineupRunDir(runId, tempDir), { recursive: true });
    savePipelineState(state, tempDir);
  }

  it("returns all runs sorted by updated_at", () => {
    seedRun("run-1", "succeeded", "workflows/full.yaml");
    seedRun("run-2", "failed", "workflows/full.yaml");

    const runs = observePipelineRuns(tempDir);
    expect(runs.length).toBe(2);
    expect(runs.map((r) => r.run_id)).toContain("run-1");
    expect(runs.map((r) => r.run_id)).toContain("run-2");
  });

  it("filters by status", () => {
    seedRun("run-a", "succeeded", "workflows/full.yaml");
    seedRun("run-b", "failed", "workflows/full.yaml");

    const runs = observePipelineRuns(tempDir).filter((r) => r.status === "failed");
    expect(runs.length).toBe(1);
    expect(runs[0].run_id).toBe("run-b");
  });

  it("returns empty when no runs dir", () => {
    const runs = observePipelineRuns(join(tempDir, "nonexistent"));
    expect(runs).toEqual([]);
  });
});
