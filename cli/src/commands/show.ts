import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { loadPipelineState } from "../lib/state.js";

export type ShowCommandOptions = {
  runId: string;
  json?: boolean;
  watch?: boolean;
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

async function runShowWatch(options: ShowCommandOptions): Promise<void> {
  while (true) {
    const state = loadPipelineState(options.runId);

    process.stdout.write("\x1b[2J\x1b[H");

    if (!state) {
      process.stdout.write(`Run not found: ${options.runId}\n`);
      return;
    }

    const startTime = state.updated_at ? new Date(state.updated_at) : new Date();
    const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);

    process.stdout.write(`run_id: ${state.run_id}\n`);
    process.stdout.write(`status: ${state.status}\n`);
    process.stdout.write(`elapsed: ${elapsed}s\n`);
    process.stdout.write(`workflow: ${state.workflow ?? "unknown"}\n`);

    const completed = state.completed_stages ?? [];
    const current = state.current_stage;

    for (const stage of completed) {
      process.stdout.write(`  ✓ ${stage}\n`);
    }
    if (current) {
      process.stdout.write(`  > ${current} (running)\n`);
    }

    if (TERMINAL_STATUSES.has(state.status)) {
      break;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function runShowCommand(options: ShowCommandOptions): Promise<void> {
  if (options.watch) {
    return runShowWatch(options);
  }

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
