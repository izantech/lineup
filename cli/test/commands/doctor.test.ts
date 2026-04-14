import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDoctorCommand } from "../../src/commands/doctor.js";
import { runInitCommand } from "../../src/commands/init.js";

let tempDir: string;
let stdout: string[];
let originalCwd: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-doctor-"));
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

describe("doctor command", () => {
  it("reports missing workflow and git prerequisites for a fresh directory", async () => {
    await runDoctorCommand({ json: true });

    const report = JSON.parse(stdout.join("")) as {
      healthy: boolean;
      checks: {
        project: {
          workflow: { ok: boolean; detail: string };
          git_repository: { ok: boolean; detail: string };
          git_head: { ok: boolean; detail: string };
          next_commands: Array<{ label: string; command: string; detail: string }>;
        };
      };
    };

    expect(report.healthy).toBe(false);
    expect(report.checks.project.workflow.ok).toBe(false);
    expect(report.checks.project.git_repository.ok).toBe(false);
    expect(report.checks.project.git_head.ok).toBe(false);
    expect(report.checks.project.next_commands).toEqual([
      {
        label: "scaffold the Lineup workflow and git repo",
        command: "lineup init",
        detail: "creates .lineup-core/workflows/full-pipeline.yaml and initializes git if needed"
      }
    ]);
  });

  it("reports a runnable project after init and initial commit", async () => {
    await runInitCommand({});
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'lineup@example.com'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.name 'Lineup Tests'", { cwd: tempDir, stdio: "ignore" });
    execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
    execSync("git commit -m 'Initial commit'", { cwd: tempDir, stdio: "ignore" });

    stdout.length = 0;
    await runDoctorCommand({ json: true });

    const report = JSON.parse(stdout.join("")) as {
      healthy: boolean;
      checks: {
        project: {
          workflow: { ok: boolean; detail: string };
          git_repository: { ok: boolean; detail: string };
          git_head: { ok: boolean; detail: string };
          next_commands: Array<{ label: string; command: string; detail: string }>;
        };
      };
    };

    expect(existsSync(join(tempDir, ".lineup-core", "workflows", "full-pipeline.yaml"))).toBe(true);
    expect(report.healthy).toBe(true);
    expect(report.checks.project.workflow.ok).toBe(true);
    expect(report.checks.project.git_repository.ok).toBe(true);
    expect(report.checks.project.git_head.ok).toBe(true);
    expect(report.checks.project.next_commands).toEqual([]);
  });

  it("recommends only the initial commit when the workflow exists but the repo has no commits", async () => {
    await runInitCommand({});
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    stdout.length = 0;
    await runDoctorCommand({ json: true });

    const report = JSON.parse(stdout.join("")) as {
      checks: {
        project: {
          workflow: { ok: boolean };
          git_repository: { ok: boolean };
          git_head: { ok: boolean };
          next_commands: Array<{ label: string; command: string; detail: string }>;
        };
      };
    };

    expect(report.checks.project.workflow.ok).toBe(true);
    expect(report.checks.project.git_repository.ok).toBe(true);
    expect(report.checks.project.git_head.ok).toBe(false);
    expect(report.checks.project.next_commands).toEqual([
      {
        label: "create the first commit",
        command: 'git add -A && git commit -m "Initial commit"',
        detail: "native Lineup runs require at least one commit"
      }
    ]);
  });
});
