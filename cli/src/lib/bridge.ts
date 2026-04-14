import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { CliError } from "./errors.js";
import {
  lineupRunBridgeDir,
  lineupRunBridgeEventsFile,
  lineupRunBridgeSessionFile
} from "./paths.js";
import type {
  BridgeCompleteEvent,
  BridgeEvent,
  BridgeEventsResult,
  BridgePendingQuestion,
  BridgeQuestionEvent,
  BridgeRecoveryInfo,
  BridgeSessionRecord,
  BridgeStatusEvent
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function readBridgeEventsFile(runId: string, cwd = process.cwd()): BridgeEvent[] {
  const filePath = lineupRunBridgeEventsFile(runId, cwd);
  if (!existsSync(filePath)) {
    return [];
  }

  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as BridgeEvent);
}

export function defaultBridgeSession(input: {
  runId: string;
  executorHost: BridgeSessionRecord["executor_host"];
  workflow?: string;
  tactic?: string;
  gateTimeoutSeconds?: number;
}): BridgeSessionRecord {
  const createdAt = nowIso();
  return {
    apiVersion: "lineup/v3",
    kind: "BridgeSession",
    run_id: input.runId,
    status: "starting",
    executor_host: input.executorHost,
    current_seq: 0,
    ...(input.workflow ? { workflow: input.workflow } : {}),
    ...(input.tactic ? { tactic: input.tactic } : {}),
    ...(input.gateTimeoutSeconds !== undefined ? { gate_timeout_seconds: input.gateTimeoutSeconds } : {}),
    created_at: createdAt,
    updated_at: createdAt
  };
}

