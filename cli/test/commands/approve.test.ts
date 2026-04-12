import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";

describe("lineup approve", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-approve-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("approving a blocked run transitions to running", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "approve-1",
      status: "blocked",
      workflow: "workflows/full.yaml",
      current_stage: "plan-approval",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("approve-1", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const loaded = loadPipelineState("approve-1", tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("blocked");

    const approved = savePipelineState({
      ...loaded!,
      status: "running",
      approval: {
        approved_at: new Date().toISOString(),
        approved_by: "cli",
      },
    }, tempDir);

    expect(approved.status).toBe("running");
    expect(approved.approval).toBeDefined();
    expect(approved.approval!.approved_by).toBe("cli");
  });

  it("approving a non-blocked run reports appropriate status", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "approve-2",
      status: "running",
      workflow: "workflows/full.yaml",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("approve-2", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const loaded = loadPipelineState("approve-2", tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).not.toBe("blocked");
  });

  it("missing run errors gracefully", () => {
    const loaded = loadPipelineState("nonexistent", tempDir);
    expect(loaded).toBeNull();
  });

  it("approval metadata is persisted", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "approve-3",
      status: "blocked",
      workflow: "workflows/full.yaml",
      current_stage: "plan-approval",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z",
    };

    mkdirSync(lineupRunDir("approve-3", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const approvedAt = "2026-04-12T13:00:00.000Z";
    savePipelineState({
      ...state,
      status: "running",
      approval: {
        approved_at: approvedAt,
        approved_by: "cli",
      },
    }, tempDir);

    const reloaded = loadPipelineState("approve-3", tempDir);
    expect(reloaded!.approval).toBeDefined();
    expect(reloaded!.approval!.approved_at).toBeDefined();
    expect(reloaded!.approval!.approved_by).toBe("cli");
  });
});
