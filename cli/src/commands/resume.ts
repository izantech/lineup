import { execSync } from "node:child_process";

import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { runPipeline } from "../lib/run-pipeline.js";
import { appendPipelineCompletedStage, assertPipelineStateFresh, loadPipelineState, savePipelineState } from "../lib/state.js";

export type ResumeCommandOptions = {
  runId: string;
  json?: boolean;
  skipTask?: string;
  retryFailed?: boolean;
};

const RESUMABLE_STATUSES = new Set(["failed", "blocked", "canceled"]);

export async function runResumeCommand(options: ResumeCommandOptions): Promise<void> {
  const state = loadPipelineState(options.runId);

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: "invalid_path" });
  }

  if (!RESUMABLE_STATUSES.has(state.status)) {
    throw new CliError(
      `Run ${options.runId} has status '${state.status}' and cannot be resumed.`,
      { code: "state_mismatch" }
    );
  }

  const gitTreeSha = resolveGitTreeSha();
  assertPipelineStateFresh(state, gitTreeSha);

  if (options.skipTask) {
    const updated = appendPipelineCompletedStage(state, options.skipTask);
    savePipelineState(updated);
  }

  const completedStages = new Set(state.completed_stages ?? []);

  if (options.skipTask) {
    completedStages.add(options.skipTask);
  }

  let fromStage: string | null;

  if (options.retryFailed && state.status === "failed" && state.current_stage) {
    fromStage = state.current_stage;
  } else {
    fromStage = state.current_stage ?? findFirstIncompleteStage(completedStages);
  }

  const result = await runPipeline({
    workflow: state.workflow,
    fromStage: fromStage ?? undefined,
    json: options.json,
  });

  if (!options.json) {
    printTableLine(`Resumed run ${options.runId} from stage '${fromStage ?? "beginning"}'.`);
    printTableLine(`Result: ${result.status}`);
    return;
  }

  printJson({
    run_id: result.runId,
    resumed_from: options.runId,
    from_stage: fromStage,
    status: result.status,
    stage_results: Object.fromEntries(result.stageResults.entries()),
  });
}

function resolveGitTreeSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD^{tree}", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function findFirstIncompleteStage(completed: Set<string>): string | null {
  // Without access to the workflow definition here, fall back to current_stage.
  // If current_stage was null, the pipeline will restart from the beginning.
  return null;
}
