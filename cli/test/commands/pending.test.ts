import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";
import { observePipelineRuns } from "../../src/lib/observer.js";

describe("lineup pending", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-pending-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists only blocked runs", () => {
    const blocked: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "pending-1",
      status: "blocked",
      workflow: "workflows/full.yaml",
      current_stage: "plan-approval",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    const running: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "pending-2",
      status: "running",
      workflow: "workflows/full.yaml",
      current_stage: "implement",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("pending-1", tempDir), { recursive: true });
    mkdirSync(lineupRunDir("pending-2", tempDir), { recursive: true });
    savePipelineState(blocked, tempDir);
    savePipelineState(running, tempDir);

    const runs = observePipelineRuns(tempDir);
    const blockedRuns = runs.filter((r) => r.status === "blocked");

    expect(blockedRuns).toHaveLength(1);
    expect(blockedRuns[0].run_id).toBe("pending-1");
  });

  it("no blocked runs returns empty array", () => {
    const running: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "pending-3",
      status: "running",
      workflow: "workflows/full.yaml",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("pending-3", tempDir), { recursive: true });
    savePipelineState(running, tempDir);

    const runs = observePipelineRuns(tempDir);
    const blockedRuns = runs.filter((r) => r.status === "blocked");

    expect(blockedRuns).toHaveLength(0);
  });

  it("json output structure matches expected shape", () => {
    const blocked: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "pending-4",
      status: "blocked",
      workflow: "workflows/full.yaml",
      current_stage: "plan-approval",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("pending-4", tempDir), { recursive: true });
    savePipelineState(blocked, tempDir);

    const runs = observePipelineRuns(tempDir);
    const blockedRuns = runs.filter((r) => r.status === "blocked");

    const jsonOutput = blockedRuns.map((r) => ({
      run_id: r.run_id,
      workflow: r.workflow,
      current_stage: r.current_stage,
      updated_at: r.updated_at,
    }));

    expect(jsonOutput).toHaveLength(1);
    expect(jsonOutput[0]).toHaveProperty("run_id");
    expect(jsonOutput[0]).toHaveProperty("workflow");
    expect(jsonOutput[0]).toHaveProperty("current_stage");
    expect(jsonOutput[0]).toHaveProperty("updated_at");
  });
});
