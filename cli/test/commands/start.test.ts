import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedRunRunCommand = vi.hoisted(() => vi.fn());

vi.mock("../../src/commands/run.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/commands/run.js")>("../../src/commands/run.js");
  return {
    ...actual,
    runRunCommand: mockedRunRunCommand
  };
});

import { runStartCommand } from "../../src/commands/start.js";

describe("lineup start", () => {
  let tempDir = "";
  let stdout: string[];
  let originalCwd = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-start-test-"));
    stdout = [];
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
    mockedRunRunCommand.mockReset();
    mockedRunRunCommand.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("scaffolds the repo and stops with exact commit guidance before the first run", async () => {
    await runStartCommand({ prompt: "Ship the first version" });

    expect(existsSync(join(tempDir, ".lineup-core", "workflows", "full-pipeline.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, ".git"))).toBe(true);
    expect(stdout.join("")).toContain("Prepared Lineup project scaffolding for this repo.");
    expect(stdout.join("")).toContain("native runs need one initial git commit");
    expect(stdout.join("")).toContain('next: git add -A && git commit -m "Initial commit"');
    expect(stdout.join("")).toContain("then: lineup start 'Ship the first version'");
    expect(mockedRunRunCommand).not.toHaveBeenCalled();
  });

  it("runs the pipeline once init and git prerequisites are satisfied", async () => {
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'lineup@example.com'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.name 'Lineup Tests'", { cwd: tempDir, stdio: "ignore" });
    writeFileSync(join(tempDir, "README.md"), "# Lineup\n");
    mkdirSync(join(tempDir, ".lineup-core", "workflows"), { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup-core", "workflows", "full-pipeline.yaml"),
      "apiVersion: lineup/v3\nkind: Workflow\nname: full-pipeline\nstages: []\n"
    );
    execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
    execSync("git commit -m 'Initial commit'", { cwd: tempDir, stdio: "ignore" });

    await runStartCommand({ prompt: "Ship the next version", host: "codex", approvePlan: true });

    expect(mockedRunRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Ship the next version",
        host: "codex",
        approvePlan: true
      })
    );
  });

  it("rejects an explicit missing workflow path before running", async () => {
    await expect(runStartCommand({ prompt: "Ship it", workflow: "missing.yaml" })).rejects.toThrow(
      "Workflow not found: missing.yaml"
    );
  });
});
