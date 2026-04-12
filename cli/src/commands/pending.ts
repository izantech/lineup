import path from "node:path";

import { printJson, printTableLine } from "../lib/output.js";
import { observePipelineRuns } from "../lib/observer.js";

export type PendingCommandOptions = {
  json?: boolean;
};

export async function runPendingCommand(options: PendingCommandOptions): Promise<void> {
  const runs = observePipelineRuns();
  const blocked = runs.filter((r) => r.status === "blocked");

  if (options.json) {
    printJson(
      blocked.map((r) => ({
        run_id: r.run_id,
        workflow: r.workflow ? path.basename(r.workflow) : null,
        current_stage: r.current_stage,
        updated_at: r.updated_at,
      }))
    );
    return;
  }

  if (blocked.length === 0) {
    printTableLine("No pending approvals.");
    return;
  }

  for (const r of blocked) {
    const workflow = r.workflow ? path.basename(r.workflow) : "-";
    printTableLine(`${r.run_id}  ${workflow}  ${r.current_stage ?? "-"}  ${r.updated_at}`);
  }
}
