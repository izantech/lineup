import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { createLocalAgentRunner, resolveLocalExecutionHost } from "../lib/agent-runner.js";
import {
  appendBridgeCompleteEvent,
  appendBridgeQuestionEvent,
  appendBridgeStatusEvent,
  defaultBridgeSession,
  loadBridgeSession,
  readBridgeEvents,
  saveBridgeSession,
  updateBridgeSession
} from "../lib/bridge.js";
import { CliError } from "../lib/errors.js";
import { readPendingGate, writeGateResponse, type GateResponse } from "../lib/gate-store.js";
import { lineupRunBridgeDir, lineupRunBridgeStderrLogFile, lineupRunBridgeStdoutLogFile, packageRoot } from "../lib/paths.js";
import { printJson, printTableLine } from "../lib/output.js";
import type {
  LineupAgentOutputParams,
  LineupGateRequestParams,
  LineupPipelineCompleteParams,
  LineupProtocolMessage
} from "../lib/protocol.js";
import { runPipeline } from "../lib/run-pipeline.js";
import type { HostName } from "../lib/constants.js";
import type { BridgeEvent, BridgeSessionRecord, RunOptions } from "../lib/types.js";

export type BridgeStartOptions = RunOptions & {
  executorHost?: HostName;
  json?: boolean;
  prompt?: string;
};

export type BridgeEventsOptions = {
  runId: string;
  after?: number;
  wait?: number;
  json?: boolean;
};

export type BridgeAnswerOptions = {
  runId: string;
  requestId: string;
  choice: string;
  reason?: string;
  json?: boolean;
};

export type BridgeWorkerOptions = RunOptions & {
  runId: string;
  executorHost: HostName;
  prompt: string;
};

type BridgeStartDeps = {
  spawnWorker?: (input: { runId: string; executorHost: HostName; options: BridgeStartOptions }) => number | undefined;
};

function createRunId(): string {
  return createHash("sha256")
    .update(Date.now().toString() + Math.random().toString())
    .digest("hex")
    .slice(0, 6);
}

function formatBridgeEvent(event: BridgeEvent): string {
  if (event.type === "status") {
    return `[${event.stageLabel}:${event.kind}] ${event.text}`;
  }
  if (event.type === "question") {
    return `[question:${event.gateType}:${event.stageId}] ${event.question}`;
  }
  return `[complete:${event.status}] ${event.summary ?? "Run completed."}`;
}

function stageLabel(stageId: string): string {
  const knownLabels: Record<string, string> = {
    triage: "Triage",
    clarify: "Clarify",
    research: "Research",
    gate: "Clarification Gate",
    plan: "Plan",
    "plan-approval": "Plan Approval",
    implement: "Implement",
    verify: "Verify",
    document: "Document"
  };

  if (knownLabels[stageId]) {
    return knownLabels[stageId];
  }

  return stageId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusKind(text: string, final: boolean | undefined): "stage-start" | "progress" | "stage-end" | "warning" {
  if (text.startsWith("[stage/warning]")) {
    return "warning";
  }
  if (final) {
    return "stage-end";
  }
  if (text.startsWith("Starting ")) {
    return "stage-start";
  }
  return "progress";
}

function resumeRecovery(runId: string): { action: "resume"; command: string; message: string } {
  return {
    action: "resume",
    command: `lineup resume ${runId}`,
    message: "The bridge worker already stopped after a gate timeout. Resume the run to continue."
  };
}

function resolveWorkerCommand(): { command: string; args: string[] } {
  const root = packageRoot();
  const distCli = resolve(root, "dist", "cli.js");
  if (existsSync(distCli)) {
    return { command: process.execPath, args: [distCli] };
  }

  const tsxBin = resolve(root, "node_modules", ".bin", "tsx");
  const srcCli = resolve(root, "src", "cli.ts");
  if (existsSync(tsxBin) && existsSync(srcCli)) {
    return { command: tsxBin, args: [srcCli] };
  }

  if (process.argv[1]) {
    return { command: process.execPath, args: [process.argv[1]] };
  }

  throw new CliError("Could not resolve the Lineup CLI entrypoint for bridge worker startup.", {
    code: "command_not_found"
  });
}

function spawnBridgeWorker(input: { runId: string; executorHost: HostName; options: BridgeStartOptions }): number | undefined {
  const projectRoot = resolve(".");
  const bridgeDir = lineupRunBridgeDir(input.runId, projectRoot);
  mkdirSync(bridgeDir, { recursive: true });

  const stdoutFd = openSync(lineupRunBridgeStdoutLogFile(input.runId, projectRoot), "a");
  const stderrFd = openSync(lineupRunBridgeStderrLogFile(input.runId, projectRoot), "a");
  const worker = resolveWorkerCommand();
  const args = [
    ...worker.args,
    "bridge",
    "_worker",
    input.options.prompt ?? "",
    "--run-id",
    input.runId,
    "--executor-host",
    input.executorHost,
    ...(input.options.workflow ? ["--workflow", input.options.workflow] : []),
    ...(input.options.tactic ? ["--tactic", input.options.tactic] : []),
    ...(input.options.host ? ["--host", input.options.host] : []),
    ...(input.options.approvePlan ? ["--approve-plan"] : []),
    ...(input.options.gateTimeout !== undefined ? ["--gate-timeout", String(input.options.gateTimeout)] : []),
    ...(input.options.implementMethod ? ["--implement-method", input.options.implementMethod] : []),
    ...(input.options.isolation ? ["--isolation", input.options.isolation] : []),
    ...(input.options.timeout !== undefined ? ["--timeout", String(input.options.timeout)] : []),
    ...(input.options.maxParallel !== undefined ? ["--max-parallel", String(input.options.maxParallel)] : [])
  ];

  const child = spawn(worker.command, args, {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd]
  });
  child.unref();
  return child.pid;
}

