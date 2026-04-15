import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedRunTuiApp = vi.hoisted(() => vi.fn(async () => ({ waitUntilExit: vi.fn(async () => undefined) })));

vi.mock("../../src/tui/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/tui/index.js")>("../../src/tui/index.js");
  return {
    ...actual,
    runTuiApp: mockedRunTuiApp
  };
});

import { CliError } from "../../src/lib/errors.js";
import { runTuiCommand } from "../../src/commands/tui.js";

describe("runTuiCommand", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedRunTuiApp.mockClear();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("throws for non-interactive terminals", async () => {
    await expect(runTuiCommand({ terminal: { stdinTTY: false, stdoutTTY: false } })).rejects.toBeInstanceOf(CliError);

    expect(mockedRunTuiApp).not.toHaveBeenCalled();
  });

  it("prints degraded fallback guidance for unsupported interactive terminals", async () => {
    await runTuiCommand({
      terminal: { stdinTTY: true, stdoutTTY: true, term: "dumb" }
    });

    expect(mockedRunTuiApp).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();
    expect(writeSpy.mock.calls.map(([chunk]: [unknown]) => String(chunk)).join("")).toContain("Fallback mode is limited to command guidance");
  });

  it("launches the interactive TUI when the terminal supports it", async () => {
    await runTuiCommand({
      terminal: { stdinTTY: true, stdoutTTY: true, term: "xterm-256color" },
      cwd: "/tmp/lineup"
    });

    expect(mockedRunTuiApp).toHaveBeenCalledWith({ cwd: "/tmp/lineup" });
  });
});
