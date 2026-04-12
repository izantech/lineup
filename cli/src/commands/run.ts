import type { RunOptions } from "../lib/types.js";
import { printJson } from "../lib/output.js";
import { runPipeline } from "../lib/run-pipeline.js";

export type RunCommandOptions = RunOptions;

export async function runRunCommand(options: RunCommandOptions): Promise<void> {
  const result = await runPipeline(options);

  if (!options.json) {
    return;
  }

  printJson({
    run_id: result.runId,
    status: result.status,
    stage_results: Object.fromEntries(result.stageResults.entries())
  });
}
