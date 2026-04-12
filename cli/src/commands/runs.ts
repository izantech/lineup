import path from "node:path";

import { observePipelineRuns } from "../lib/observer.js";
import { printJson, printTableLine } from "../lib/output.js";

export type RunsCommandOptions = {
  status?: string;
  json?: boolean;
};

export async function runRunsCommand(options: RunsCommandOptions): Promise<void> {
  let runs = observePipelineRuns();

  if (options.status) {
    runs = runs.filter((r) => r.status === options.status);
  }

  if (options.json) {
    printJson(runs);
    return;
  }

  if (runs.length === 0) {
    printTableLine("No runs found.");
    return;
  }

  for (const run of runs) {
    const workflow = run.workflow ? path.basename(run.workflow) : "unknown";
    const stages = run.completed_stages.length;
    printTableLine(`${run.run_id}  ${run.status}  ${workflow}  ${run.updated_at}  stages:${stages}`);
  }
}
