import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedRunPipeline = vi.hoisted(() => vi.fn());
const mockedCreateLocalAgentRunner = vi.hoisted(() => vi.fn());
const mockedIsInteractive = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/run-pipeline.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/run-pipeline.js")>("../../src/lib/run-pipeline.js");
  return {
    ...actual,
    runPipeline: mockedRunPipeline
  };
});

vi.mock("../../src/lib/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/agent-runner.js")>("../../src/lib/agent-runner.js");
  return {
    ...actual,
    createLocalAgentRunner: mockedCreateLocalAgentRunner
  };
});

vi.mock("../../src/lib/prompts.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/prompts.js")>("../../src/lib/prompts.js");
  return {
    ...actual,
    isInteractive: mockedIsInteractive
  };
});

import { runRunCommand } from "../../src/commands/run.js";

describe("run command", () => {
  let stderr: string[];
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-run-command-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
    mockedIsInteractive.mockReturnValue(true);
    mockedCreateLocalAgentRunner.mockReturnValue({ host: "codex" });
    mockedRunPipeline.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints explicit blocked-run recovery guidance in human mode", async () => {
    mockedRunPipeline.mockResolvedValue({
      runId: "run-blocked",
      status: "blocked",
      stageResults: new Map()
    });

    await runRunCommand({ prompt: "Ship it", mode: "human" });

    expect(stderr.join("")).toContain("lineup resume run-blocked");
    expect(stderr.join("")).toContain("lineup show run-blocked");
    expect(mockedRunPipeline).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Ship it",
      executionHost: undefined,
      runnerHost: "codex",
      forceOllamaBackend: false
    }), expect.anything());
  });

  it("uses the explicit ollama host with the selected runner", async () => {
    mockedCreateLocalAgentRunner.mockReturnValue({ host: "codex" });
    mockedRunPipeline.mockResolvedValue({
      runId: "run-ok",
      status: "success",
      stageResults: new Map()
    });

    await runRunCommand({ prompt: "Ship it", mode: "human", host: "ollama", runner: "codex", model: "qwen3-coder:30b" });

    expect(mockedCreateLocalAgentRunner).toHaveBeenCalledWith("codex", { forceOllamaBackend: true });
    expect(stderr.join("")).toContain("Using local host 'ollama' with runner 'codex'");
    expect(mockedRunPipeline).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Ship it",
      host: "codex",
      executionHost: "ollama",
      runnerHost: "codex",
      forceOllamaBackend: true,
      model: "qwen3-coder:30b"
    }), expect.anything());
  });

  it("rejects --runner unless --host ollama is selected", async () => {
    await expect(
      runRunCommand({ prompt: "Ship it", mode: "human", host: "codex", runner: "claude" })
    ).rejects.toThrow("--runner is only valid when --host ollama.");
  });

  it("rejects --model when Ollama is not in use", async () => {
    await expect(
      runRunCommand({ prompt: "Ship it", mode: "host", host: "codex", model: "qwen3-coder:30b" })
    ).rejects.toThrow("--model is only valid when Ollama is enabled for the selected run.");
  });

  it("accepts --model when Ollama is enabled through project config", async () => {
    mkdirSync(join(process.cwd(), ".lineup"), { recursive: true });
    writeFileSync(
      join(process.cwd(), ".lineup", "config.yaml"),
      "ollama:\n  enabled: true\n  model: qwen3-coder:14b\n  scope: research\n",
      "utf8"
    );
    mockedRunPipeline.mockResolvedValue({
      runId: "run-ok",
      status: "success",
      stageResults: new Map()
    });

    await runRunCommand({ prompt: "Ship it", mode: "human", host: "codex", model: "qwen3-coder:30b" });

    expect(mockedRunPipeline).toHaveBeenCalledWith(expect.objectContaining({
      executionHost: "codex",
      runnerHost: "codex",
      model: "qwen3-coder:30b"
    }), expect.anything());
  });
});
