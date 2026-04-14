import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runTacticConvertCommand, runTacticNewCommand, runTacticListCommand } from "../../src/commands/tactic.js";

let tempDir: string;
let stdout: string[];
let originalCwd: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-tactic-"));
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

describe("tactic new", () => {
  it("creates a scaffold file", async () => {
    await runTacticNewCommand({ name: "my-tactic" });

    const filePath = join(tempDir, ".lineup", "tactics", "my-tactic.yaml");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("name: my-tactic");
    expect(content).toContain("kind: Tactic");
    expect(content).toContain("apiVersion: lineup/v3");

    const output = stdout.join("");
    expect(output).toContain(filePath);
  });

  it("rejects duplicate tactic", async () => {
    await runTacticNewCommand({ name: "dup" });

    await expect(
      runTacticNewCommand({ name: "dup" })
    ).rejects.toThrow(/Tactic already exists/);
  });

  it("creates .lineup/tactics/ directory if missing", async () => {
    const tacticsDir = join(tempDir, ".lineup", "tactics");
    expect(existsSync(tacticsDir)).toBe(false);

    await runTacticNewCommand({ name: "fresh" });

    expect(existsSync(tacticsDir)).toBe(true);
  });
});

describe("tactic list", () => {
  it("lists tactics from .lineup/tactics", async () => {
    const dir = join(tempDir, ".lineup", "tactics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "example.yaml"), `apiVersion: lineup/v3
kind: Tactic
name: example
description: An example tactic
stages:
  - type: agent
    agent: researcher
    prompt: "do research"
`);

    await runTacticListCommand({});

    const output = stdout.join("");
    expect(output).toContain("example");
    expect(output).toContain("An example tactic");
  });

  it("supports --json", async () => {
    const dir = join(tempDir, ".lineup", "tactics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "example.yaml"), `apiVersion: lineup/v3
kind: Tactic
name: example
description: An example tactic
stages:
  - type: agent
    agent: researcher
    prompt: "do research"
`);

    await runTacticListCommand({ json: true });

    const output = JSON.parse(stdout.join(""));
    expect(output).toHaveLength(1);
    expect(output[0].name).toBe("example");
    expect(output[0].stages).toBe(1);
  });

  it("prints message when no tactics found", async () => {
    await runTacticListCommand({});

    const output = stdout.join("");
    expect(output).toContain("No tactics found");
  });
});

describe("tactic convert", () => {
  it("resolves bundled tactics when the project does not define one", async () => {
    await runTacticConvertCommand({ name: "explain", json: true });

    const output = JSON.parse(stdout.join(""));
    expect(output.name).toBe("explain");
    expect(output.stages).toEqual([
      expect.objectContaining({ id: "research", agent: "researcher" }),
      expect.objectContaining({ id: "explain", agent: "teacher" }),
      expect.objectContaining({ id: "verify", agent: "reviewer" })
    ]);
  });
});
