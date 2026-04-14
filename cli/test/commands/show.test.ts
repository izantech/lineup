import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lineupRunDir } from "../../src/lib/paths.js";
import { createArtifactStore } from "../../src/lib/artifact-store.js";
import type { CompiledTasksArtifact } from "../../src/lib/dag.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";
import { runShowCommand } from "../../src/commands/show.js";

describe("lineup show", () => {
  let tempDir = "";
  const originalCwd = process.cwd();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-show-test-"));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
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

    it("exits with guidance for blocked runs", async () => {
      vi.useFakeTimers();

      const blockedState: PipelineStateRecord = {
        apiVersion: "lineup/v3",
        kind: "PipelineState",
        run_id: "watch-run-blocked",
        status: "blocked",
        workflow: "workflows/full.yaml",
        git_tree_sha: "abc123",
        current_stage: "gate",
        completed_stages: ["triage", "plan"],
        artifact_hashes: { plan: "abc" },
        updated_at: new Date().toISOString(),
      };

      vi.spyOn(await import("../../src/lib/state.js"), "loadPipelineState").mockReturnValue(blockedState);
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runShowCommand({ runId: "watch-run-blocked", watch: true });

      const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("status: blocked");
      expect(output).toContain("what changed in this run?");
      expect(output).toContain("completed stages: triage, plan");
      expect(output).toContain("next:");
      expect(output).toContain("resume with `lineup resume watch-run-blocked`");
      expect(output).toContain("Next step: run `lineup resume watch-run-blocked`");
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

  it("prints task, change, and next-step summaries in text mode", async () => {
    const previousState: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "show-run-prev",
      status: "failed",
      workflow: "workflows/full.yaml",
      git_tree_sha: "prevtree",
      completed_stages: ["triage"],
      artifact_hashes: {
        plan: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      updated_at: "2026-04-12T11:00:00.000Z",
      started_at: "2026-04-12T10:59:00.000Z",
      finished_at: "2026-04-12T11:00:00.000Z",
      duration_ms: 60000
    };

    const tasksArtifact: CompiledTasksArtifact = {
      apiVersion: "lineup/v3",
      kind: "Tasks",
      plan_hash: "plan-hash-1",
      compiled_at: "2026-04-12T12:00:00.000Z",
      tasks: [
        {
          id: "CHANGE-001",
          title: "Update CLI summary",
          wave: 1,
          status: "todo",
          write_scope: ["cli/src/commands/show.ts"]
        },
        {
          id: "CHANGE-002",
          title: "Refresh inspection tests",
          wave: 1,
          status: "todo",
          write_scope: ["cli/test/commands/show.test.ts"]
        },
        {
          id: "CHANGE-003",
          title: "Refresh commands docs",
          wave: 2,
          status: "todo",
          depends_on: ["CHANGE-001"],
          read_scope: ["cli/src/commands/show.ts"],
          write_scope: ["docs/commands.md"]
        }
      ]
    };

    const store = createArtifactStore(join(tempDir, ".lineup", ".artifacts"));
    const tasksRecord = store.persistJson("tasks", tasksArtifact);

    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "show-run-summary",
      status: "running",
      workflow: "workflows/full.yaml",
      git_tree_sha: "abc123def456",
      current_stage: "verify",
      completed_stages: ["triage", "plan"],
      artifact_hashes: {
        plan: "deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
        tasks: tasksRecord.sha256
      },
      updated_at: "2026-04-12T12:00:00.000Z",
      started_at: "2026-04-12T11:55:00.000Z",
      duration_ms: 300000
    };

    mkdirSync(lineupRunDir(previousState.run_id, tempDir), { recursive: true });
    savePipelineState(previousState, tempDir);
    mkdirSync(lineupRunDir(state.run_id, tempDir), { recursive: true });
    savePipelineState(state, tempDir);
    process.chdir(tempDir);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runShowCommand({ runId: "show-run-summary", cwd: tempDir });

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("current_stage: verify");
    expect(output).toContain("completed_stages: triage, plan (2)");
    expect(output).toContain("task_summary:");
    expect(output).toContain("3 tasks across 2 waves");
    expect(output).toContain("wave 1: Update CLI summary | Refresh inspection tests");
    expect(output).toContain("what changed in this run?");
    expect(output).toContain("artifacts changed vs run show-run-prev: plan");
    expect(output).toContain("artifacts added vs run show-run-prev: tasks");
    expect(output).toContain("next:");
    expect(output).toContain("inspect task waves with `lineup waves --run show-run-summary`");
    expect(output).toContain("compare plan with `lineup artifacts diff plan --from show-run-prev --to show-run-summary`");
    expect(output).toContain("artifacts:");
    expect(output).toContain("lineup artifacts show tasks --run show-run-summary");
    writeSpy.mockRestore();
  });
});
