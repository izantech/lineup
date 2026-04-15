import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { readRunReplay } from "../lib/tui-services.js";

export type ReplayCommandOptions = { runId: string; json?: boolean };

function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
}

export async function runReplayCommand(options: ReplayCommandOptions, cwd?: string): Promise<void> {
  try {
    const events = readRunReplay(options.runId, cwd)
    if (options.json) {
      printJson(events)
      return
    }
    if (events.length === 0) {
      printTableLine("No key events found in protocol log.")
      return
    }
    const baseMs = events[0]!.offsetMs
    for (const event of events) {
      printTableLine(`${formatOffset(event.offsetMs - baseMs)} ${event.label}`)
    }
  } catch (error) {
    throw new CliError((error as Error).message, { code: "invalid_path" })
  }
}
