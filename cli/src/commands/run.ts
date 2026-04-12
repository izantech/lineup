import { readFileSync } from "node:fs";
import type { RunOptions } from "../lib/types.js";
import { printJson } from "../lib/output.js";
import { runPipeline } from "../lib/run-pipeline.js";

export type RunCommandOptions = RunOptions;

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf-8").trim();
  } catch {
    return "";
  }
}

export async function runRunCommand(options: RunCommandOptions): Promise<void> {
  if (!options.prompt) {
    options.prompt = readStdinSync();
  }
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
