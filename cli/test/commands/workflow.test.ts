import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWorkflowLintCommand, runWorkflowListCommand } from "../../src/commands/workflow.js";

let tempDir: string;
let stdout: string[];
let originalCwd: string;

const VALID_WORKFLOW = `apiVersion: lineup/v3
kind: Workflow
name: test-workflow
description: A test workflow
stages:
  - id: research
    type: agent
    agent: researcher
  - id: plan
    type: agent
    agent: architect
    depends_on:
      - research
`;

const INVALID_WORKFLOW = `apiVersion: lineup/v3
kind: Workflow
name: bad
`;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-workflow-"));
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  originalCwd = process.cwd();
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("workflow lint", () => {
  it("validates a correct workflow", async () => {
    const file = join(tempDir, "good.yaml");
    writeFileSync(file, VALID_WORKFLOW);

    await runWorkflowLintCommand({ path: file });

    const output = stdout.join("");
    expect(output).toContain("Valid workflow: test-workflow");
    expect(output).toContain("2 stages");
    expect(output).toContain("2 waves");
  });

  it("reports errors for invalid workflow", async () => {
    const file = join(tempDir, "bad.yaml");
    writeFileSync(file, INVALID_WORKFLOW);

    await runWorkflowLintCommand({ path: file });

    const output = stdout.join("");
    expect(output).toContain("failed schema validation");
  });

  it("supports --json on valid workflow", async () => {
    const file = join(tempDir, "good.yaml");
    writeFileSync(file, VALID_WORKFLOW);

    await runWorkflowLintCommand({ path: file, json: true });

    const output = JSON.parse(stdout.join(""));
    expect(output.valid).toBe(true);
    expect(output.stages).toBe(2);
    expect(output.waves).toBe(2);
  });

  it("supports --json on invalid workflow", async () => {
    const file = join(tempDir, "bad.yaml");
    writeFileSync(file, INVALID_WORKFLOW);

    await runWorkflowLintCommand({ path: file, json: true });

    const output = JSON.parse(stdout.join(""));
    expect(output.valid).toBe(false);
    expect(output.errors.length).toBeGreaterThan(0);
  });

  it("throws on missing file", async () => {
    await expect(
      runWorkflowLintCommand({ path: join(tempDir, "nope.yaml") })
    ).rejects.toThrow(/File not found/);
  });
});

describe("workflow list", () => {
  it("lists workflows from .lineup-core/workflows", async () => {
    const dir = join(tempDir, ".lineup-core", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pipe.yaml"), VALID_WORKFLOW);

    await runWorkflowListCommand({});

    const output = stdout.join("");
    expect(output).toContain("pipe.yaml");
    expect(output).toContain("test-workflow");
  });

  it("supports --json", async () => {
    const dir = join(tempDir, ".lineup-core", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pipe.yaml"), VALID_WORKFLOW);

    await runWorkflowListCommand({ json: true });

    const output = JSON.parse(stdout.join(""));
    expect(output).toHaveLength(1);
    expect(output[0].name).toBe("test-workflow");
    expect(output[0].stages).toBe(2);
  });

  it("prints message when no workflows found", async () => {
    await runWorkflowListCommand({});

    const output = stdout.join("");
    expect(output).toContain("No workflows found");
  });
});