export function loadBridgeSession(runId: string, cwd = process.cwd()): BridgeSessionRecord | null {
  const filePath = lineupRunBridgeSessionFile(runId, cwd);
  if (!existsSync(filePath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as BridgeSessionRecord;
  if (parsed.apiVersion !== "lineup/v3" || parsed.kind !== "BridgeSession") {
    throw new CliError(`Bridge session ${filePath} is invalid.`, { code: "data_corruption" });
  }

  return parsed;
}

export function saveBridgeSession(session: BridgeSessionRecord, cwd = process.cwd()): BridgeSessionRecord {
  const filePath = lineupRunBridgeSessionFile(session.run_id, cwd);
  mkdirSync(lineupRunBridgeDir(session.run_id, cwd), { recursive: true });
  const payload: BridgeSessionRecord = {
    ...session,
    updated_at: nowIso()
  };
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
  return payload;
}

export function updateBridgeSession(
  runId: string,
  patch: Partial<Omit<BridgeSessionRecord, "apiVersion" | "kind" | "run_id" | "created_at">>,
  cwd = process.cwd()
): BridgeSessionRecord {
  const existing = loadBridgeSession(runId, cwd);
  if (!existing) {
    throw new CliError(`Bridge session not found for run ${runId}.`, { code: "invalid_path" });
  }

  return saveBridgeSession(
    {
      ...existing,
      ...patch
    },
    cwd
  );
}

function persistBridgeEvent(runId: string, event: BridgeEvent, cwd = process.cwd()): void {
  mkdirSync(lineupRunBridgeDir(runId, cwd), { recursive: true });
  appendFileSync(lineupRunBridgeEventsFile(runId, cwd), `${JSON.stringify(event)}\n`, "utf8");
}

function toIsoOrUndefined(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function computeExpiresAt(createdAt: string, gateTimeoutSeconds: number | undefined): string | undefined {
  if (gateTimeoutSeconds === undefined) {
    return undefined;
  }

  const createdAtMs = Date.parse(createdAt);
  if (Number.isNaN(createdAtMs)) {
    return undefined;
  }

  return toIsoOrUndefined(createdAtMs + gateTimeoutSeconds * 1000);
}

function bridgeInspectCommand(runId: string): string {
  return `lineup show ${runId} --json`;
}

function bridgeResumeCommand(runId: string): string {
  return `lineup resume ${runId}`;
}

function bridgeAnswerCommand(runId: string, pendingQuestion: BridgePendingQuestion): string {
  const choice = pendingQuestion.defaultChoice ?? "<choice>";
  return `lineup bridge answer ${runId} ${pendingQuestion.requestId} --choice "${choice}"`;
}

function formatCompletionSummary(
  runId: string,
  status: BridgeSessionRecord["status"],
  summary: string | undefined,
  session: BridgeSessionRecord
): string {
  const detail = summary?.trim();
  if (status === "succeeded") {
    return detail && detail !== "Pipeline completed successfully."
      ? `Bridge run succeeded. ${detail} Inspect with \`${bridgeInspectCommand(runId)}\`.`
      : `Bridge run succeeded. Inspect with \`${bridgeInspectCommand(runId)}\` or \`lineup logs ${runId} --json\`.`;
  }

  if (status === "blocked") {
    const pending = session.pending_question;
    if (pending?.timedOut) {
      return `Bridge run is blocked after the ${pending.gateType} question timed out. Resume with \`${bridgeResumeCommand(runId)}\`.`;
    }

    return `Bridge run is blocked and waiting for a bridge answer. Answer with \`${pending ? bridgeAnswerCommand(runId, pending) : `lineup bridge answer ${runId} <request-id> --choice "<choice>"`}\`.`;
  }

  if (status === "canceled") {
    return detail
      ? `Bridge run was canceled. ${detail} Inspect with \`${bridgeInspectCommand(runId)}\`.`
      : `Bridge run was canceled. Inspect with \`${bridgeInspectCommand(runId)}\`.`;
  }

  return detail
    ? `Bridge run failed: ${detail} Inspect with \`lineup logs ${runId} --json\`.`
    : `Bridge run failed. Inspect with \`lineup logs ${runId} --json\`.`;
}

function sessionRecovery(runId: string, session: BridgeSessionRecord): BridgeRecoveryInfo {
  const pending = session.pending_question;
  if (session.status === "blocked" && pending) {
    if (pending.workerWaiting && !pending.timedOut) {
      return {
        action: "answer",
        command: bridgeAnswerCommand(runId, pending),
        message: `Answer the pending ${pending.gateType} question to continue the bridge run.`
      };
    }

    return {
      action: "resume",
      command: bridgeResumeCommand(runId),
      message: "The worker stopped after a gate timeout. Resume the run to continue."
    };
  }

  return {
    action: "inspect",
    command: bridgeInspectCommand(runId),
    message:
      session.status === "running" || session.status === "starting"
        ? "Inspect the live run state."
        : "Inspect the completed run state."
  };
}

export function clearBridgePendingQuestion(runId: string, cwd = process.cwd()): BridgeSessionRecord {
  return updateBridgeSession(
    runId,
    {
      pending_question: undefined,
      blocked_recovery: false,
      status: "running"
    },
    cwd
  );
}

export function appendBridgeStatusEvent(
  runId: string,
  input: Omit<BridgeStatusEvent, "seq" | "type" | "runId">,
  cwd = process.cwd()
): BridgeStatusEvent {
  const session = updateBridgeSession(runId, {
    status: "running"
  }, cwd);
  const event: BridgeStatusEvent = {
    seq: session.current_seq + 1,
    type: "status",
    runId,
    stageId: input.stageId,
    stageLabel: input.stageLabel,
    kind: input.kind,
    text: input.text,
    ...(input.final ? { final: true } : {})
  };
  persistBridgeEvent(runId, event, cwd);
  updateBridgeSession(runId, {
    current_seq: event.seq,
    status: "running",
    ...(event.kind === "stage-end" && event.text.startsWith("Gate '")
      ? {
          pending_question: undefined,
          blocked_recovery: false
        }
      : {})
  }, cwd);
  return event;
}

export function appendBridgeQuestionEvent(
  runId: string,
  input: Omit<BridgeQuestionEvent, "seq" | "type" | "runId">,
  cwd = process.cwd()
): BridgeQuestionEvent {
  const session = loadBridgeSession(runId, cwd);
  if (!session) {
    throw new CliError(`Bridge session not found for run ${runId}.`, { code: "invalid_path" });
  }

  const createdAt = input.createdAt;
  const expiresAt = input.expiresAt ?? computeExpiresAt(createdAt, session.gate_timeout_seconds);
  const event: BridgeQuestionEvent = {
    seq: session.current_seq + 1,
    type: "question",
    runId,
    requestId: input.requestId,
    stageId: input.stageId,
    gateType: input.gateType,
    question: input.question,
    choices: input.choices,
    ...(input.defaultChoice ? { defaultChoice: input.defaultChoice } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.allowFreeText ? { allowFreeText: true } : {}),
    createdAt,
    ...(expiresAt ? { expiresAt } : {})
  };
  persistBridgeEvent(runId, event, cwd);
  updateBridgeSession(runId, {
    current_seq: event.seq,
    status: "blocked",
    pending_question: {
      requestId: event.requestId,
      stageId: event.stageId,
      gateType: event.gateType,
      question: event.question,
      choices: event.choices,
      ...(event.defaultChoice ? { defaultChoice: event.defaultChoice } : {}),
      ...(event.context ? { context: event.context } : {}),
      ...(event.allowFreeText ? { allowFreeText: true } : {}),
      createdAt: event.createdAt,
      ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
      workerWaiting: true,
      timedOut: false
    },
    blocked_recovery: false
  }, cwd);
  return event;
}

function toBridgeCompletionStatus(status: string): BridgeSessionRecord["status"] {
  if (status === "success" || status === "succeeded") {
    return "succeeded";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "aborted" || status === "canceled") {
    return "canceled";
  }
  return "failed";
}

export function appendBridgeCompleteEvent(
  runId: string,
  input: Omit<BridgeCompleteEvent, "seq" | "type" | "runId" | "status"> & { status: string },
  cwd = process.cwd()
): BridgeCompleteEvent {
  const session = loadBridgeSession(runId, cwd);
  if (!session) {
    throw new CliError(`Bridge session not found for run ${runId}.`, { code: "invalid_path" });
  }
  const finalStatus = toBridgeCompletionStatus(input.status);
  const pendingQuestion =
    finalStatus === "blocked" && session.pending_question
      ? {
          ...session.pending_question,
          workerWaiting: false,
          timedOut: true
        }
      : undefined;
  const event: BridgeCompleteEvent = {
    seq: session.current_seq + 1,
    type: "complete",
    runId,
    status: finalStatus,
    summary: formatCompletionSummary(runId, finalStatus, input.summary, {
      ...session,
      ...(pendingQuestion ? { pending_question: pendingQuestion } : {})
    }),
    ...(input.completedAt ? { completedAt: input.completedAt } : {})
  };
  persistBridgeEvent(runId, event, cwd);
  updateBridgeSession(runId, {
    current_seq: event.seq,
    status: finalStatus,
    ...(finalStatus === "blocked"
      ? {
          pending_question: pendingQuestion,
          blocked_recovery: true
        }
      : {
          pending_question: undefined,
          blocked_recovery: false
        }),
    ...(event.completedAt ? { completed_at: event.completedAt } : {})
  }, cwd);
  return event;
}

export async function readBridgeEvents(
  runId: string,
  options: {
    after?: number;
    waitMs?: number;
  } = {},
  cwd = process.cwd()
): Promise<BridgeEventsResult> {
  const after = options.after ?? 0;
  const waitMs = options.waitMs ?? 0;
  const startedAt = Date.now();

  while (true) {
    const session = loadBridgeSession(runId, cwd);
    if (!session) {
      throw new CliError(`Bridge session not found for run ${runId}.`, { code: "invalid_path" });
    }

    const events = readBridgeEventsFile(runId, cwd).filter((event) => event.seq > after);
    const terminal = session.status === "succeeded" || session.status === "failed" || session.status === "canceled";

    if (events.length > 0 || terminal || Date.now() - startedAt >= waitMs) {
      return {
        runId,
        events,
        nextCursor: events.length > 0 ? events[events.length - 1]!.seq : after,
        terminal,
        status: session.status,
        session: {
          executorHost: session.executor_host,
          ...(session.workflow ? { workflow: session.workflow } : {}),
          ...(session.tactic ? { tactic: session.tactic } : {}),
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          ...(session.completed_at ? { completedAt: session.completed_at } : {}),
          currentSeq: session.current_seq
        },
        ...(session.pending_question ? { pendingQuestion: session.pending_question } : {}),
        recovery: sessionRecovery(runId, session)
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
