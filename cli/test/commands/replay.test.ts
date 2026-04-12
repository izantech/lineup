import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createArtifactStore } from "../../src/lib/artifact-store.js";
import { lineupRunDir } from "../../src/lib/paths.js";
import { savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";
import { runReplayCommand } from "../../src/commands/replay.js";
import { createLineupRequest, createLineupNotification } from "../../src/lib/protocol.js";

describe("lineup replay", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-replay-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeState(runId: string, protocolHash: string): PipelineStateRecord {
    return {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: runId,
      status: "succeeded",
      workflow: "workflows/full.yaml",
      artifact_hashes: { protocol: protocolHash },
      updated_at: "2026-04-12T12:00:00.000Z"
    };
  }

  it("outputs narrative lines for stage transitions in order", async () => {
    const store = createArtifactStore(join(tempDir, ".lineup", ".artifacts"));

    const messages = [
      createLineupRequest({ method: "agent/spawn", id: 1, params: { runId: "r1", stageId: "triage", agent: "researcher", prompt: "go" } }),
      createLineupNotification({ method: "agent/done", params: { runId: "r1", stageId: "triage", status: "success" } }),
      createLineupNotification({ method: "pipeline/complete", params: { runId: "r1", status: "success" } }),
    ];

    const ndjson = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
    const record = store.persistJson("protocol", messages);

    mkdirSync(lineupRunDir("r1", tempDir), { recursive: true });
    savePipelineState(makeState("r1", record.sha256), tempDir);

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await runReplayCommand({ runId: "r1" }, tempDir);

    const lines = output.join("").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatch(/Stage "triage" started/);
    expect(lines[1]).toMatch(/Stage "triage" completed/);
    expect(lines[2]).toMatch(/Pipeline completed/);
  });

  it("outputs gate events including gate respond decisions", async () => {
    const store = createArtifactStore(join(tempDir, ".lineup", ".artifacts"));

    const messages = [
      createLineupRequest({ method: "gate/request", id: 2, params: { runId: "r2", stageId: "approval", gateType: "approval", question: "Approve?", choices: ["yes", "no"] } }),
      { jsonrpc: "2.0" as const, id: 2, result: { approved: true, choice: "yes" } },
    ];

    const record = store.persistJson("protocol", messages);

    mkdirSync(lineupRunDir("r2", tempDir), { recursive: true });
    savePipelineState(makeState("r2", record.sha256), tempDir);

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await runReplayCommand({ runId: "r2" }, tempDir);

    const lines = output.join("").split("\n").filter(Boolean);
    expect(lines.some((l) => l.includes("Gate") && l.includes("approval"))).toBe(true);
    expect(lines.some((l) => l.includes("Gate responded") && l.includes("approved"))).toBe(true);
  });

  it("--json flag outputs structured array", async () => {
    const store = createArtifactStore(join(tempDir, ".lineup", ".artifacts"));

    const messages = [
      createLineupRequest({ method: "agent/spawn", id: 1, params: { runId: "r3", stageId: "build", agent: "researcher", prompt: "go" } }),
      createLineupNotification({ method: "agent/done", params: { runId: "r3", stageId: "build", status: "success" } }),
    ];

    const record = store.persistJson("protocol", messages);

    mkdirSync(lineupRunDir("r3", tempDir), { recursive: true });
    savePipelineState(makeState("r3", record.sha256), tempDir);

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await runReplayCommand({ runId: "r3", json: true }, tempDir);

    const raw = output.join("");
    const parsed = JSON.parse(raw) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect((parsed[0] as { label: string }).label).toMatch(/Stage "build" started/);
    expect((parsed[1] as { label: string }).label).toMatch(/Stage "build" completed/);
  });
});
