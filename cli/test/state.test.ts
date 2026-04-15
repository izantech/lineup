import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../src/lib/errors.js";
import {
  assertPipelineStateFresh,
  defaultPipelineState,
  isPipelineStateStale,
  loadPipelineState,
  markPipelineCurrentStage,
  pipelineStateFile,
  savePipelineState,
  updatePipelineArtifactHashes,
  appendPipelineCompletedStage
} from "../src/lib/state.js";
import { lineupArtifactStoreDir, lineupRunArtifactsDir, lineupRunDir, lineupRunStateFile, lineupRunsDir } from "../src/lib/paths.js";

describe("pipeline state", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-state-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes run-scoped state files and round-trips them", () => {
    const runId = "run-123";
    const workflowPath = "/repo/.lineup-core/workflows/full-pipeline.yaml";
    const state = defaultPipelineState({
      runId,
      workflow: workflowPath,
      taskPrompt: "Ship the dev runner",
      executionHost: "ollama",
      runnerHost: "codex",
      forceOllamaBackend: true,
      ollamaModel: "qwen3-coder:30b",
      gateTimeoutSeconds: 15,
      gitTreeSha: "tree-abc123"
    });

    expect(lineupRunsDir(tempDir)).toBe(join(tempDir, ".lineup", ".runs"));
    expect(lineupRunDir(runId, tempDir)).toBe(join(tempDir, ".lineup", ".runs", runId));
    expect(lineupRunArtifactsDir(runId, tempDir)).toBe(join(tempDir, ".lineup", ".runs", runId, "artifacts"));
    expect(lineupRunStateFile(runId, tempDir)).toBe(join(tempDir, ".lineup", ".runs", runId, "pipeline-state.json"));
    expect(lineupArtifactStoreDir(tempDir)).toBe(join(tempDir, ".lineup", ".artifacts"));

    const saved = savePipelineState(state, tempDir);
    const loaded = loadPipelineState(runId, tempDir);

    expect(saved.run_id).toBe(runId);
    expect(saved.workflow).toBe(workflowPath);
    expect(saved.task_prompt).toBe("Ship the dev runner");
    expect(saved.execution_host).toBe("ollama");
    expect(saved.runner_host).toBe("codex");
    expect(saved.force_ollama_backend).toBe(true);
    expect(saved.ollama_model).toBe("qwen3-coder:30b");
    expect(saved.gate_timeout_seconds).toBe(15);
    expect(saved.git_tree_sha).toBe("tree-abc123");
    expect(readFileSync(pipelineStateFile(runId, tempDir), "utf8")).toContain('"run_id": "run-123"');
    expect(loaded).toEqual(saved);
  });

  it("tracks artifact hashes and stale git trees", () => {
    const base = defaultPipelineState({
      runId: "run-456",
      workflow: "/repo/workflows/full-pipeline.yaml",
      gitTreeSha: "tree-1"
    });
    const withArtifacts = updatePipelineArtifactHashes(base, {
      constitution: "hash-1",
      plan: "hash-2"
    });
    const withStage = appendPipelineCompletedStage(markPipelineCurrentStage(withArtifacts, "plan"), "triage");

    expect(withStage.artifact_hashes).toEqual({
      constitution: "hash-1",
      plan: "hash-2"
    });
    expect(withStage.current_stage).toBe("plan");
    expect(withStage.completed_stages).toEqual(["triage"]);
    expect(isPipelineStateStale(withStage, "tree-1")).toBe(false);
    expect(isPipelineStateStale(withStage, "tree-2")).toBe(true);
    expect(() => assertPipelineStateFresh(withStage, "tree-2")).toThrow(CliError);
  });
});
