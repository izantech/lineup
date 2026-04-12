import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildProgram } from "../src/cli";

function createMockHandlers() {
  return {
    install: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
  };
}

describe("CLI command parsing", () => {
  const handlers = {
    install: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
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
    await program.parseAsync(["status", "--host", "all", "--json"], { from: "user" });

    expect(handlers.status).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "all",
        json: true
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
});

describe("run command", () => {
  it("parses --dry-run flag", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--dry-run"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      expect.anything()
    );
  });

  it("parses --workflow option", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--workflow", "my.yaml"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: "my.yaml" }),
      expect.anything()
    );
  });

  it("parses --tactic option", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--tactic", "quick-fix"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ tactic: "quick-fix" }),
      expect.anything()
    );
  });

  it("parses --from-stage option", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--from-stage", "plan"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({ fromStage: "plan" }),
      expect.anything()
    );
  });

  it("parses all options together", async () => {
    const handlers = createMockHandlers();
    const program = buildProgram(handlers);
    await program.parseAsync(["node", "lineup", "run", "--workflow", "w.yaml", "--dry-run", "--force-rerun", "--json"]);
    expect(handlers.run).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: "w.yaml",
        dryRun: true,
        forceRerun: true,
        json: true,
      }),
      expect.anything()
    );
  });
});
