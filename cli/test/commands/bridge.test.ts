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
  appendBridgeQuestionEvent,
  appendBridgeStatusEvent,
  defaultBridgeSession,
  loadBridgeSession,
  readBridgeEvents,
  saveBridgeSession
} from "../../src/lib/bridge.js";
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
    appendBridgeStatusEvent("abc123", { stageId: "triage", text: "Started triage." }, tempDir);
    appendBridgeQuestionEvent(
      "abc123",
      {
        requestId: 7,
        gateType: "approval",
        question: "Approve the plan?",
        choices: ["approve", "reject"],
        defaultChoice: "approve"
      },
      tempDir
    );

    const replay = await readBridgeEvents("abc123", { after: 1 }, tempDir);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]).toMatchObject({ type: "question", requestId: 7 });
    expect(replay.nextCursor).toBe(2);
    expect(replay.status).toBe("blocked");

    stdout.length = 0;
    await runBridgeEventsCommand({ runId: "abc123", after: 0, json: true });
    const commandPayload = JSON.parse(stdout.join("")) as { events: Array<{ seq: number }> };
    expect(commandPayload.events).toHaveLength(2);

    writePendingGate(
      "abc123",
      {
        requestId: 7,
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
    expect(mockedCreateLocalAgentRunner).toHaveBeenCalledWith("claude");
  });
});
