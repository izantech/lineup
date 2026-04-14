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

  beforeEach(() => {
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
  });
});
