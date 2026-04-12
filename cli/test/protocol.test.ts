import { describe, expect, it } from "vitest";

import {
  JSON_RPC_ERROR,
  createJsonRpcErrorResponse,
  encodeNdjsonMessages,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  messageSummary,
  parseJsonRpcMessage,
  parseNdjsonMessages,
  toProtocolLogRecord,
} from "../src/lib/protocol.js";
import { protocolFixtures, protocolWireFlow, protocolWireNdjson } from "./protocol.fixtures.js";

describe("protocol transport primitives", () => {
  it("round-trips JSON-RPC fixtures", () => {
    const messages = [
      protocolFixtures.spawn.request,
      protocolFixtures.spawn.response,
      protocolFixtures.output,
      protocolFixtures.done,
      protocolFixtures.gate.request,
      protocolFixtures.gate.response,
      protocolFixtures.cancel.notification,
      protocolFixtures.cancel.request,
      protocolFixtures.cancel.response,
      protocolFixtures.complete,
      protocolFixtures.timeoutError,
      protocolFixtures.cancelError,
    ];

    for (const message of messages) {
      const encoded = JSON.stringify(message);
      const decoded = parseJsonRpcMessage(encoded);

      expect(decoded).toEqual(message);
    }
  });

  it("serializes and parses the Lineup NDJSON wire flow", () => {
    const encoded = encodeNdjsonMessages(protocolWireFlow);

    expect(encoded).toBe(protocolWireNdjson);
    expect(parseNdjsonMessages(encoded)).toEqual([...protocolWireFlow]);
  });

  it("keeps request correlation and structured log summaries intact", () => {
    const spawnRequest = protocolFixtures.spawn.request;
    const spawnResponse = protocolFixtures.spawn.response;
    const gateRequest = protocolFixtures.gate.request;
    const gateResponse = protocolFixtures.gate.response;
    const cancelRequest = protocolFixtures.cancel.request;
    const cancelResponse = protocolFixtures.cancel.response;

    expect(isJsonRpcRequest(spawnRequest)).toBe(true);
    expect(isJsonRpcSuccessResponse(spawnResponse)).toBe(true);
    expect(isJsonRpcRequest(gateRequest)).toBe(true);
    expect(isJsonRpcSuccessResponse(gateResponse)).toBe(true);
    expect(isJsonRpcRequest(cancelRequest)).toBe(true);
    expect(isJsonRpcSuccessResponse(cancelResponse)).toBe(true);

    expect(spawnResponse.id).toBe(spawnRequest.id);
    expect(gateResponse.id).toBe(gateRequest.id);
    expect(cancelResponse.id).toBe(cancelRequest.id);

    expect(toProtocolLogRecord(spawnRequest)).toEqual({
      kind: "request",
      method: "agent/spawn",
      id: 1,
      summary: "request agent/spawn#1",
    });
    expect(toProtocolLogRecord(protocolFixtures.output)).toEqual({
      kind: "notification",
      method: "agent/output",
      summary: "notification agent/output",
    });
    expect(toProtocolLogRecord(spawnResponse)).toEqual({
      kind: "response",
      id: 1,
      summary: "response 1 ok",
    });
  });

  it("represents timeout and cancellation errors explicitly", () => {
    expect(isJsonRpcErrorResponse(protocolFixtures.timeoutError)).toBe(true);
    expect(isJsonRpcErrorResponse(protocolFixtures.cancelError)).toBe(true);

    expect(protocolFixtures.timeoutError.error.code).toBe(JSON_RPC_ERROR.requestTimeout);
    expect(protocolFixtures.cancelError.error.code).toBe(JSON_RPC_ERROR.requestCancelled);

    expect(messageSummary(protocolFixtures.timeoutError)).toBe("error 4 -32801 Request timed out.");
    expect(messageSummary(protocolFixtures.cancelError)).toBe("error 5 -32800 Request cancelled.");
    expect(toProtocolLogRecord(protocolFixtures.timeoutError)).toEqual({
      kind: "error",
      id: 4,
      code: JSON_RPC_ERROR.requestTimeout,
      summary: "error 4 -32801 Request timed out.",
    });
  });

  it("rejects malformed NDJSON and invalid JSON-RPC payloads", () => {
    expect(() => parseJsonRpcMessage("{not-json}")).toThrow();
    expect(() => parseJsonRpcMessage(JSON.stringify({ jsonrpc: "2.0", id: 1 }))).toThrow();
    expect(() => parseNdjsonMessages("not-json\n")).toThrow();
  });
});