function translateProtocolToBridgeEvent(message: LineupProtocolMessage, runId: string, projectRoot: string): { terminal: boolean } {
  if ("method" in message && message.method === "agent/output") {
    const params = message.params as LineupAgentOutputParams | undefined;
    if (!params || params.channel !== "status") {
      return { terminal: false };
    }
    appendBridgeStatusEvent(runId, {
      stageId: params.stageId,
      stageLabel: stageLabel(params.stageId),
      kind: statusKind(params.chunk, params.final),
      text: params.chunk,
      ...(params.final ? { final: true } : {})
    });
    return { terminal: false };
  }

  if ("method" in message && message.method === "gate/request" && "id" in message) {
    const params = message.params as LineupGateRequestParams;
    const pending = readPendingGate(runId, message.id, projectRoot);
    appendBridgeQuestionEvent(runId, {
      requestId: message.id,
      stageId: params.stageId,
      gateType: params.gateType,
      question: params.question,
      choices: params.choices,
      ...(params.defaultChoice ? { defaultChoice: params.defaultChoice } : {}),
      ...(params.context ? { context: params.context } : {}),
      ...(params.allowFreeText ? { allowFreeText: true } : {}),
      createdAt: pending?.createdAt ?? new Date().toISOString()
    });
    return { terminal: false };
  }

  if ("method" in message && message.method === "pipeline/complete") {
    const params = message.params as LineupPipelineCompleteParams | undefined;
    if (!params) {
      return { terminal: false };
    }
    appendBridgeCompleteEvent(runId, {
      status: params.status,
      ...(params.summary ? { summary: params.summary } : {}),
      ...(params.completedAt ? { completedAt: params.completedAt } : {})
    });
    return { terminal: true };
  }

  return { terminal: false };
}

