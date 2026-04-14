import { CliError } from "../lib/errors.js";
import {
  describeBlockedRunNextStep,
  findPreviousRunState,
  loadCompiledTasksForRun,
  summarizePipelineState
} from "../lib/inspection.js";
import { printJson, printTableLine } from "../lib/output.js";
import { loadPipelineState } from "../lib/state.js";

export type ShowCommandOptions = {
  runId: string;
  json?: boolean;
  watch?: boolean;
  cwd?: string;
};

const TERMINAL_STATUSES = new Set(["blocked", "succeeded", "failed", "canceled"]);

async function runShowWatch(options: ShowCommandOptions): Promise<void> {
  while (true) {
    const state = loadPipelineState(options.runId, options.cwd);

    process.stdout.write("\x1b[2J\x1b[H");

    if (!state) {
      process.stdout.write(`Run not found: ${options.runId}\n`);
      return;
    }

    const summary = summarizePipelineState(state);
    const startTime = state.started_at ? new Date(state.started_at) : state.updated_at ? new Date(state.updated_at) : new Date();
    const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);

    process.stdout.write(`run_id: ${state.run_id}\n`);
    process.stdout.write(`${summary.statusLine}\n`);
    process.stdout.write(`elapsed: ${elapsed}s\n`);
    process.stdout.write(`${summary.workflowLine}\n`);
    process.stdout.write(`${summary.stageLine}\n`);
    process.stdout.write(`${summary.completedLine}\n`);

    if (summary.changeLines.length > 0) {
      process.stdout.write(`what changed in this run?\n`);
      for (const line of summary.changeLines) {
        process.stdout.write(`  - ${line}\n`);
      }
    }

    if (summary.nextLines.length > 0) {
      process.stdout.write("next:\n");
      for (const line of summary.nextLines) {
        process.stdout.write(`  - ${line}\n`);
      }
    }

    if (TERMINAL_STATUSES.has(state.status)) {
      if (state.status === "blocked") {
        process.stdout.write(`${describeBlockedRunNextStep(state.run_id)}\n`);
      }
      break;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function runShowCommand(options: ShowCommandOptions): Promise<void> {
  if (options.watch) {
    return runShowWatch(options);
  }

  const state = loadPipelineState(options.runId, options.cwd);

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: "invalid_path" });
  }

  if (options.json) {
    printJson(state);
    return;
  }

  const previousState = findPreviousRunState(options.runId, options.cwd);
  const tasks = loadCompiledTasksForRun(options.runId, options.cwd);
  const summary = summarizePipelineState(state, { previousState, tasks });

  printTableLine(`run_id: ${state.run_id}`);
  printTableLine(summary.statusLine);
  printTableLine(summary.workflowLine);
  printTableLine(`git_tree_sha: ${state.git_tree_sha ?? "none"}`);
  printTableLine(summary.stageLine);
  printTableLine(summary.completedLine);
  printTableLine(`updated_at: ${state.updated_at}`);
  for (const line of summary.timingLines) {
    printTableLine(line);
  }

  if (summary.taskLines.length > 0) {
    printTableLine("task_summary:");
    for (const line of summary.taskLines) {
      printTableLine(`  - ${line}`);
    }
  }

  if (summary.changeLines.length > 0) {
    printTableLine("what changed in this run?");
    for (const line of summary.changeLines) {
      printTableLine(`  - ${line}`);
    }
  }

  if (summary.nextLines.length > 0) {
    printTableLine("next:");
    for (const line of summary.nextLines) {
      printTableLine(`  - ${line}`);
    }
  }

  if (summary.artifactLines.length > 0) {
    printTableLine("artifacts:");
    for (const line of summary.artifactLines) {
      printTableLine(`  ${line}`);
    }
  }
}
