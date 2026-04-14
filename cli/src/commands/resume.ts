import { execSync } from "node:child_process";

import { createLocalAgentRunner } from "../lib/agent-runner.js";
import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { isInteractive } from "../lib/prompts.js";
import { runPipeline } from "../lib/run-pipeline.js";
import {
  appendPipelineCompletedStage,
  assertPipelineStateFresh,
  getStageRetryCount,
  loadPipelineState,
  recordStageRetry,
  savePipelineState
} from "../lib/state.js";

export type ResumeCommandOptions = {
  runId: string;
  json?: boolean;
  skipTask?: string;
  retryFailed?: boolean;
  maxRetries?: number;
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
  let mode: "resume" | "retry" = "resume";
  let guidance = buildResumeGuidance(state, options, completedStages);
  const runMode = isInteractive() ? "human" : "host";
  const localAgentRunner = runMode === "human" ? createLocalAgentRunner() : undefined;

  if (options.retryFailed && state.status === "failed" && state.current_stage) {
    const maxRetries = options.maxRetries ?? 3;
    const currentAttempts = getStageRetryCount(state, state.current_stage);

    if (currentAttempts >= maxRetries) {
      throw new CliError(
        `Stage '${state.current_stage}' has exhausted ${maxRetries} retry attempts.`,
        { code: "command_failed" }
      );
    }

    const lastError = state.errors?.[state.errors.length - 1]?.message;
    const updated = recordStageRetry(state, state.current_stage, maxRetries, lastError);
    savePipelineState(updated);

    fromStage = state.current_stage;
    mode = "retry";
    guidance = buildRetryGuidance(state, fromStage, currentAttempts + 1, maxRetries, lastError);

    if (!options.json) {
      printTableLine(guidance);
    }
  } else {
    fromStage = state.current_stage ?? findFirstIncompleteStage(completedStages);
    if (!options.json) {
      printTableLine(guidance);
    }
  }

  const result = await runPipeline({
    workflow: state.workflow,
    fromStage: fromStage ?? undefined,
    gateTimeout: state.gate_timeout_seconds,
    mode: runMode,
    host: localAgentRunner?.host
  }, {
    emitProtocolToStdout: false,
    ...(localAgentRunner ? { localAgentRunner } : {})
  });

  if (!options.json) {
    const resultLabel =
      result.status === "blocked"
        ? "blocked"
        : result.status === "success"
          ? "completed successfully"
          : `finished with status '${result.status}'`;
    printTableLine(`Run ${options.runId} ${resultLabel}.`);
    return;
  }

  printJson({
    run_id: result.runId,
    resumed_from: options.runId,
    from_stage: fromStage,
    mode,
    message: guidance,
    status: result.status,
    retry_state: state.retry_state ?? {},
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

function buildResumeGuidance(
  state: NonNullable<ReturnType<typeof loadPipelineState>>,
  options: ResumeCommandOptions,
  completedStages: Set<string>
): string {
  const base = describeResumeTarget(state, completedStages);
  const gateTimeout = [...(state.errors ?? [])].reverse().find((error) => error.code === "gate_timeout");

  if (state.status === "blocked") {
    if (gateTimeout) {
      return options.skipTask
        ? `Run ${options.runId} is blocked at ${base} after a gate timed out. Marked '${options.skipTask}' as complete, then continuing from ${base}. Inspect with \`lineup show ${options.runId}\` if you want the pending context first.`
        : `Run ${options.runId} is blocked at ${base} because a gate timed out. Resuming will reopen that point in the workflow. Inspect with \`lineup show ${options.runId}\`, or cancel with \`lineup cancel ${options.runId}\` if you want to stop instead.`;
    }

    return options.skipTask
      ? `Run ${options.runId} is blocked at ${base}. Marked '${options.skipTask}' as complete, then continuing from ${base}. Inspect with \`lineup show ${options.runId}\` if you want to review the blocked state first.`
      : `Run ${options.runId} is blocked at ${base}. Resuming will continue from there once the blocker clears. Inspect with \`lineup show ${options.runId}\`, or cancel with \`lineup cancel ${options.runId}\` if you want to stop instead.`;
  }

  if (state.status === "canceled") {
    return `Run ${options.runId} was canceled. Resuming will continue from ${base}. Inspect with \`lineup show ${options.runId}\` before resuming if you need the previous context.`;
  }

  return `Run ${options.runId} failed at ${base}. Use \`lineup resume ${options.runId} --retry-failed\` to retry only the failed stage, or inspect with \`lineup show ${options.runId}\` and \`lineup logs ${options.runId}\`.`;
}

function buildRetryGuidance(
  state: NonNullable<ReturnType<typeof loadPipelineState>>,
  fromStage: string | null,
  attempt: number,
  maxRetries: number,
  lastError?: string
): string {
  const target = fromStage ?? state.current_stage ?? "the beginning";
  const suffix = lastError ? ` Last error: ${lastError}` : "";
  return `Retrying stage '${target}' (attempt ${attempt}/${maxRetries}).${suffix}`;
}

function describeResumeTarget(
  state: NonNullable<ReturnType<typeof loadPipelineState>>,
  completedStages: Set<string>
): string {
  if (state.current_stage) {
    return `stage '${state.current_stage}'`;
  }

  if (completedStages.size > 0) {
    return `the first incomplete stage after ${Array.from(completedStages).join(", ")}`;
  }

  return "the beginning";
}
