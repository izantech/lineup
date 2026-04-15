import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildProgram } from "../src/cli";

function createMockHandlers() {
  return {
    install: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    config: vi.fn(async () => undefined),
    doctor: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
    bridgeStart: vi.fn(async () => undefined),
    bridgeEvents: vi.fn(async () => undefined),
    bridgeAnswer: vi.fn(async () => undefined),
    bridgeWorker: vi.fn(async () => undefined),
  };
}

describe("CLI command parsing", () => {
  const handlers = {
    install: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    config: vi.fn(async () => undefined),
    doctor: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
    bridgeStart: vi.fn(async () => undefined),
    bridgeEvents: vi.fn(async () => undefined),
    bridgeAnswer: vi.fn(async () => undefined),
    bridgeWorker: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses install options", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["install", "--host", "codex", "--version", "2.0.0", "--yes"], {
      from: "user"
    });

    expect(handlers.install).toHaveBeenCalledTimes(1);
    expect(handlers.install).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "codex",
        version: "2.0.0",
        yes: true
      }),
      expect.anything()
    );
  });

  it("uses latest as default install version", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["install", "--host", "claude"], { from: "user" });

    expect(handlers.install).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "claude",
        version: "latest"
      }),
      expect.anything()
    );
  });

  it("parses install options for opencode", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["install", "--host", "opencode", "--yes"], { from: "user" });

    expect(handlers.install).toHaveBeenCalledTimes(1);
    expect(handlers.install).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "opencode",
        yes: true
      }),
      expect.anything()
    );
  });

  it("parses update options", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["update", "--host", "all", "--version", "latest", "--yes"], {
      from: "user"
    });

    expect(handlers.update).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "all",
        version: "latest",
        yes: true
      }),
      expect.anything()
    );
  });

  it("parses uninstall options", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["uninstall", "--host", "codex", "--yes", "--purge"], {
      from: "user"
    });

    expect(handlers.uninstall).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "codex",
        yes: true,
        purge: true
      }),
      expect.anything()
    );
  });

  it("parses status options", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["status", "--host", "all", "--json", "--artifacts"], { from: "user" });

    expect(handlers.status).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "all",
        json: true,
        artifacts: true
      }),
      expect.anything()
    );
  });

  it("parses status options for opencode", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["status", "--host", "opencode"], { from: "user" });

    expect(handlers.status).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "opencode"
      }),
      expect.anything()
    );
  });

  it("parses doctor options", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["doctor", "--json"], { from: "user" });

    expect(handlers.doctor).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true
      }),
      expect.anything()
    );
  });

  it("parses config options", async () => {
    const program = buildProgram(handlers);
    await program.parseAsync(["config", "--host", "codex", "--json"], { from: "user" });

    expect(handlers.config).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "codex",
        json: true,
        mode: "show"
      })
    );
  });
});

describe("run command", () => {
  it("parses start options", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "start", "Ship the fix", "--tactic", "explain", "--host", "codex", "--model", "qwen3-coder:30b"]);
    expect(handlers.start).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Ship the fix",
        tactic: "explain",
        host: "codex",
        model: "qwen3-coder:30b"
      })
    );
  });

  it("parses ollama host with explicit runner", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "Ship the fix", "--host", "ollama", "--runner", "codex", "--model", "qwen3-coder:30b"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Ship the fix",
        host: "ollama",
        runner: "codex",
        model: "qwen3-coder:30b"
      })
    );
  });

  it("parses --dry-run flag", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--dry-run"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
  });

  it("parses --workflow option", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--workflow", "my.yaml"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: "my.yaml" })
    );
  });

  it("parses --tactic option", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--tactic", "quick-fix"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ tactic: "quick-fix" })
    );
  });

  it("parses --from-stage option", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--from-stage", "plan"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ fromStage: "plan" })
    );
  });

  it("parses all options together", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--workflow", "w.yaml", "--dry-run", "--force-rerun", "--mode", "host"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: "w.yaml",
        dryRun: true,
        forceRerun: true,
        mode: "host",
      })
    );
  });

  it("parses task positional argument", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "Fix the login bug"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Fix the login bug" })
    );
  });

  it("parses explicit host mode", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "Fix the login bug", "--mode", "host"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Fix the login bug", mode: "host" })
    );
  });

  it("parses local execution host", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "Fix the login bug", "--host", "claude"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Fix the login bug", host: "claude" })
    );
  });

  it("parses config show alias", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "config", "show", "--host", "claude"]);
    expect(handlers.config).toHaveBeenCalledWith(
      expect.objectContaining({ host: "claude", mode: "show" })
    );
  });

  it("parses bridge start options", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync([
      "node",
      "lineup",
      "bridge",
      "start",
      "Analyze the system",
      "--executor-host",
      "claude",
      "--tactic",
      "lux-commons",
      "--approve-plan",
      "--json"
    ]);
    expect(handlers.bridgeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Analyze the system",
        executorHost: "claude",
        tactic: "lux-commons",
        approvePlan: true,
        json: true
      })
    );
  });

  it("parses bridge events options", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "bridge", "events", "abc123", "--after", "4", "--wait", "30", "--json"]);
    expect(handlers.bridgeEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "abc123",
        after: 4,
        wait: 30,
        json: true
      })
    );
  });

  it("parses bridge answer options", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync([
      "node",
      "lineup",
      "bridge",
      "answer",
      "abc123",
      "7",
      "--choice",
      "approve",
      "--reason",
      "Looks good"
    ]);
    expect(handlers.bridgeAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "abc123",
        requestId: "7",
        choice: "approve",
        reason: "Looks good"
      })
    );
  });
});
