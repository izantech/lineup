import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { loadPipelineState } from "../lib/state.js";

export type ShowCommandOptions = {
  runId: string;
  json?: boolean;
};

export async function runShowCommand(options: ShowCommandOptions): Promise<void> {
  const state = loadPipelineState(options.runId);

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: "invalid_path" });
  }

  if (options.json) {
    printJson(state);
    return;
  }

  printTableLine(`run_id: ${state.run_id}`);
  printTableLine(`status: ${state.status}`);
  printTableLine(`workflow: ${state.workflow ?? "unknown"}`);
  printTableLine(`git_tree_sha: ${state.git_tree_sha ?? "none"}`);
  printTableLine(`current_stage: ${state.current_stage ?? "none"}`);
  printTableLine(`completed_stages: ${(state.completed_stages ?? []).join(", ") || "none"}`);
  printTableLine(`updated_at: ${state.updated_at}`);

  const hashes = Object.entries(state.artifact_hashes);
  if (hashes.length > 0) {
    printTableLine("artifacts:");
    for (const [kind, sha256] of hashes) {
      printTableLine(`  ${kind}: ${sha256.slice(0, 12)}`);
    }
  }
}
