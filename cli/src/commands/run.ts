import type { RunOptions } from "../lib/types.js";
import { runPipeline } from "../lib/run-pipeline.js";

export type RunCommandOptions = RunOptions;

export async function runRunCommand(options: RunCommandOptions): Promise<void> {
  await runPipeline(options);
}
