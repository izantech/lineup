import { existsSync, readFileSync, rmSync } from "node:fs";

import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { lineupRuntimeLockFile } from "../lib/paths.js";
import { loadPipelineState, savePipelineState } from "../lib/state.js";

export type CancelCommandOptions = {
  runId: string;
  json?: boolean;
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

export async function runCancelCommand(options: CancelCommandOptions): Promise<void> {
  const state = loadPipelineState(options.runId);

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: "invalid_path" });
  }

  if (TERMINAL_STATUSES.has(state.status)) {
    if (options.json) {
      printJson({ run_id: options.runId, status: state.status, already_terminal: true });
    } else {
      printTableLine(`Run ${options.runId} is already '${state.status}'.`);
    }
    return;
  }

  savePipelineState({ ...state, status: "canceled" });

  releaseRuntimeLockIfHeld(options.runId);

  if (options.json) {
    printJson({ run_id: options.runId, status: "canceled" });
  } else {
    printTableLine(`Canceled run ${options.runId}.`);
  }
}

function releaseRuntimeLockIfHeld(runId: string): void {
  const lockPath = lineupRuntimeLockFile();
  if (!existsSync(lockPath)) {
    return;
  }

  try {
    const current = JSON.parse(readFileSync(lockPath, "utf8")) as { runId?: string };
    if (current.runId === runId) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    // Lock file is unreadable; leave it in place.
  }
}
