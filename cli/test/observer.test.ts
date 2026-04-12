import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArtifactStore } from "../src/lib/artifact-store.js";
import { observeRuntimeStatus } from "../src/lib/observer.js";
import { lineupRunDir } from "../src/lib/paths.js";
import { savePipelineState, type PipelineStateRecord } from "../src/lib/state.js";

describe("observeRuntimeStatus", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-observer-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports the latest run and resolved artifact paths", () => {
    const artifactStore = createArtifactStore(join(tempDir, ".lineup", ".artifacts"));
    const planRecord = artifactStore.persistText(
      "plan",
      "apiVersion: lineup/v3\nkind: Plan\nstatus: approved\nsummary: ok\napproaches:\n  - name: native\n    strategy: execute\nrecommendation:\n  approach: native\n  rationale: ok\nchanges:\n  - file: cli/src/lib/run-pipeline.ts\n    change: update runtime\n    rationale: ok\nacceptance_criteria:\n  - criterion: ok\nrisks:\n  - risk: low\n    mitigation: test\n",
      "yaml"
    );

    const runState: PipelineStateRecord = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "abc123",
      status: "succeeded",
      workflow: ".lineup-core/workflows/full-pipeline.yaml",
      current_stage: "verify",
      completed_stages: ["triage", "plan", "implement", "verify"],
      artifact_hashes: {
        plan: planRecord.sha256
      },
      updated_at: "2026-04-12T12:00:00.000Z"
    };

    mkdirSync(lineupRunDir("abc123", tempDir), { recursive: true });
    savePipelineState(runState, tempDir);

    const runtime = observeRuntimeStatus(tempDir);

    expect(runtime.run_count).toBe(1);
    expect(runtime.latest_run?.run_id).toBe("abc123");
    expect(runtime.latest_run?.artifacts).toEqual([
      expect.objectContaining({
        kind: "plan",
        sha256: planRecord.sha256,
        exists: true
      })
    ]);
  });
});
