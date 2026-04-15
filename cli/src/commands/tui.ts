import process from "node:process";

import { CliError } from "../lib/errors.js";
import { detectTuiTerminalCapabilities, type TuiTerminalSnapshot } from "../lib/tui-terminal.js";
import { runTuiApp } from "../tui/index.js";

export type TuiCommandOptions = {
  cwd?: string;
  terminal?: TuiTerminalSnapshot;
};

function printDegradedFallbackMessage(): void {
  process.stdout.write(
    "The Lineup TUI detected an interactive terminal that does not support alternate-screen rendering.\n" +
      "Fallback mode is limited to command guidance for now.\n" +
      "Use `lineup status`, `lineup doctor`, `lineup runs`, `lineup show <run-id>`, or `lineup --no-tui` for text-only workflows.\n"
  );
}

export async function runTuiCommand(options: TuiCommandOptions): Promise<void> {
  const terminal = detectTuiTerminalCapabilities(options.terminal);
  if (!terminal.interactive) {
    throw new CliError("The Lineup TUI requires an interactive terminal. Use subcommands for non-interactive or scripted usage.", {
      code: "invalid_args"
    });
  }

  if (terminal.degradedFallback) {
    printDegradedFallbackMessage();
    return;
  }

  const session = await runTuiApp({
    cwd: options.cwd ?? process.cwd()
  });

  await session.waitUntilExit?.();
}