export async function runBridgeStartCommand(options: BridgeStartOptions, deps: BridgeStartDeps = {}): Promise<void> {
  if (!options.prompt) {
    throw new CliError("Task description required. Pass it as a positional argument to `lineup bridge start`.", {
      code: "invalid_args"
    });
  }

  const executorHost = resolveLocalExecutionHost(options.executorHost);
  const runId = createRunId();
  saveBridgeSession(
    defaultBridgeSession({
      runId,
      executorHost,
      ...(options.workflow ? { workflow: options.workflow } : {}),
      ...(options.tactic ? { tactic: options.tactic } : {}),
      ...(options.gateTimeout !== undefined ? { gateTimeoutSeconds: options.gateTimeout } : {})
    })
  );

  const workerPid = (deps.spawnWorker ?? spawnBridgeWorker)({
    runId,
    executorHost,
    options
  });

  const updated = updateBridgeSession(runId, {
    ...(workerPid ? { worker_pid: workerPid } : {}),
    status: "starting"
  });

  const payload = {
    runId,
    status: updated.status,
    executorHost: updated.executor_host,
    ...(updated.worker_pid ? { workerPid: updated.worker_pid } : {}),
    bridgeDir: lineupRunBridgeDir(runId)
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  printTableLine(`run_id: ${payload.runId}`);
  printTableLine(`status: ${payload.status}`);
  printTableLine(`executor_host: ${payload.executorHost}`);
  if (payload.workerPid) {
    printTableLine(`worker_pid: ${payload.workerPid}`);
  }
  printTableLine(`bridge_dir: ${payload.bridgeDir}`);
}

export async function runBridgeEventsCommand(options: BridgeEventsOptions): Promise<void> {
  const result = await readBridgeEvents(options.runId, {
    ...(options.after !== undefined ? { after: options.after } : {}),
    ...(options.wait !== undefined ? { waitMs: options.wait * 1000 } : {})
  });

  if (options.json) {
    printJson(result);
    return;
  }

  for (const event of result.events) {
    printTableLine(formatBridgeEvent(event));
  }
  if (result.pendingQuestion && !result.events.some((event) => event.type === "question")) {
    printTableLine(`[pending:${result.pendingQuestion.gateType}:${result.pendingQuestion.stageId}] ${result.pendingQuestion.question}`);
  }
  printTableLine(`next_cursor: ${result.nextCursor}`);
  printTableLine(`continue_with: lineup bridge events ${options.runId} --after ${result.nextCursor}`);
  printTableLine(`status: ${result.status}`);
  printTableLine(`terminal: ${result.terminal ? "yes" : "no"}`);
  printTableLine(`recovery: ${result.recovery.command}`);
}

export async function runBridgeAnswerCommand(options: BridgeAnswerOptions): Promise<void> {
  const session = loadBridgeSession(options.runId);
  if (!session) {
    throw new CliError(`Bridge session not found for run ${options.runId}.`, {
      code: "invalid_path"
    });
  }

  if (session.pending_question && String(session.pending_question.requestId) === options.requestId) {
    if (!session.pending_question.workerWaiting || session.pending_question.timedOut || session.blocked_recovery) {
      const recovery = resumeRecovery(options.runId);
      const payload = {
        accepted: false,
        runId: options.runId,
        requestId: options.requestId,
        choice: options.choice,
        recovery,
        message: recovery.message
      };

      if (options.json) {
        printJson(payload);
        return;
      }

      printTableLine(`${recovery.message} Use \`${recovery.command}\`.`);
      return;
    }
  }

  const projectRoot = resolve(".");
  const pending = readPendingGate(options.runId, options.requestId, projectRoot);
  if (!pending) {
    throw new CliError(`No pending bridge question found for request '${options.requestId}' in run '${options.runId}'.`, {
      code: "command_not_found"
    });
  }

  const response: GateResponse = {
    requestId: options.requestId,
    choice: options.choice,
    reason: options.reason,
    respondedAt: new Date().toISOString()
  };
  writeGateResponse(options.runId, response, projectRoot);

  if (options.json) {
    printJson({
      accepted: true,
      runId: options.runId,
      requestId: options.requestId,
      choice: options.choice
    });
    return;
  }

  printTableLine(`Bridge answer accepted for request ${options.requestId} in run ${options.runId}.`);
}

export async function runBridgeWorkerCommand(options: BridgeWorkerOptions): Promise<void> {
  if (!loadBridgeSession(options.runId)) {
    throw new CliError(`Bridge session not found for run ${options.runId}.`, {
      code: "invalid_path"
    });
  }

  const localAgentRunner = createLocalAgentRunner(options.executorHost);
  updateBridgeSession(options.runId, {
    status: "running"
  });

  let sawTerminalEvent = false;

  try {
    const result = await runPipeline(
      {
        ...options,
        mode: "host",
        host: options.executorHost
      },
      {
        runId: options.runId,
        localAgentRunner,
        emitProtocolToStdout: false,
        onProtocolMessage(message) {
          const translated = translateProtocolToBridgeEvent(message, options.runId, resolve("."));
          sawTerminalEvent = sawTerminalEvent || translated.terminal;
        }
      }
    );

    if (!sawTerminalEvent) {
      appendBridgeCompleteEvent(options.runId, {
        status: result.status,
        summary:
          result.status === "blocked"
            ? "Pipeline is awaiting a bridge answer."
            : result.status === "success"
              ? "Pipeline completed successfully."
              : `Pipeline finished with status ${result.status}.`,
        completedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    if (!sawTerminalEvent) {
      appendBridgeCompleteEvent(options.runId, {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString()
      });
    }
    throw error;
  }
}
