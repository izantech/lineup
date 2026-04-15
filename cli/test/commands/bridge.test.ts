import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockedCreateLocalAgentRunner, mockedResolveLocalExecutionHost } = vi.hoisted(() => ({
  mockedCreateLocalAgentRunner: vi.fn(),
  mockedResolveLocalExecutionHost: vi.fn()
}));

vi.mock("../../src/lib/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/agent-runner.js")>("../../src/lib/agent-runner.js");
  return {
    ...actual,
    createLocalAgentRunner: mockedCreateLocalAgentRunner,
    resolveLocalExecutionHost: mockedResolveLocalExecutionHost
  };
});

import {
  runBridgeAnswerCommand,
  runBridgeEventsCommand,
  runBridgeStartCommand,
  runBridgeWorkerCommand
} from "../../src/commands/bridge.js";
import {
  appendBridgeCompleteEvent,
  appendBridgeQuestionEvent,
  appendBridgeStatusEvent,
  defaultBridgeSession,
  loadBridgeSession,
  readBridgeEvents,
  saveBridgeSession
} from "../../src/lib/bridge.js";
import { createArtifactStore } from "../../src/lib/artifact-store.js";
import { savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";
import type { ArtifactKind } from "../../src/lib/types.js";
import { readGateResponse, writeGateResponse, writePendingGate } from "../../src/lib/gate-store.js";
import { lineupRunBridgeSessionFile } from "../../src/lib/paths.js";

const PLAN_YAML = `apiVersion: lineup/v3
kind: Plan
status: approved
summary: Ship the feature
approaches:
  - name: Native
    strategy: Use the native engine
recommendation:
  approach: Native
  rationale: Keep orchestration inside Lineup
changes:
  - file: README.md
    change: Update docs
    rationale: Needed for the feature
acceptance_criteria:
  - criterion: Docs updated
risks: []
`;

function seedPipelineRun(tempDir: string, runId: string, artifacts: Partial<Record<ArtifactKind, string>>): void {
  const store = createArtifactStore(join(tempDir, ".lineup", ".artifacts"));
  const state: PipelineStateRecord = {
    apiVersion: "lineup/v3",
    kind: "PipelineState",
    run_id: runId,
    status: "succeeded",
    workflow: "workflow.yaml",
    artifact_hashes: {},
    updated_at: new Date().toISOString()
  };

  for (const [kind, content] of Object.entries(artifacts)) {
    const record =
      kind === "tasks" || kind === "protocol"
        ? store.persistText(kind, content ?? "", "yaml")
        : store.persistText(kind, content ?? "", "yaml");
    state.artifact_hashes[kind as keyof typeof state.artifact_hashes] = record.sha256;
  }

  savePipelineState(state, tempDir);
}

describe("bridge commands", () => {
  let tempDir: string;
  let stdout: string[];
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-bridge-"));
    stdout = [];
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
    mockedResolveLocalExecutionHost.mockReset();
    mockedResolveLocalExecutionHost.mockReturnValue("claude");
    mockedCreateLocalAgentRunner.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("bridge start creates a session and returns the detached worker metadata", async () => {
    await runBridgeStartCommand(
      {
        prompt: "Analyze the codebase",
        executorHost: "claude",
        json: true
      },
      {
        spawnWorker: () => 321
      }
    );

    const payload = JSON.parse(stdout.join("")) as {
      runId: string;
      status: string;
      workerPid: number;
      executorHost: string;
    };
    expect(payload.runId).toMatch(/^[a-f0-9]{6}$/);
    expect(payload.status).toBe("starting");
    expect(payload.workerPid).toBe(321);
    expect(payload.executorHost).toBe("claude");
    expect(existsSync(lineupRunBridgeSessionFile(payload.runId, tempDir))).toBe(true);
    expect(loadBridgeSession(payload.runId, tempDir)?.worker_pid).toBe(321);
  });

  it("bridge events replay from a cursor and bridge answer writes the gate response shape", async () => {
    saveBridgeSession(defaultBridgeSession({ runId: "abc123", executorHost: "claude" }), tempDir);
    appendBridgeStatusEvent(
      "abc123",
      { stageId: "triage", stageLabel: "Triage", kind: "stage-start", text: "Started triage." },
      tempDir
    );
    appendBridgeQuestionEvent(
      "abc123",
      {
        requestId: 7,
        stageId: "plan-approval",
        gateType: "approval",
        question: "Approve the plan?",
        choices: ["approve", "reject"],
        defaultChoice: "approve",
        createdAt: "2026-04-13T10:00:00.000Z"
      },
      tempDir
    );

    const replay = await readBridgeEvents("abc123", { after: 1 }, tempDir);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]).toMatchObject({ type: "question", requestId: 7, stageId: "plan-approval" });
    expect(replay.nextCursor).toBe(2);
    expect(replay.status).toBe("blocked");
    expect(replay.pendingQuestion).toMatchObject({
      requestId: 7,
      stageId: "plan-approval",
      workerWaiting: true,
      timedOut: false
    });
    expect(replay.recovery.action).toBe("answer");

    stdout.length = 0;
    await runBridgeEventsCommand({ runId: "abc123", after: 0, json: true });
    const commandPayload = JSON.parse(stdout.join("")) as {
      events: Array<{ seq: number }>;
      session: { executorHost: string; currentSeq: number };
      pendingQuestion?: { requestId: number };
      recovery: { action: string };
    };
    expect(commandPayload.events).toHaveLength(2);
    expect(commandPayload.session).toMatchObject({ executorHost: "claude", currentSeq: 2 });
    expect(commandPayload.pendingQuestion).toMatchObject({ requestId: 7 });
    expect(commandPayload.recovery.action).toBe("answer");

    writePendingGate(
      "abc123",
      {
        requestId: 7,
        stageId: "plan-approval",
        gateType: "approval",
        question: "Approve the plan?",
        choices: ["approve", "reject"],
        defaultChoice: "approve",
        createdAt: new Date().toISOString()
      },
      tempDir
    );

    stdout.length = 0;
    await runBridgeAnswerCommand({
      runId: "abc123",
      requestId: "7",
      choice: "approve",
      reason: "Looks good",
      json: true
    });
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      accepted: true,
      runId: "abc123",
      requestId: "7",
      choice: "approve"
    });
    expect(readGateResponse("abc123", "7", tempDir)).toMatchObject({
      choice: "approve",
      reason: "Looks good"
    });
  });

  it("replays pending questions across reconnects and exposes timeout recovery", async () => {
    saveBridgeSession(defaultBridgeSession({ runId: "reco12", executorHost: "codex", gateTimeoutSeconds: 5 }), tempDir);
    appendBridgeQuestionEvent(
      "reco12",
      {
        requestId: 9,
        stageId: "clarify",
        gateType: "clarify",
        question: "What should this workflow optimize for?",
        choices: ["speed", "quality"],
        defaultChoice: "quality",
        createdAt: "2026-04-13T10:00:00.000Z"
      },
      tempDir
    );

    const replay = await readBridgeEvents("reco12", { after: 1 }, tempDir);
    expect(replay.events).toEqual([]);
    expect(replay.pendingQuestion).toMatchObject({
      requestId: 9,
      stageId: "clarify",
      expiresAt: "2026-04-13T10:00:05.000Z",
      workerWaiting: true
    });
    expect(replay.recovery).toMatchObject({
      action: "answer",
      command: 'lineup bridge answer reco12 9 --choice "quality"'
    });

    appendBridgeCompleteEvent(
      "reco12",
      {
        status: "blocked",
        summary: "Pipeline is awaiting a bridge answer.",
        completedAt: "2026-04-13T10:00:06.000Z"
      },
      tempDir
    );

    const blocked = await readBridgeEvents("reco12", { after: 1 }, tempDir);
    expect(blocked.events).toHaveLength(1);
    expect(blocked.events[0]).toMatchObject({ type: "complete", status: "blocked" });
    expect((blocked.events[0] as { summary?: string }).summary).toContain("lineup resume reco12");
    expect(blocked.pendingQuestion).toMatchObject({
      requestId: 9,
      timedOut: true,
      workerWaiting: false
    });
    expect(blocked.recovery).toMatchObject({
      action: "resume",
      command: "lineup resume reco12"
    });

    stdout.length = 0;
    await runBridgeAnswerCommand({
      runId: "reco12",
      requestId: "9",
      choice: "quality",
      json: true
    });
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      accepted: false,
      runId: "reco12",
      requestId: "9",
      recovery: {
        action: "resume",
        command: "lineup resume reco12"
      }
    });
  });

  it("prints the next polling command in human-readable bridge events output", async () => {
    saveBridgeSession(defaultBridgeSession({ runId: "next01", executorHost: "claude" }), tempDir);
    appendBridgeStatusEvent(
      "next01",
      { stageId: "triage", stageLabel: "Triage", kind: "stage-start", text: "Starting triage." },
      tempDir
    );

    stdout.length = 0;
    await runBridgeEventsCommand({ runId: "next01" });

    const output = stdout.join("");
    expect(output).toContain("Triage stage-start");
    expect(output).toContain("Starting triage.");
    expect(output).toContain("next_cursor: 1");
    expect(output).toContain("continue_with: lineup bridge events next01 --after 1");
  });

  it("renders pending bridge questions with exact answer guidance in text mode", async () => {
    saveBridgeSession(defaultBridgeSession({ runId: "ques01", executorHost: "claude", gateTimeoutSeconds: 30 }), tempDir);
    appendBridgeQuestionEvent(
      "ques01",
      {
        requestId: 3,
        stageId: "clarify",
        gateType: "clarify",
        question: "What should this optimize for?",
        choices: ["speed", "quality"],
        defaultChoice: "quality",
        createdAt: "2026-04-13T10:00:00.000Z"
      },
      tempDir
    );

    stdout.length = 0;
    await runBridgeEventsCommand({ runId: "ques01" });

    const output = stdout.join("");
    expect(output).toContain("Question | Clarify");
    expect(output).toContain("answer_with: lineup bridge answer ques01 3 --choice \"quality\"");
  });

  it("selects artifact-aware completion guidance for explain, plan, and review runs", async () => {
    saveBridgeSession(defaultBridgeSession({ runId: "expl01", executorHost: "opencode", tactic: "explain" }), tempDir);
    seedPipelineRun(tempDir, "expl01", { spec: "apiVersion: lineup/v3\nkind: Spec\nsummary: Explain the system\n" });

    appendBridgeCompleteEvent(
      "expl01",
      {
        status: "succeeded",
        summary: "Pipeline completed successfully.",
        completedAt: "2026-04-13T10:00:00.000Z"
      },
      tempDir
    );

    const explainReplay = await readBridgeEvents("expl01", {}, tempDir);
    expect((explainReplay.events[0] as { summary?: string }).summary).toContain("Inspect the spec artifact.");
    expect((explainReplay.events[0] as { summary?: string }).summary).toContain("lineup artifacts show spec --run expl01 --json");

    saveBridgeSession(defaultBridgeSession({ runId: "plan01", executorHost: "claude" }), tempDir);
    seedPipelineRun(tempDir, "plan01", { plan: "apiVersion: lineup/v3\nkind: Plan\nsummary: Draft the work\n" });

    appendBridgeCompleteEvent(
      "plan01",
      {
        status: "succeeded",
        summary: "Pipeline completed successfully.",
        completedAt: "2026-04-13T10:00:00.000Z"
      },
      tempDir
    );

    const planReplay = await readBridgeEvents("plan01", {}, tempDir);
    expect((planReplay.events[0] as { summary?: string }).summary).toContain("Inspect the plan artifact.");
    expect((planReplay.events[0] as { summary?: string }).summary).toContain("lineup artifacts show plan --run plan01 --json");

    saveBridgeSession(defaultBridgeSession({ runId: "rev01", executorHost: "claude" }), tempDir);
    seedPipelineRun(tempDir, "rev01", {
      tasks: '{"kind":"Tasks","tasks":[]}\n',
      review: "apiVersion: lineup/v3\nkind: Review\nsummary: Verify the change\n"
    });

    appendBridgeCompleteEvent(
      "rev01",
      {
        status: "succeeded",
        summary: "Pipeline completed successfully.",
        completedAt: "2026-04-13T10:00:00.000Z"
      },
      tempDir
    );

    const replay = await readBridgeEvents("rev01", {}, tempDir);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]).toMatchObject({
      type: "complete",
      status: "succeeded"
    });
    expect((replay.events[0] as { summary?: string }).summary).toContain("Inspect the review artifact.");
    expect((replay.events[0] as { summary?: string }).summary).toContain("lineup artifacts show review --run rev01 --json");
  });

  it("bridge worker runs the native pipeline with local agents and emits question and completion events", async () => {
    const workflowDir = join(tempDir, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "bridge.yaml");
    writeFileSync(
      workflowPath,
      `apiVersion: lineup/v3
kind: Workflow
name: bridge-test
stages:
  - id: triage
    type: builtin
  - id: plan
    type: agent
    agent: architect
    depends_on: [triage]
  - id: plan-approval
    type: approval
    depends_on: [plan]
`,
      "utf8"
    );

    saveBridgeSession(
      defaultBridgeSession({
        runId: "def456",
        executorHost: "claude",
        workflow: workflowPath
      }),
      tempDir
    );

    mockedCreateLocalAgentRunner.mockReturnValue({
      host: "claude",
      invoke: vi.fn(async () => ({
        host: "claude",
        content: PLAN_YAML,
        stderr: ""
      }))
    });

    setTimeout(() => {
      writeGateResponse(
        "def456",
        {
          requestId: 1,
          choice: "approve",
          respondedAt: new Date().toISOString()
        },
        tempDir
      );
    }, 50);

    await runBridgeWorkerCommand({
      runId: "def456",
      executorHost: "claude",
      workflow: workflowPath,
      prompt: "Plan the work",
      gateTimeout: 2
    });

    const events = await readBridgeEvents("def456", {}, tempDir);
    expect(events.events.some((event) => event.type === "status")).toBe(true);
    expect(events.events.some((event) => event.type === "question")).toBe(true);
    expect(events.events.some((event) => event.type === "complete" && event.status === "succeeded")).toBe(true);
    expect(loadBridgeSession("def456", tempDir)?.status).toBe("succeeded");
    expect(events.session.executorHost).toBe("claude");
    expect(events.recovery.action).toBe("inspect");
    expect(mockedCreateLocalAgentRunner).toHaveBeenCalledWith("claude");
  });
});
