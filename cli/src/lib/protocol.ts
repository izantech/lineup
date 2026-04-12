import type { PipelineRunStatus } from "./types.js";

export const JSON_RPC_VERSION = "2.0" as const;

export type JsonRpcVersion = typeof JSON_RPC_VERSION;
export type JsonRpcId = string | number;
export type JsonRpcResponseId = JsonRpcId | null;
export type JsonRpcParams = Record<string, unknown> | readonly unknown[];

export type LineupGateType =
  | "classify"
  | "clarify"
  | "clarification"
  | "approval"
  | "cache"
  | "verify-decision"
  | "custom";

export type JsonRpcRequest<
  TMethod extends string = string,
  TParams extends JsonRpcParams | undefined = JsonRpcParams | undefined
> = {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  method: TMethod;
  params?: TParams;
};

export type JsonRpcNotification<
  TMethod extends string = string,
  TParams extends JsonRpcParams | undefined = JsonRpcParams | undefined
> = {
  jsonrpc: JsonRpcVersion;
  method: TMethod;
  params?: TParams;
};

export type JsonRpcSuccessResponse<TResult = unknown> = {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcResponseId;
  result: TResult;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcResponseId;
  error: JsonRpcErrorObject;
};

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse;

export const JSON_RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  requestCancelled: -32800,
  requestTimeout: -32801,
} as const;

export type LineupRequestMethod = "agent/spawn" | "gate/request" | "gate/respond" | "pipeline/cancel";
export type LineupNotificationMethod = "agent/output" | "agent/done" | "agent/cancel" | "pipeline/complete";
export type LineupMethod = LineupRequestMethod | LineupNotificationMethod;

export type LineupAgentSpawnParams = {
  runId: string;
  stageId: string;
  agent: string;
  prompt: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  timeoutMs?: number;
  retryAttempt?: number;
};

export type LineupAgentSpawnResult = {
  accepted: true;
  workerId?: string;
};

export type LineupAgentOutputParams = {
  runId: string;
  stageId: string;
  channel: "stdout" | "stderr" | "status";
  sequence: number;
  chunk: string;
  final?: boolean;
};

export type LineupAgentDoneParams = {
  runId: string;
  stageId: string;
  status: PipelineRunStatus;
  summary?: string;
  outputs?: Record<string, unknown>;
};

export type LineupGateRequestParams = {
  runId: string;
  stageId: string;
  gateType: LineupGateType;
  question: string;
  choices: readonly string[];
  defaultChoice?: string;
  context?: string;
  allowFreeText?: boolean;
};

export type LineupGateRequestResult = {
  approved: boolean;
  choice?: string;
  reason?: string;
};

export type LineupGateRespondParams = {
  runId: string;
  requestId: JsonRpcId;
  choice: string;
  reason?: string;
};

export type LineupGateRespondResult = {
  accepted: true;
};

export type LineupAgentCancelParams = {
  runId: string;
  stageId?: string;
  reason?: string;
};

export type LineupPipelineCancelParams = {
  runId: string;
  reason?: string;
  stageId?: string;
};

export type LineupPipelineCancelResult = {
  cancelled: true;
};

export type LineupPipelineCompleteParams = {
  runId: string;
  status: PipelineRunStatus;
  completedAt?: string;
  summary?: string;
  artifacts?: Record<string, string>;
};

export interface LineupRequestParamsByMethod {
  "agent/spawn": LineupAgentSpawnParams;
  "gate/request": LineupGateRequestParams;
  "gate/respond": LineupGateRespondParams;
  "pipeline/cancel": LineupPipelineCancelParams;
}

export interface LineupRequestResultByMethod {
  "agent/spawn": LineupAgentSpawnResult;
  "gate/request": LineupGateRequestResult;
  "gate/respond": LineupGateRespondResult;
  "pipeline/cancel": LineupPipelineCancelResult;
}

export interface LineupNotificationParamsByMethod {
  "agent/output": LineupAgentOutputParams;
  "agent/done": LineupAgentDoneParams;
  "agent/cancel": LineupAgentCancelParams;
  "pipeline/complete": LineupPipelineCompleteParams;
}

export type LineupRequestEnvelope<TMethod extends LineupRequestMethod = LineupRequestMethod> = JsonRpcRequest<
  TMethod,
  LineupRequestParamsByMethod[TMethod]
>;

export type LineupNotificationEnvelope<TMethod extends LineupNotificationMethod = LineupNotificationMethod> = JsonRpcNotification<
  TMethod,
  LineupNotificationParamsByMethod[TMethod]
>;

export type LineupRequestResponseEnvelope<TMethod extends LineupRequestMethod = LineupRequestMethod> = JsonRpcSuccessResponse<
  LineupRequestResultByMethod[TMethod]
>;

export type LineupProtocolMessage =
  | LineupRequestEnvelope
  | LineupNotificationEnvelope
  | LineupRequestResponseEnvelope
  | JsonRpcErrorResponse;

export type ProtocolLogRecord =
  | {
      kind: "request";
      method: LineupRequestMethod;
      id: JsonRpcId;
      summary: string;
    }
  | {
      kind: "notification";
      method: LineupNotificationMethod;
      summary: string;
    }
  | {
      kind: "response";
      method?: LineupRequestMethod;
      id: JsonRpcResponseId;
      summary: string;
    }
  | {
      kind: "error";
      method?: LineupMethod;
      id: JsonRpcResponseId;
      code: number;
      summary: string;
    };

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export function createJsonRpcRequest<TMethod extends string, TParams extends JsonRpcParams | undefined = JsonRpcParams | undefined>(input: {
  method: TMethod;
  id: JsonRpcId;
  params?: TParams;
}): JsonRpcRequest<TMethod, TParams> {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: input.id,
    method: input.method,
    ...(input.params === undefined ? {} : { params: input.params }),
  };
}

