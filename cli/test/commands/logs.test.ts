import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArtifactStore } from "../../src/lib/artifact-store.js";
import { lineupRunDir, lineupRunDebugBundleFile } from "../../src/lib/paths.js";
import { loadPipelineState, savePipelineState, type PipelineStateRecord } from "../../src/lib/state.js";

describe("lineup logs", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-logs-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads protocol artifact from the store", () => {
    const store = createArtifactStore(join(tempDir, ".lineup", ".artifacts"));
    const ndjson = '{"event":"start"}\n{"event":"end"}\n';
    const record = store.persistJson("protocol", [{ event: "start" }, { event: "end" }]);

    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "logs-run-1",
      status: "succeeded",
      workflow: "workflows/full.yaml",
      artifact_hashes: { protocol: record.sha256 },
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("logs-run-1", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const loaded = loadPipelineState("logs-run-1", tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.artifact_hashes.protocol).toBe(record.sha256);

    const content = store.readText({ kind: "protocol", format: "json", sha256: record.sha256 });
    expect(content).toContain("start");
  });

  it("detects debug bundle file", () => {
    const state: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "logs-run-2",
      status: "failed",
      workflow: "workflows/full.yaml",
      artifact_hashes: {},
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("logs-run-2", tempDir), { recursive: true });
    savePipelineState(state, tempDir);

    const bundlePath = lineupRunDebugBundleFile("logs-run-2", tempDir);
    writeFileSync(bundlePath, JSON.stringify({ error: "timeout" }), "utf8");

    const loaded = loadPipelineState("logs-run-2", tempDir);
    expect(loaded).not.toBeNull();
  });
});
