import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDagCommand } from "../../src/commands/dag.js";

let tempDir: string;
let stdout: string[];

const WORKFLOW_YAML = `
apiVersion: lineup/v3
kind: Workflow
name: test-pipeline
stages:
  - id: triage
    type: builtin
  - id: research
    type: agent
    agent: researcher
    depends_on: [triage]
  - id: plan
    type: agent
    agent: architect
    depends_on: [research]
  - id: document
    type: agent
    agent: documenter
    depends_on: [plan]
    optional: true
`.trim();

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-dag-"));
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("dag command", () => {
  it("prints ASCII output with wave labels", async () => {
    const file = join(tempDir, "workflow.yaml");
    writeFileSync(file, WORKFLOW_YAML);

    await runDagCommand({ workflow: file });

    const output = stdout.join("");
    expect(output).toContain("Wave 1");
    expect(output).toContain("triage");
    expect(output).toContain("research");
    expect(output).toContain("document (optional)");
  });

  it("outputs JSON with waves and stages arrays", async () => {
    const file = join(tempDir, "workflow.yaml");
    writeFileSync(file, WORKFLOW_YAML);

    await runDagCommand({ workflow: file, json: true });

    const output = JSON.parse(stdout.join(""));
    expect(Array.isArray(output.waves)).toBe(true);
    expect(Array.isArray(output.stages)).toBe(true);
    expect(output.waves.length).toBe(4);
    expect(output.stages.length).toBe(4);
    expect(output.stages[0].id).toBe("triage");
  });

  it("throws when workflow file not found", async () => {
    await expect(
      runDagCommand({ workflow: join(tempDir, "missing.yaml") })
    ).rejects.toThrow(/File not found/);
  });
});
