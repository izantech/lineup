import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createDoctorReport } from "./doctor.js";
import { initializeLineupProject } from "./init.js";
import { runRunCommand, type RunCommandOptions } from "./run.js";
import { CliError } from "../lib/errors.js";
import { printTableLine } from "../lib/output.js";

export type StartCommandOptions = Omit<RunCommandOptions, "fromStage" | "dryRun" | "forceRerun">;

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

function shellQuote(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function rerunCommand(options: StartCommandOptions): string {
  const parts = ["lineup", "start"];

  if (options.prompt) {
    parts.push(shellQuote(options.prompt));
  }

  if (options.workflow) {
    parts.push("--workflow", shellQuote(options.workflow));
  }

  if (options.tactic) {
    parts.push("--tactic", shellQuote(options.tactic));
  }

  if (options.host) {
    parts.push("--host", options.host);
  }

  if (options.mode) {
    parts.push("--mode", options.mode);
  }

  return parts.join(" ");
}

export async function runStartCommand(options: StartCommandOptions): Promise<void> {
  if (!options.prompt) {
    options.prompt = readStdinSync();
  }

  if (!options.prompt) {
    throw new CliError("Task description required. Pass it as a positional argument or pipe it on stdin.", {
      code: "invalid_args"
    });
  }

  const { entries } = initializeLineupProject({});
  const report = createDoctorReport();
  const createdEntries = entries.filter((entry) => entry.status === "created");

  if (options.workflow) {
    const workflowPath = path.resolve(process.cwd(), options.workflow);
    if (!existsSync(workflowPath)) {
      throw new CliError(`Workflow not found: ${options.workflow}`, {
        code: "not_found"
      });
    }
  }

  if (createdEntries.length > 0) {
    const createdWorkflow = createdEntries.some((entry) => entry.path.endsWith(".lineup-core/workflows/full-pipeline.yaml"));
    const createdRepository = createdEntries.some((entry) => entry.kind === "repository");

    if (createdWorkflow || createdRepository) {
      printTableLine("Prepared Lineup project scaffolding for this repo.");
    }
  }

  if (!report.checks.project.git_head.ok) {
    printTableLine("Lineup is ready, but native runs need one initial git commit before isolation can start.");
    for (const recommendation of report.checks.project.next_commands) {
      printTableLine(`next: ${recommendation.command}`);
    }
    printTableLine(`then: ${rerunCommand(options)}`);
    return;
  }

  await runRunCommand(options);
}
