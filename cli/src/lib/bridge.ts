import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { CliError } from "./errors.js";
import {
  lineupRunBridgeDir,
  lineupRunBridgeEventsFile,
  lineupRunBridgeSessionFile
} from "./paths.js";
import type { BridgeCompleteEvent, BridgeEvent, BridgeQuestionEvent, BridgeSessionRecord, BridgeStatusEvent } from "./types.js";

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
    text: input.text,
    ...(input.final ? { final: true } : {})
  };
  persistBridgeEvent(runId, event, cwd);
  updateBridgeSession(runId, {
    current_seq: event.seq,
    status: "running"
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
  const event: BridgeQuestionEvent = {
    seq: session.current_seq + 1,
    type: "question",
    runId,
    requestId: input.requestId,
    gateType: input.gateType,
    question: input.question,
    choices: input.choices,
    ...(input.defaultChoice ? { defaultChoice: input.defaultChoice } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.allowFreeText ? { allowFreeText: true } : {})
  };
  persistBridgeEvent(runId, event, cwd);
  updateBridgeSession(runId, {
    current_seq: event.seq,
    status: "blocked"
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
  const event: BridgeCompleteEvent = {
    seq: session.current_seq + 1,
    type: "complete",
    runId,
    status: finalStatus,
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {})
  };
  persistBridgeEvent(runId, event, cwd);
  updateBridgeSession(runId, {
    current_seq: event.seq,
    status: finalStatus,
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
): Promise<{
  runId: string;
  events: BridgeEvent[];
  nextCursor: number;
  terminal: boolean;
  status: BridgeSessionRecord["status"];
}> {
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
        status: session.status
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
