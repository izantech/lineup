import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedIsInteractive = vi.hoisted(() => vi.fn());
const mockedQuestion = vi.hoisted(() => vi.fn());
const mockedClose = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/prompts.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/prompts.js")>("../../src/lib/prompts.js");
  return {
    ...actual,
    isInteractive: mockedIsInteractive
  };
});

vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: mockedQuestion,
      close: mockedClose
    }))
  }
}));

import { createConfigReport, runConfigCommand } from "../../src/commands/config.js";

let tempDir: string;
let stdout: string[];
let originalCwd: string;
let originalPath: string | undefined;

function writeExecutable(binDir: string, name: string): void {
  const filePath = join(binDir, name);
  writeFileSync(filePath, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(filePath, 0o755);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-config-"));
  stdout = [];
  mockedIsInteractive.mockReset();
  mockedQuestion.mockReset();
  mockedClose.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  originalCwd = process.cwd();
  originalPath = process.env.PATH;
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env.PATH = originalPath;
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("config command", () => {
  it("reports effective host, project config, and ollama settings as json", async () => {
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeExecutable(binDir, "codex");
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    mkdirSync(join(tempDir, ".lineup"), { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup", "config.yaml"),
      `models:\n  haiku: gpt-4.1-mini\nollama:\n  enabled: true\n  model: qwen3-coder:30b\n  scope: research\n`,
      "utf8"
    );

    mkdirSync(join(homeDir, ".codex", "lineup"), { recursive: true });
    writeFileSync(
      join(homeDir, ".codex", "lineup", "ollama.yaml"),
      `enabled: true\nmodel: qwen3-coder:30b\nscope: research\nhost_integration:\n  enabled: true\n  strategy: auto\n`,
      "utf8"
    );

    const report = createConfigReport({ host: "codex" }, tempDir, homeDir);

    expect(report.hostResolution.resolved).toBe("codex");
    expect(report.projectConfig.exists).toBe(true);
    expect(report.modelRouting.haiku).toBe("gpt-4.1-mini");
    expect(report.ollama?.model).toBe("qwen3-coder:30b");
    expect(report.ollama?.hostIntegration?.enabled).toBe(true);
  });

  it("prints a readable summary in show mode", async () => {
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeExecutable(binDir, "claude");
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    await runConfigCommand({ host: "claude", mode: "show" });

    const output = stdout.join("");
    expect(output).toContain("requested_host: claude");
    expect(output).toContain("resolved_host: claude");
    expect(output).toContain("model_routing:");
    expect(output).toContain("agents:");
    expect(output).toContain("ollama:");
  });

  it("edits and saves the project config in interactive mode", async () => {
    mockedIsInteractive.mockReturnValue(true);
    mockedQuestion
      .mockResolvedValueOnce("set ollama.enabled true")
      .mockResolvedValueOnce("set ollama.model qwen3-coder:30b")
      .mockResolvedValueOnce("set models.haiku gpt-5-mini")
      .mockResolvedValueOnce("save");

    await runConfigCommand({ mode: "edit" });

    const saved = readFileSync(join(tempDir, ".lineup", "config.yaml"), "utf8");
    expect(saved).toContain("ollama:");
    expect(saved).toContain("enabled: true");
    expect(saved).toContain("model: qwen3-coder:30b");
    expect(saved).toContain("haiku: gpt-5-mini");
    expect(stdout.join("")).toContain("Saved project config:");
    expect(mockedClose).toHaveBeenCalled();
  });
});
