import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedRunPipeline = vi.hoisted(() => vi.fn());
const mockedCreateLocalAgentRunner = vi.hoisted(() => vi.fn());
const mockedIsInteractive = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/run-pipeline.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/run-pipeline.js")>("../../src/lib/run-pipeline.js");
  return {
    ...actual,
    runPipeline: mockedRunPipeline
  };
});

vi.mock("../../src/lib/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/agent-runner.js")>("../../src/lib/agent-runner.js");
  return {
    ...actual,
    createLocalAgentRunner: mockedCreateLocalAgentRunner
  };
});

vi.mock("../../src/lib/prompts.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/prompts.js")>("../../src/lib/prompts.js");
  return {
    ...actual,
    isInteractive: mockedIsInteractive
  };
});

import { runResumeCommand } from "../../src/commands/resume.js";
import { lineupRunDir } from "../../src/lib/paths.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";

describe("lineup resume", () => {
  let tempDir = "";
  let stdout: string[];
  let originalCwd = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-resume-test-"));
    stdout = [];
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
    mockedRunPipeline.mockReset();
    mockedCreateLocalAgentRunner.mockReset();
    mockedIsInteractive.mockReset();
    mockedIsInteractive.mockReturnValue(false);
    mockedRunPipeline.mockResolvedValue({
      runId: "resume-1",
      status: "success",
      stageResults: new Map([["implement", { id: "implement", status: "complete", outputs: {} }]])
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
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

  it("prints guided blocked run messaging", async () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-blocked",
      status: "blocked",
      workflow: "workflows/full.yaml",
      current_stage: "plan-approval",
      completed_stages: ["triage", "plan"],
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("resume-blocked", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    await runResumeCommand({ runId: "resume-blocked" });

    expect(stdout.join("")).toContain("Run resume-blocked is blocked at stage 'plan-approval'.");
    expect(stdout.join("")).toContain("Resuming will continue from there once the blocker clears.");
    expect(stdout.join("")).toContain("lineup show resume-blocked");
    expect(stdout.join("")).toContain("lineup cancel resume-blocked");
    expect(mockedRunPipeline).toHaveBeenCalledWith({
      workflow: "workflows/full.yaml",
      fromStage: "plan-approval",
      gateTimeout: undefined,
      mode: "host",
      host: undefined
    }, {
      emitProtocolToStdout: false
    });
  });

  it("explains failed stage retries before running them", async () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-failed",
      status: "failed",
      workflow: "workflows/full.yaml",
      current_stage: "implement",
      completed_stages: ["triage", "plan"],
      artifact_hashes: {},
      retry_state: {
        implement: {
          stage_id: "implement",
          attempt: 1,
          max_attempts: 3,
          last_error: "Agent crashed",
          last_attempt_at: "2026-04-12T11:00:00.000Z"
        }
      },
      errors: [{ code: "agent_spawn_failed", message: "Agent crashed" }],
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("resume-failed", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    await runResumeCommand({ runId: "resume-failed", retryFailed: true, maxRetries: 3 });

    expect(stdout.join("")).toContain("Retrying stage 'implement' (attempt 2/3). Last error: Agent crashed");
    expect(stdout.join("")).toContain("Run resume-failed completed successfully.");
    expect(mockedRunPipeline).toHaveBeenCalledWith({
      workflow: "workflows/full.yaml",
      fromStage: "implement",
      gateTimeout: undefined,
      mode: "host",
      host: undefined
    }, {
      emitProtocolToStdout: false
    });
  });

  it("guides canceled runs back to the current resume point", async () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-canceled",
      status: "canceled",
      workflow: "workflows/full.yaml",
      current_stage: "research",
      completed_stages: ["triage"],
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("resume-canceled", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    await runResumeCommand({ runId: "resume-canceled" });

    expect(stdout.join("")).toContain("Run resume-canceled was canceled. Resuming will continue from stage 'research'.");
    expect(stdout.join("")).toContain("lineup show resume-canceled");
    expect(stdout.join("")).toContain("Run resume-canceled completed successfully.");
    expect(mockedRunPipeline).toHaveBeenCalledWith({
      workflow: "workflows/full.yaml",
      fromStage: "research",
      gateTimeout: undefined,
      mode: "host",
      host: undefined
    }, {
      emitProtocolToStdout: false
    });
  });

  it("returns guided json output for failed retries", async () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-json",
      status: "failed",
      workflow: "workflows/full.yaml",
      current_stage: "implement",
      completed_stages: ["triage", "plan"],
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("resume-json", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    await runResumeCommand({ runId: "resume-json", retryFailed: true, json: true });

    const payload = JSON.parse(stdout.join("")) as {
      run_id: string;
      from_stage: string;
      mode: string;
      message: string;
      status: string;
    };
    expect(payload).toMatchObject({
      run_id: "resume-1",
      from_stage: "implement",
      mode: "retry",
      status: "success"
    });
    expect(payload.message).toContain("Retrying stage 'implement'");
  });

  it("surfaces gate-timeout recovery context for blocked runs", async () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-timeout",
      status: "blocked",
      workflow: "workflows/full.yaml",
      gate_timeout_seconds: 5,
      current_stage: "plan-approval",
      completed_stages: ["triage", "plan"],
      artifact_hashes: {},
      errors: [{ code: "gate_timeout", message: "approval gate timed out while waiting for a response." }],
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("resume-timeout", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    await runResumeCommand({ runId: "resume-timeout" });

    expect(stdout.join("")).toContain("because a gate timed out");
    expect(stdout.join("")).toContain("lineup show resume-timeout");
    expect(stdout.join("")).toContain("lineup cancel resume-timeout");
    expect(mockedRunPipeline).toHaveBeenCalledWith({
      workflow: "workflows/full.yaml",
      fromStage: "plan-approval",
      gateTimeout: 5,
      mode: "host",
      host: undefined
    }, {
      emitProtocolToStdout: false
    });
  });

  it("returns null for a nonexistent run", () => {
    const loaded = loadPipelineState("nonexistent", tempDir);
    expect(loaded).toBeNull();
  });

  it("uses the local agent runner in interactive mode", async () => {
    mockedIsInteractive.mockReturnValue(true);
    mockedCreateLocalAgentRunner.mockReturnValue({ host: "claude" });

    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "resume-interactive",
      status: "canceled",
      workflow: "workflows/full.yaml",
      current_stage: "research",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("resume-interactive", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    await runResumeCommand({ runId: "resume-interactive" });

    expect(mockedRunPipeline).toHaveBeenCalledWith({
      workflow: "workflows/full.yaml",
      fromStage: "research",
      gateTimeout: undefined,
      mode: "human",
      host: "claude"
    }, {
      emitProtocolToStdout: false,
      localAgentRunner: { host: "claude" }
    });
  });
});
