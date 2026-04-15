import { describe, it, expect, vi, afterEach } from "vitest";
import process from "node:process";

// Mock readline/promises before importing the module under test
vi.mock("node:readline/promises", () => {
  return {
    createInterface: vi.fn()
  };
});

import { createInterface } from "node:readline/promises";
import { handleInteractiveGate } from "../src/lib/interactive-gate.js";
import type { PendingGate } from "../src/lib/gate-store.js";

function makeMockRl(answers: string[]) {
  let callIndex = 0;
  return {
    question: vi.fn().mockImplementation(() => Promise.resolve(answers[callIndex++] ?? "")),
    close: vi.fn()
  };
}

function makeGate(overrides: Partial<PendingGate> = {}): PendingGate {
  return {
    requestId: 1,
    gateType: "approval",
    question: "Approve the plan?",
    choices: ["approve", "reject"],
    defaultChoice: "approve",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleInteractiveGate", () => {
  it("approval gate: empty input defaults to approved", async () => {
    const mockRl = makeMockRl([""]);
    vi.mocked(createInterface).mockReturnValue(mockRl as never);

    const gate = makeGate({ gateType: "approval" });
    const response = await handleInteractiveGate(gate);

    expect(response.requestId).toBe(1);
    expect(response.choice).toBe("approve");
    expect(createInterface).toHaveBeenCalledWith(expect.objectContaining({ output: process.stderr }));
    expect(mockRl.close).toHaveBeenCalled();
  });

  it("approval gate: 'n' input results in reject", async () => {
    const mockRl = makeMockRl(["n"]);
    vi.mocked(createInterface).mockReturnValue(mockRl as never);

    const gate = makeGate({ gateType: "approval" });
    const response = await handleInteractiveGate(gate);

    expect(response.choice).toBe("reject");
  });

  it("approval gate prints context before the prompt", async () => {
    const mockRl = makeMockRl([""]);
    vi.mocked(createInterface).mockReturnValue(mockRl as never);

    const gate = makeGate({
      gateType: "approval",
      context: "Plan artifact: /tmp/plan.yaml\n\nsummary: Improve the TUI"
    });
    await handleInteractiveGate(gate);

    expect(mockRl.question).toHaveBeenCalledWith("Approve? [Y/n]: ");
  });

  it("clarify gate: captures free-text input", async () => {
    const mockRl = makeMockRl(["Please clarify the scope"]);
    vi.mocked(createInterface).mockReturnValue(mockRl as never);

    const gate = makeGate({ gateType: "clarify", question: "What needs clarification?", choices: [] });
    const response = await handleInteractiveGate(gate);

    expect(response.choice).toBe("Please clarify the scope");
  });

  it("verify-decision gate: choice '1' maps to retry", async () => {
    const mockRl = makeMockRl(["1"]);
    vi.mocked(createInterface).mockReturnValue(mockRl as never);

    const gate = makeGate({
      gateType: "verify-decision",
      question: "Review failed. How to proceed?",
      choices: ["retry", "accept", "abort"]
    });
    const response = await handleInteractiveGate(gate);

    expect(response.choice).toBe("retry");
  });
});
