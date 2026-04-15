import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { readRunLogs } from "../lib/tui-services.js";

export type LogsCommandOptions = {
  runId: string;
  json?: boolean;
};

export async function runLogsCommand(options: LogsCommandOptions): Promise<void> {
  try {
    const result = readRunLogs(options.runId)
    if (options.json) {
      printJson(result.entries)
      return
    }
    for (const entry of result.entries) {
      printTableLine(JSON.stringify(entry))
    }
  } catch (error) {
    throw new CliError((error as Error).message, { code: "invalid_path" })
  }
}
