import { printJson, printTableLine } from "../lib/output.js";
import { cancelPipelineRun } from "../lib/run-control.js";

export type CancelCommandOptions = {
  runId: string;
  json?: boolean;
};

export async function runCancelCommand(options: CancelCommandOptions): Promise<void> {
  const result = cancelPipelineRun({ runId: options.runId });

  if (options.json) {
    printJson({ run_id: result.runId, status: result.status, ...(result.alreadyTerminal ? { already_terminal: true } : {}) });
  } else {
    printTableLine(
      result.alreadyTerminal
        ? `Run ${options.runId} is already '${result.status}'.`
        : `Canceled run ${options.runId}.`
    );
  }
}
