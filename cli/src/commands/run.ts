import { readFileSync } from "node:fs";
import process from "node:process";
import { createLocalAgentRunner } from "../lib/agent-runner.js";
import { CliError } from "../lib/errors.js";
import { isInteractive } from "../lib/prompts.js";
import { runPipeline } from "../lib/run-pipeline.js";
import type { RunMode, RunOptions } from "../lib/types.js";

export type RunCommandOptions = RunOptions;

function readStdinSync(): string {
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return readFileSync(0, "utf-8").trim();
  } catch {
    return "";
  }
}

function resolveRunMode(mode?: RunMode): RunMode {
  if (mode === "human" || mode === "host") {
    return mode;
  }

  return isInteractive() ? "human" : "host";
}

export async function runRunCommand(options: RunCommandOptions): Promise<void> {
  const mode = resolveRunMode(options.mode);
  const localAgentRunner = mode === "human" ? createLocalAgentRunner(options.host) : undefined;
  if (mode === "human" && !isInteractive()) {
    throw new CliError("Run mode 'human' requires an interactive TTY. Use --mode host in CI or host wrappers.", {
      code: "invalid_args"
    });
  }
  if (mode === "host" && options.dryRun) {
    throw new CliError("Run mode 'host' does not support --dry-run. Use --mode human for preview-only runs.", {
      code: "invalid_args"
    });
  }

  if (!options.prompt) {
    options.prompt = readStdinSync();
  }
  if (!options.prompt) {
    throw new CliError("Task description required. Pass it as a positional argument or pipe it on stdin.", {
      code: "invalid_args"
    });
  }

  if (mode === "human" && localAgentRunner) {
    process.stderr.write(`Using local host '${localAgentRunner.host}' for Lineup agent stages.\n`);
  }

  const result = await runPipeline(
    { ...options, mode, host: localAgentRunner?.host ?? options.host },
    localAgentRunner ? { localAgentRunner } : {}
  );

  if (mode === "human") {
    const summary =
      result.status === "success"
        ? `Run ${result.runId} completed successfully.`
        : result.status === "blocked"
          ? `Run ${result.runId} is blocked. Resume with \`lineup resume ${result.runId}\` or inspect with \`lineup show ${result.runId}\`.`
          : `Run ${result.runId} finished with status: ${result.status}.`;
    process.stderr.write(`${summary}\n`);
  }
}
