import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";
import { runShowCommand } from "../../src/commands/show.js";

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

  describe("watch mode", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("exits after terminal status", async () => {
      vi.useFakeTimers();

      const runningState: PipelineStateRecord = {
        apiVersion: "lineup/v3",
        kind: "PipelineState",
        run_id: "watch-run-1",
        status: "running",
        workflow: "workflows/full.yaml",
        git_tree_sha: "abc123",
        current_stage: "plan",
        completed_stages: ["triage"],
        artifact_hashes: {},
        updated_at: new Date().toISOString(),
      };

      const succeededState: PipelineStateRecord = {
        ...runningState,
        status: "succeeded",
        current_stage: undefined,
        completed_stages: ["triage", "plan"],
      };

      let callCount = 0;
      vi.spyOn(await import("../../src/lib/state.js"), "loadPipelineState").mockImplementation(() => {
        callCount++;
        return callCount === 1 ? runningState : succeededState;
      });

      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const watchPromise = runShowCommand({ runId: "watch-run-1", watch: true });
      await vi.runAllTimersAsync();
      await watchPromise;

      expect(callCount).toBeGreaterThanOrEqual(2);
      writeSpy.mockRestore();
    });

    it("exits immediately if state is already terminal", async () => {
      vi.useFakeTimers();

      const doneState: PipelineStateRecord = {
        apiVersion: "lineup/v3",
        kind: "PipelineState",
        run_id: "watch-run-2",
        status: "failed",
        workflow: "workflows/full.yaml",
        git_tree_sha: "abc123",
        current_stage: undefined,
        completed_stages: [],
        artifact_hashes: {},
        updated_at: new Date().toISOString(),
      };

      vi.spyOn(await import("../../src/lib/state.js"), "loadPipelineState").mockImplementation(() => doneState);
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runShowCommand({ runId: "watch-run-2", watch: true });

      expect(writeSpy).toHaveBeenCalled();
      writeSpy.mockRestore();
    });
  });
});
