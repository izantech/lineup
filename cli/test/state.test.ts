import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../src/lib/errors.js";
import {
  assertPipelineStateFresh,
  clearPipelinePendingGate,
  defaultPipelineState,
  isPipelineStateStale,
  loadPipelineState,
  markPipelineCurrentStage,
  pipelineStateFile,
  savePipelineState,
  setPipelinePendingGate,
  updatePipelineArtifactHashes,
  appendPipelineCompletedStage,
  updatePipelineStageState
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

  it("round-trips structured stage and pending gate state", () => {
    const base = defaultPipelineState({
      runId: "run-789",
      workflow: "/repo/workflows/full-pipeline.yaml",
      gitTreeSha: "tree-3"
    });
    const withStageState = updatePipelineStageState(base, "plan", {
      status: "running",
      last_message: "Drafting the plan",
      attempt: 1,
      max_attempts: 2
    });
    const withPendingGate = setPipelinePendingGate(withStageState, {
      request_id: "42",
      stage_id: "plan-approval",
      gate_type: "approval",
      question: "Approve the generated plan?",
      choices: ["approve", "reject"],
      default_choice: "approve",
      created_at: "2026-04-12T11:00:00.000Z",
      expires_at: "2026-04-12T11:05:00.000Z"
    });

    const saved = savePipelineState(withPendingGate, tempDir);
    const loaded = loadPipelineState("run-789", tempDir);

    expect(saved.stage_state?.plan).toMatchObject({
      status: "running",
      last_message: "Drafting the plan",
      attempt: 1,
      max_attempts: 2
    });
    expect(loaded?.pending_gate).toMatchObject({
      request_id: "42",
      stage_id: "plan-approval",
      gate_type: "approval"
    });

    const cleared = clearPipelinePendingGate(saved);
    expect(cleared.pending_gate).toBeUndefined();
  });
});
