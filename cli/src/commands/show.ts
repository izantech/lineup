import { CliError } from "../lib/errors.js";
import {
  describeBlockedRunNextStep,
  findPreviousRunState,
  loadCompiledTasksForRun,
  summarizePipelineState
} from "../lib/inspection.js";
import { printJson, printTableLine } from "../lib/output.js";
import { loadPipelineState } from "../lib/state.js";
import { renderWatchDashboard } from "../lib/ui/runtime.js";
import { runWatchDashboardTui } from "../lib/ui/runtime-screen.js";
import { supportsDynamicTui } from "../lib/ui/terminal.js";

export type ShowCommandOptions = {
  runId: string;
  json?: boolean;
  watch?: boolean;
  cwd?: string;
};

const TERMINAL_STATUSES = new Set(["blocked", "succeeded", "failed", "canceled"]);

async function runShowWatch(options: ShowCommandOptions): Promise<void> {
  if (supportsDynamicTui(process.stdout)) {
    await runWatchDashboardTui({
      runId: options.runId,
      ...(options.cwd ? { cwd: options.cwd } : {})
    });
    return;
  }

  while (true) {
    const state = loadPipelineState(options.runId, options.cwd);

    if (!state) {
      process.stdout.write(`Run not found: ${options.runId}\n`);
      return;
    }
    process.stdout.write(`${renderWatchDashboard(state, options.cwd).join("\n")}\n`);

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