export function createJsonRpcNotification<TMethod extends string, TParams extends JsonRpcParams | undefined = JsonRpcParams | undefined>(input: {
  method: TMethod;
  params?: TParams;
}): JsonRpcNotification<TMethod, TParams> {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method: input.method,
    ...(input.params === undefined ? {} : { params: input.params }),
  };
}

export function createJsonRpcSuccessResponse<TResult>(input: {
  id: JsonRpcResponseId;
  result: TResult;
}): JsonRpcSuccessResponse<TResult> {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: input.id,
    result: input.result,
  };
}

export function createJsonRpcErrorResponse(input: {
  id: JsonRpcResponseId;
  code: number;
  message: string;
  data?: unknown;
}): JsonRpcErrorResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: input.id,
    error: {
      code: input.code,
      message: input.message,
      ...(input.data === undefined ? {} : { data: input.data }),
    },
  };
}

export function createLineupRequest<TMethod extends LineupRequestMethod>(input: {
  method: TMethod;
  id: JsonRpcId;
  params: LineupRequestParamsByMethod[TMethod];
}): LineupRequestEnvelope<TMethod> {
  return createJsonRpcRequest(input);
}

export function createLineupNotification<TMethod extends LineupNotificationMethod>(input: {
  method: TMethod;
  params: LineupNotificationParamsByMethod[TMethod];
}): LineupNotificationEnvelope<TMethod> {
  return createJsonRpcNotification(input);
}

export function createLineupResponse<TMethod extends LineupRequestMethod>(input: {
  method: TMethod;
  id: JsonRpcResponseId;
  result: LineupRequestResultByMethod[TMethod];
}): LineupRequestResponseEnvelope<TMethod> {
  return createJsonRpcSuccessResponse({
    id: input.id,
    result: input.result,
  });
}

export function createLineupError(input: {
  id: JsonRpcResponseId;
  code: number;
  message: string;
  data?: unknown;
}): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse(input);
}

export function encodeNdjsonMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}

export function encodeNdjsonMessages(messages: readonly JsonRpcMessage[]): string {
  if (messages.length === 0) {
    return "";
  }

  return `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
}

export function parseNdjsonMessages(input: string): JsonRpcMessage[] {
  if (input.trim().length === 0) {
    return [];
  }

  return input
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseJsonRpcMessage(line));
}

export function parseJsonRpcMessage(input: string): JsonRpcMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new ProtocolError(`Invalid JSON-RPC payload: ${(error as Error).message}`);
  }

  if (!isJsonRpcMessage(parsed)) {
    throw new ProtocolError("Invalid JSON-RPC message shape.");
  }

  return parsed;
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return isJsonRpcRequest(value) || isJsonRpcNotification(value) || isJsonRpcSuccessResponse(value) || isJsonRpcErrorResponse(value);
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return isRecord(value) && value.jsonrpc === JSON_RPC_VERSION && typeof value.method === "string" && isJsonRpcId(value.id);
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return isRecord(value) && value.jsonrpc === JSON_RPC_VERSION && typeof value.method === "string" && !("id" in value);
}

export function isJsonRpcSuccessResponse(value: unknown): value is JsonRpcSuccessResponse {
  return isRecord(value) && value.jsonrpc === JSON_RPC_VERSION && "result" in value && isJsonRpcResponseId(value.id) && !("error" in value);
}

export function isJsonRpcErrorResponse(value: unknown): value is JsonRpcErrorResponse {
  return isRecord(value) && value.jsonrpc === JSON_RPC_VERSION && "error" in value && isJsonRpcResponseId(value.id);
}

export function isLineupMethod(value: string): value is LineupMethod {
  return value === "agent/spawn" || value === "gate/request" || value === "gate/respond" || value === "pipeline/cancel" || value === "agent/output" || value === "agent/done" || value === "agent/cancel" || value === "pipeline/complete";
}

export function toProtocolLogRecord(message: LineupProtocolMessage): ProtocolLogRecord {
  if (isJsonRpcErrorResponse(message)) {
    return {
      kind: "error",
      id: message.id,
      code: message.error.code,
      summary: messageSummary(message),
    };
  }

  if (isJsonRpcSuccessResponse(message)) {
    return {
      kind: "response",
      id: message.id,
      method: undefined,
      summary: messageSummary(message),
    };
  }

  if (isJsonRpcRequest(message)) {
    return {
      kind: "request",
      method: message.method as LineupRequestMethod,
      id: message.id,
      summary: messageSummary(message),
    };
  }

  return {
    kind: "notification",
    method: message.method as LineupNotificationMethod,
    summary: messageSummary(message),
  };
}

export function messageSummary(message: LineupProtocolMessage): string {
  if (isJsonRpcErrorResponse(message)) {
    return `error ${message.id ?? "null"} ${message.error.code} ${message.error.message}`;
  }

  if (isJsonRpcSuccessResponse(message)) {
    return `response ${message.id ?? "null"} ok`;
  }

  if (isJsonRpcRequest(message)) {
    return `request ${message.method}#${message.id}`;
  }

  return `notification ${message.method}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function isJsonRpcResponseId(value: unknown): value is JsonRpcResponseId {
  return value === null || isJsonRpcId(value);
}
