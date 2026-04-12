import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { loadPipelineState, savePipelineState } from "../lib/state.js";

export type ApproveCommandOptions = {
  runId: string;
  json?: boolean;
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

export async function runApproveCommand(options: ApproveCommandOptions): Promise<void> {
  const state = loadPipelineState(options.runId);

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: "invalid_path" });
  }

  if (state.status !== "blocked") {
    if (state.approval) {
      const msg = `Run ${options.runId} has already been approved.`;
      if (options.json) {
        printJson({ run_id: options.runId, status: state.status, message: msg });
        return;
      }
      printTableLine(msg);
      return;
    }

    if (TERMINAL_STATUSES.has(state.status)) {
      const msg = `Run ${options.runId} has already completed with status '${state.status}'.`;
      if (options.json) {
        printJson({ run_id: options.runId, status: state.status, message: msg });
        return;
      }
      printTableLine(msg);
      return;
    }

    const msg = `Run ${options.runId} has status '${state.status}' and is not awaiting approval.`;
    if (options.json) {
      printJson({ run_id: options.runId, status: state.status, message: msg });
      return;
    }
    printTableLine(msg);
    return;
  }

  const approved = savePipelineState({
    ...state,
    status: "running",
    approval: {
      approved_at: new Date().toISOString(),
      approved_by: "cli",
    },
  });

  if (options.json) {
    printJson({
      run_id: options.runId,
      status: approved.status,
      approval: approved.approval,
    });
    return;
  }

  printTableLine(`Run ${options.runId} approved. Use \`lineup resume ${options.runId}\` to continue.`);
}
