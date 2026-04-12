import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Command } from "commander";

import { runInstallCommand, type InstallCommandOptions } from "./commands/install";
import { runRunCommand, type RunCommandOptions } from "./commands/run";
import { runStatusCommand, type StatusCommandOptions } from "./commands/status";
import { runTfGenerateCommand } from "./commands/tf";
import { runUninstallCommand, type UninstallCommandOptions } from "./commands/uninstall";
import { runUpdateCommand, type UpdateCommandOptions } from "./commands/update";
import { CliError, asErrorMessage } from "./lib/errors";
import { packageRoot } from "./lib/paths";
import type { TfGenerateOptions } from "./lib/types";

export type CliHandlers = {
  install: (options: InstallCommandOptions) => Promise<void>;
  update: (options: UpdateCommandOptions) => Promise<void>;
  uninstall: (options: UninstallCommandOptions) => Promise<void>;
  status: (options: StatusCommandOptions) => Promise<void>;
  run: (options: RunCommandOptions) => Promise<void>;
  tf: (options: TfGenerateOptions) => Promise<void>;
};

function packageVersion(): string {
  const packageJsonPath = path.join(packageRoot(), "package.json");
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

export function buildProgram(handlers?: Partial<CliHandlers>): Command {
  const commandHandlers: CliHandlers = {
    install: runInstallCommand,
    update: runUpdateCommand,
    uninstall: runUninstallCommand,
    status: runStatusCommand,
    run: runRunCommand,
    tf: runTfGenerateCommand,
    ...handlers
  };

  const program = new Command();

  program
    .name("lineup")
    .description("Lineup multi-host manager for Claude Code, Codex, and OpenCode")
    .version(packageVersion(), "--cli-version", "output CLI version")
    .showHelpAfterError();

  program
    .command("install")
    .description("Install Lineup for selected host(s)")
    .option("--host <host>", "Target host(s): claude|codex|opencode|all")
    .option("--version <tag>", "Release tag to install", "latest")
    .option("--from-dir <path>", "Install from local directory instead of GitHub release")
    .option("--yes", "Auto-confirm prompts")
    .action(commandHandlers.install);

  program
    .command("update")
    .description("Update Lineup for selected host(s)")
    .option("--host <host>", "Target host(s): claude|codex|opencode|all")
    .option("--version <tag>", "Release tag to install", "latest")
    .option("--from-dir <path>", "Install from local directory instead of GitHub release")
    .option("--yes", "Auto-confirm prompts")
    .action(commandHandlers.update);

  program
    .command("uninstall")
    .description("Uninstall Lineup for selected host(s)")
    .option("--host <host>", "Target host(s): claude|codex|opencode|all")
    .option("--yes", "Auto-confirm prompts")
    .option("--purge", "Purge Lineup data directories")
    .action(commandHandlers.uninstall);

  program
    .command("status")
    .description("Show Lineup installation status")
    .option("--host <host>", "Target host(s): claude|codex|opencode|all")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.status);

  program
    .command("run")
    .description("Run a Lineup pipeline via Task Foundry")
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--tactic <name>", "Run a specific tactic", undefined)
    .option("--from-stage <id>", "Resume from a specific stage", undefined)
    .option("--dry-run", "Parse and validate without executing", false)
    .option("--force-rerun", "Ignore cache, re-run all stages", false)
    .option("--json", "Output state as JSON", false)
    .option("--generate-only", "Generate TF artifacts without executing stages", false)
    .option("--timeout <seconds>", "Kill TF after N seconds", parseInt)
    .action(commandHandlers.run);

  const tf = program.command("tf").description("Task Foundry integration commands");
  tf.command("generate")
    .description("Generate TF adapters and config for orchestrator-driven execution")
    .option("--host <host>", "Target host (claude|codex|opencode)")
    .option("--output <dir>", "Output directory", undefined)
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--manifest-path <path>", "Path to approved task manifest", undefined)
    .action(commandHandlers.tf);

  return program;
}

export function printCliError(error: unknown): void {
  const message = asErrorMessage(error);
  process.stderr.write(`${message}\n`);
}

export function resolveExitCode(error: unknown): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }

  return 1;
}

export function handleFatalError(error: unknown): never {
  printCliError(error);
  process.exit(resolveExitCode(error));
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

function isDirectExecution(argv: string[]): boolean {
  const entry = argv[1];
  if (!entry) {
    return false;
  }

  return path.resolve(entry) === path.resolve(packageRoot(), "dist", "cli.js");
}

if (isDirectExecution(process.argv)) {
  run().catch(handleFatalError);
}
