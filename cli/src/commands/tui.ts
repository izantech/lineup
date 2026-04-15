import process from "node:process";

import { CliError } from "../lib/errors.js";
import { isInteractive } from "../lib/prompts.js";
import { runTuiApp } from "../tui/index.js";

export type TuiCommandOptions = {
  cwd?: string;
};

export async function runTuiCommand(options: TuiCommandOptions): Promise<void> {
  if (!isInteractive()) {
    throw new CliError("The Lineup TUI requires an interactive terminal. Use subcommands for non-interactive or scripted usage.", {
      code: "invalid_args"
    });
  }

  const session = await runTuiApp({
    cwd: options.cwd ?? process.cwd()
  });

  await session.waitUntilExit?.();
}
