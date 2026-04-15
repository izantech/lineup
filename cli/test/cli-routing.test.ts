import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedRunTuiCommand = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../src/commands/tui", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/tui")>("../src/commands/tui");
  return {
    ...actual,
    runTuiCommand: mockedRunTuiCommand
  };
});

import { run } from "../src/cli";

function setInteractive(interactive: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: interactive });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: interactive });
}

describe("default TUI routing", () => {
  const originalStdinTTY = process.stdin.isTTY;
  const originalStdoutTTY = process.stdout.isTTY;

  beforeEach(() => {
    mockedRunTuiCommand.mockClear();
  });

  afterEach(() => {
    setInteractive(Boolean(originalStdinTTY && originalStdoutTTY));
  });

  it("launches the TUI for interactive bare `lineup`", async () => {
    setInteractive(true);

    await run(["node", "lineup"]);

    expect(mockedRunTuiCommand).toHaveBeenCalledTimes(1);
  });

  it("launches the TUI for explicit `lineup tui`", async () => {
    setInteractive(true);

    await run(["node", "lineup", "tui"]);

    expect(mockedRunTuiCommand).toHaveBeenCalledTimes(1);
  });

  it("does not launch the TUI when `--no-tui` is passed", async () => {
    setInteractive(true);

    await run(["node", "lineup", "--no-tui"]);

    expect(mockedRunTuiCommand).not.toHaveBeenCalled();
  });

  it("does not launch the TUI for non-interactive bare `lineup`", async () => {
    setInteractive(false);

    await run(["node", "lineup"]);

    expect(mockedRunTuiCommand).not.toHaveBeenCalled();
  });
});
