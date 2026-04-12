import {
  JSON_RPC_ERROR,
  createJsonRpcErrorResponse,
  createLineupNotification,
  createLineupRequest,
  createLineupResponse,
  encodeNdjsonMessages,
} from "../src/lib/protocol.js";

export const protocolFixtures = {
  spawn: {
    request: createLineupRequest({
      method: "agent/spawn",
      id: 1,
      params: {
        runId: "run-001",
        stageId: "plan",
        agent: "architect",
        prompt: "Draft an implementation plan.",
        inputs: {
          constitution: "constitution.yaml",
          spec: "spec.yaml",
        },
        outputs: {
          plan: "plan.yaml",
        },
        timeoutMs: 300000,
        retryAttempt: 0,
      },
    }),
    response: createLineupResponse({
      method: "agent/spawn",
      id: 1,
      result: {
        accepted: true,
        workerId: "worker-plan-1",
      },
    }),
  },
  output: createLineupNotification({
    method: "agent/output",
    params: {
      runId: "run-001",
      stageId: "implement",
      channel: "stdout",
      sequence: 1,
      chunk: "Starting implementation",
      final: false,
    },
  }),
  done: createLineupNotification({
    method: "agent/done",
    params: {
      runId: "run-001",
      stageId: "implement",
      status: "success",
      summary: "Implementation completed successfully.",
      outputs: {
        diff: "patch.diff",
      },
    },
  }),
  gate: {
    request: createLineupRequest({
      method: "gate/request",
      id: 2,
      params: {
        runId: "run-001",
        stageId: "approval",
        question: "Approve the plan?",
        choices: ["approve", "revise"],
        defaultChoice: "approve",
      },
    }),
    response: createLineupResponse({
      method: "gate/request",
      id: 2,
      result: {
        approved: true,
        choice: "approve",
      },
    }),
  },
  cancel: {
    notification: createLineupNotification({
      method: "agent/cancel",
      params: {
        runId: "run-001",
        stageId: "verify",
        reason: "user-request",
      },
    }),
    request: createLineupRequest({
      method: "pipeline/cancel",
      id: 3,
      params: {
        runId: "run-001",
        reason: "timeout",
        stageId: "implement",
      },
    }),
    response: createLineupResponse({
      method: "pipeline/cancel",
      id: 3,
      result: {
        cancelled: true,
      },
    }),
  },
  complete: createLineupNotification({
    method: "pipeline/complete",
    params: {
      runId: "run-001",
      status: "success",
      completedAt: "2026-04-12T10:00:00.000Z",
      summary: "Run completed successfully.",
      artifacts: {
        plan: "plan.yaml",
        review: "review.yaml",
      },
    },
  }),
  timeoutError: createJsonRpcErrorResponse({
    id: 4,
    code: JSON_RPC_ERROR.requestTimeout,
    message: "Request timed out.",
    data: {
      runId: "run-001",
      stageId: "implement",
      timeoutMs: 300000,
    },
  }),
  cancelError: createJsonRpcErrorResponse({
    id: 5,
    code: JSON_RPC_ERROR.requestCancelled,
    message: "Request cancelled.",
    data: {
      runId: "run-001",
      stageId: "implement",
    },
  }),
} as const;

export const protocolWireFlow = [
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
] as const;

export const protocolWireNdjson = encodeNdjsonMessages(protocolWireFlow);
