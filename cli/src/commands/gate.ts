import { resolve } from "node:path";
import { CliError } from "../lib/errors.js";
import { readPendingGate, writeGateResponse, type GateResponse } from "../lib/gate-store.js";

export type GateRespondOptions = {
  runId: string;
  requestId: string;
  choice: string;
  reason?: string;
  json?: boolean;
};

export async function runGateRespondCommand(options: GateRespondOptions): Promise<void> {
  const projectRoot = resolve(".");

  const pending = readPendingGate(options.runId, options.requestId, projectRoot);
  if (!pending) {
    throw new CliError(`No pending gate found for request '${options.requestId}' in run '${options.runId}'.`, {
      code: "command_not_found"
    });
  }

  const response: GateResponse = {
    requestId: options.requestId,
    choice: options.choice,
    reason: options.reason,
    respondedAt: new Date().toISOString()
  };

  writeGateResponse(options.runId, response, projectRoot);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ accepted: true, runId: options.runId, requestId: options.requestId, choice: options.choice })}\n`);
  } else {
    process.stdout.write(`Gate response accepted for request ${options.requestId} in run ${options.runId}.\n`);
  }
}
