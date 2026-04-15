import { createLocalAgentRunner } from "../lib/agent-runner.js";
import { printJson, printTableLine } from "../lib/output.js";
import { isInteractive } from "../lib/prompts.js";
import { resumePipelineRun } from "../lib/run-control.js";

export type ResumeCommandOptions = {
  runId: string;
  json?: boolean;
  skipTask?: string;
  retryFailed?: boolean;
  maxRetries?: number;
};

export async function runResumeCommand(options: ResumeCommandOptions): Promise<void> {
  const runMode = isInteractive() ? "human" : "host";
  const localAgentRunner = runMode === "human" ? createLocalAgentRunner() : undefined;
  const resumed = await resumePipelineRun({
    ...options,
    localAgentRunner,
    emitProtocolToStdout: false
  });

  if (!options.json) {
    printTableLine(resumed.message);
  }

  if (!options.json) {
    const resultLabel =
      resumed.result.status === "blocked"
        ? "blocked"
        : resumed.result.status === "success"
          ? "completed successfully"
          : `finished with status '${resumed.result.status}'`;
    printTableLine(`Run ${options.runId} ${resultLabel}.`);
    return;
  }

  printJson({
    run_id: resumed.result.runId,
    resumed_from: resumed.resumedFrom,
    from_stage: resumed.fromStage,
    mode: resumed.mode,
    message: resumed.message,
    status: resumed.result.status,
    retry_state: resumed.retryState,
    stage_results: Object.fromEntries(resumed.result.stageResults.entries()),
  });
}
