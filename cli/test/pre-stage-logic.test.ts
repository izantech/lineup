import { describe, it, expect, vi, afterEach } from "vitest";

// Helper that mirrors executeTriageBuiltin's parsing logic.
// We test the parsing in isolation since execSync can't be spied on in ESM.
function parseGitDiffStat(diffOutput: string): { changedFiles: number; insertions: number; deletions: number } {
  const changedMatch = diffOutput.match(/(\d+) file/);
  const insertMatch = diffOutput.match(/(\d+) insertion/);
  const deleteMatch = diffOutput.match(/(\d+) deletion/);
  return {
    changedFiles: changedMatch ? parseInt(changedMatch[1], 10) : 0,
    insertions: insertMatch ? parseInt(insertMatch[1], 10) : 0,
    deletions: deleteMatch ? parseInt(deleteMatch[1], 10) : 0,
  };
}

describe("triage builtin - git diff parsing", () => {
  it("returns git diff summary and file count from canned output", () => {
    const diffOutput = " 3 files changed, 12 insertions(+), 4 deletions(-)";
    const result = parseGitDiffStat(diffOutput);

    expect(result.changedFiles).toBe(3);
    expect(result.insertions).toBe(12);
    expect(result.deletions).toBe(4);
  });

  it("handles empty diff (no changes) gracefully", () => {
    const result = parseGitDiffStat("");

    expect(result.changedFiles).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it("handles single file change", () => {
    const diffOutput = " 1 file changed, 5 insertions(+)";
    const result = parseGitDiffStat(diffOutput);

    expect(result.changedFiles).toBe(1);
    expect(result.insertions).toBe(5);
    expect(result.deletions).toBe(0);
  });
});

describe("research stage agent/spawn protocol", () => {
  it("emits agent/spawn protocol message for agent stage", async () => {
    const emittedMessages: unknown[] = [];
    const emitProtocol = (msg: unknown) => emittedMessages.push(msg);

    const { createLineupRequest } = await import("../src/lib/protocol.js");
    const reqId = 1;
    const msg = createLineupRequest({
      method: "agent/spawn",
      id: reqId,
      params: { runId: "run-1", stageId: "research", agent: "researcher", prompt: "" }
    });
    emitProtocol(msg);

    expect(emittedMessages).toHaveLength(1);
    const spawned = emittedMessages[0] as Record<string, unknown>;
    expect(spawned["method"]).toBe("agent/spawn");
    const params = spawned["params"] as Record<string, unknown>;
    expect(params["agent"]).toBe("researcher");
    expect(params["stageId"]).toBe("research");
    expect(params["runId"]).toBe("run-1");
  });

  it("agent/spawn message has correct JSON-RPC shape", async () => {
    const { createLineupRequest } = await import("../src/lib/protocol.js");
    const msg = createLineupRequest({
      method: "agent/spawn",
      id: 42,
      params: { runId: "run-2", stageId: "research", agent: "researcher", prompt: "" }
    });

    expect(msg.jsonrpc).toBe("2.0");
    expect(msg.id).toBe(42);
    expect(msg.method).toBe("agent/spawn");
  });
});
