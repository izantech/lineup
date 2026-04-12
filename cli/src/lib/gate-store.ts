import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { lineupRunDir } from "./paths.js";
import type { JsonRpcId, LineupGateType } from "./protocol.js";

export type PendingGate = {
  requestId: JsonRpcId;
  gateType: LineupGateType;
  question: string;
  choices: readonly string[];
  defaultChoice?: string;
  context?: string;
  allowFreeText?: boolean;
  createdAt: string;
};

export type GateResponse = {
  requestId: JsonRpcId;
  choice: string;
  reason?: string;
  respondedAt: string;
};

function gatesDir(runId: string, projectRoot: string): string {
  return resolve(lineupRunDir(runId, projectRoot), "gates");
}

function pendingPath(runId: string, requestId: JsonRpcId, projectRoot: string): string {
  return resolve(gatesDir(runId, projectRoot), `pending-${requestId}.json`);
}

function responsePath(runId: string, requestId: JsonRpcId, projectRoot: string): string {
  return resolve(gatesDir(runId, projectRoot), `response-${requestId}.json`);
}

export function writePendingGate(runId: string, gate: PendingGate, projectRoot: string): string {
  const dir = gatesDir(runId, projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = pendingPath(runId, gate.requestId, projectRoot);
  writeFileSync(filePath, `${JSON.stringify(gate, null, 2)}\n`, "utf8");
  return filePath;
}

export function readPendingGate(runId: string, requestId: JsonRpcId, projectRoot: string): PendingGate | null {
  const filePath = pendingPath(runId, requestId, projectRoot);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as PendingGate;
}

export function readGateResponse(runId: string, requestId: JsonRpcId, projectRoot: string): GateResponse | null {
  const filePath = responsePath(runId, requestId, projectRoot);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as GateResponse;
}

export function writeGateResponse(runId: string, response: GateResponse, projectRoot: string): void {
  const dir = gatesDir(runId, projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = responsePath(runId, response.requestId, projectRoot);
  // Atomic write: write to temp, then rename
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(response, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

export class GateTimeoutError extends Error {
  runId: string;
  requestId: JsonRpcId;
  gateType: string;

  constructor(runId: string, requestId: JsonRpcId, gateType: string, timeoutMs: number) {
    super(`Gate response timeout after ${timeoutMs}ms for request ${requestId} in run ${runId}.`);
    this.name = "GateTimeoutError";
    this.runId = runId;
    this.requestId = requestId;
    this.gateType = gateType;
  }
}

export async function waitForGateResponse(
  runId: string,
  requestId: JsonRpcId,
  projectRoot: string,
  timeoutMs = 600000,
  gateType = "unknown"
): Promise<GateResponse> {
  const startTime = Date.now();
  const pollIntervalMs = 200;

  while (Date.now() - startTime < timeoutMs) {
    const response = readGateResponse(runId, requestId, projectRoot);
    if (response) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new GateTimeoutError(runId, requestId, gateType, timeoutMs);
}
