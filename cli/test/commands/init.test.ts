import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedIsInteractive = vi.hoisted(() => vi.fn());
const mockedRunConfigCommand = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/prompts.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/prompts.js")>("../../src/lib/prompts.js");
  return {
    ...actual,
    isInteractive: mockedIsInteractive
  };
});

vi.mock("../../src/commands/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/commands/config.js")>("../../src/commands/config.js");
  return {
    ...actual,
    runConfigCommand: mockedRunConfigCommand
  };
});

import { runInitCommand } from "../../src/commands/init.js";

let tempDir: string;
let stdout: string[];
let originalCwd: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-init-"));
  stdout = [];
  mockedIsInteractive.mockReset();
  mockedRunConfigCommand.mockReset();
  mockedRunConfigCommand.mockResolvedValue(undefined);
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

describe("init command", () => {
  it("creates all expected directories and files from scratch", async () => {
    mockedIsInteractive.mockReturnValue(false);

    await runInitCommand({});

    expect(existsSync(join(tempDir, ".git"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup", ".runs"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup", ".cache"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup", ".artifacts"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup", ".ephemeral"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup", "tactics"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup-core", "workflows", "full-pipeline.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup", "tactics", "example.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, ".lineup", ".gitignore"))).toBe(true);

    const gitignore = readFileSync(join(tempDir, ".lineup", ".gitignore"), "utf8");
    expect(gitignore).toContain(".runs/");
    expect(gitignore).toContain("runtime.lock");
    expect(gitignore).toContain("config.yaml");
    expect(gitignore).toContain("tactics/example.yaml");

    const output = stdout.join("");
    expect(output).toContain("created:");
    expect(output).toContain(".git");
    expect(output).toContain("Initial commit");
  });

  it("opens the config editor on the first interactive initialization", async () => {
    mockedIsInteractive.mockReturnValue(true);

    await runInitCommand({});

    expect(mockedRunConfigCommand).toHaveBeenCalledWith({ mode: "edit" });
  });

  it("is idempotent and does not reopen the config editor on repeated init", async () => {
    mockedIsInteractive.mockReturnValue(true);

    await runInitCommand({});
    stdout.length = 0;
    mockedRunConfigCommand.mockClear();

    await runInitCommand({});

    const output = stdout.join("");
    expect(output).not.toContain("created:");
    expect(output).toContain("already exists:");
    expect(output).toContain(".git");
    expect(mockedRunConfigCommand).not.toHaveBeenCalled();
  });

  it("json output contains created/skipped entries and never launches the editor", async () => {
    mockedIsInteractive.mockReturnValue(true);

    await runInitCommand({ json: true });

    const parsed = JSON.parse(stdout.join("")) as Array<{ status: string; path: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((e) => e.status === "created")).toBe(true);
    expect(parsed.some((entry) => entry.path.endsWith("/.git"))).toBe(true);
    expect(mockedRunConfigCommand).not.toHaveBeenCalled();

    stdout.length = 0;
    await runInitCommand({ json: true });

    const second = JSON.parse(stdout.join("")) as Array<{ status: string; path: string }>;
    expect(second.every((e) => e.status === "already_exists")).toBe(true);
    expect(second.some((entry) => entry.path.endsWith("/.git"))).toBe(true);
    expect(mockedRunConfigCommand).not.toHaveBeenCalled();
  });
});
