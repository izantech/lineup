import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Command } from "commander";

import { runApproveCommand, type ApproveCommandOptions } from "./commands/approve";
import { runCancelCommand, type CancelCommandOptions } from "./commands/cancel";
import { runCompletionCommand, type CompletionCommandOptions } from "./commands/completion";
import { runDagCommand, type DagCommandOptions } from "./commands/dag";
import { runGateRespondCommand, type GateRespondOptions } from "./commands/gate";
import { runInitCommand, type InitCommandOptions } from "./commands/init";
import { runInstallCommand, type InstallCommandOptions } from "./commands/install";
import { runLogsCommand, type LogsCommandOptions } from "./commands/logs";
import { runReplayCommand, type ReplayCommandOptions } from "./commands/replay";
import { runPendingCommand, type PendingCommandOptions } from "./commands/pending";
import { runResumeCommand, type ResumeCommandOptions } from "./commands/resume";
import { runRunCommand, type RunCommandOptions } from "./commands/run";
import { runRunsCommand, type RunsCommandOptions } from "./commands/runs";
import { runShowCommand, type ShowCommandOptions } from "./commands/show";
import { runStatusCommand, type StatusCommandOptions } from "./commands/status";
import { runDoctorCommand, type DoctorCommandOptions } from "./commands/doctor";
import {
  runTacticNewCommand,
  runTacticListCommand,
  runTacticConvertCommand,
  type TacticNewOptions,
  type TacticListOptions,
  type TacticConvertOptions
} from "./commands/tactic";
import { runTfGenerateCommand } from "./commands/tf";
import { runUninstallCommand, type UninstallCommandOptions } from "./commands/uninstall";
import { runUpdateCommand, type UpdateCommandOptions } from "./commands/update";
import { runValidateCommand, type ValidateCommandOptions } from "./commands/validate";
import {
  runArtifactsShowCommand,
  runArtifactsDiffCommand,
  runArtifactsPathCommand,
  type ArtifactsShowOptions,
  type ArtifactsDiffOptions,
  type ArtifactsPathOptions
} from "./commands/artifacts";
import {
  runWorkflowLintCommand,
  runWorkflowListCommand,
  type WorkflowLintOptions,
  type WorkflowListOptions
} from "./commands/workflow";
import { CliError, asErrorMessage } from "./lib/errors";
import { packageRoot } from "./lib/paths";
import type { TfGenerateOptions } from "./lib/types";

export type CliHandlers = {
  install: (options: InstallCommandOptions) => Promise<void>;
  update: (options: UpdateCommandOptions) => Promise<void>;
  uninstall: (options: UninstallCommandOptions) => Promise<void>;
  status: (options: StatusCommandOptions) => Promise<void>;
  doctor: (options: DoctorCommandOptions) => Promise<void>;
  run: (options: RunCommandOptions) => Promise<void>;
  resume: (options: ResumeCommandOptions) => Promise<void>;
  cancel: (options: CancelCommandOptions) => Promise<void>;
  runs: (options: RunsCommandOptions) => Promise<void>;
  show: (options: ShowCommandOptions) => Promise<void>;
  logs: (options: LogsCommandOptions) => Promise<void>;
  replay: (options: ReplayCommandOptions) => Promise<void>;
  tf: (options: TfGenerateOptions) => Promise<void>;
  validate: (options: ValidateCommandOptions) => Promise<void>;
  artifactsShow: (options: ArtifactsShowOptions) => Promise<void>;
  artifactsPath: (options: ArtifactsPathOptions) => Promise<void>;
  artifactsDiff: (options: ArtifactsDiffOptions) => Promise<void>;
  approve: (options: ApproveCommandOptions) => Promise<void>;
  pending: (options: PendingCommandOptions) => Promise<void>;
  init: (options: InitCommandOptions) => Promise<void>;
  workflowLint: (options: WorkflowLintOptions) => Promise<void>;
  workflowList: (options: WorkflowListOptions) => Promise<void>;
  tacticNew: (options: TacticNewOptions) => Promise<void>;
  tacticList: (options: TacticListOptions) => Promise<void>;
  tacticConvert: (options: TacticConvertOptions) => Promise<void>;
  gateRespond: (options: GateRespondOptions) => Promise<void>;
  completion: (options: CompletionCommandOptions) => Promise<void>;
  dag: (options: DagCommandOptions) => Promise<void>;
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
    doctor: runDoctorCommand,
    run: runRunCommand,
    resume: runResumeCommand,
    cancel: runCancelCommand,
    runs: runRunsCommand,
    show: runShowCommand,
    logs: runLogsCommand,
    replay: runReplayCommand,
    tf: runTfGenerateCommand,
    validate: runValidateCommand,
    artifactsShow: runArtifactsShowCommand,
    artifactsPath: runArtifactsPathCommand,
    artifactsDiff: runArtifactsDiffCommand,
    approve: runApproveCommand,
    pending: runPendingCommand,
    init: runInitCommand,
    workflowLint: runWorkflowLintCommand,
    workflowList: runWorkflowListCommand,
    tacticNew: runTacticNewCommand,
    tacticList: runTacticListCommand,
    tacticConvert: runTacticConvertCommand,
    gateRespond: runGateRespondCommand,
    completion: runCompletionCommand,
    dag: runDagCommand,
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
    .option("--artifacts", "Include latest run and artifact status")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.status);

  program
    .command("doctor")
    .description("Check native runtime prerequisites and latest run health")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.doctor);

  program
    .command("init")
    .description("Initialize Lineup project structure")
    .option("--json", "Emit machine-readable JSON output")
    .option("--workflow <name>", "Workflow template name", "full-pipeline")
    .action(commandHandlers.init);

  program
    .command("run")
    .description("Run a Lineup pipeline through the native v3 engine")
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--tactic <name>", "Run a specific tactic", undefined)
    .option("--from-stage <id>", "Resume from a specific stage", undefined)
    .option("--engine <mode>", "Execution engine: auto|native|tf", "auto")
    .option("--dry-run", "Parse and validate without executing", false)
    .option("--force-rerun", "Ignore cache, re-run all stages", false)
    .option("--json", "Output state as JSON", false)
    .option("--generate-only", "Generate reference adapter/config artifacts without executing stages", false)
    .option("--timeout <seconds>", "Apply a default stage timeout hint", parseInt)
    .option("--max-parallel <n>", "Max concurrent tasks in a wave", parseInt)
    .option("--isolation <mode>", "Isolation mode: index|full|sparse")
    .option("--gate-timeout <seconds>", "Timeout for gate responses in seconds; on timeout saves state as blocked", parseInt)
    .option("--approve-plan", "Skip interactive plan approval gate", false)
    .option("-i, --interactive", "Handle gates via stdin prompts")
    .action(commandHandlers.run);

  program
    .command("runs")
    .description("List pipeline runs")
    .option("--status <status>", "Filter by status (pending|running|blocked|succeeded|failed|canceled)")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.runs);

  program
    .command("show <run-id>")
    .description("Show details for a pipeline run")
    .option("--json", "Emit machine-readable JSON output")
    .option("-w, --watch", "Poll and refresh progress every 2 seconds")
    .action((runId: string, opts: { json?: boolean; watch?: boolean }) => commandHandlers.show({ runId, ...opts }));

  program
    .command("logs <run-id>")
    .description("Show protocol logs for a pipeline run")
    .option("--json", "Emit machine-readable JSON output")
    .action((runId: string, opts: { json?: boolean }) => commandHandlers.logs({ runId, ...opts }));

  program
    .command("replay <run-id>")
    .description("Replay a pipeline run as a human-readable narrative")
    .option("--json", "Emit machine-readable JSON output")
    .action((runId: string, opts: { json?: boolean }) => commandHandlers.replay({ runId, ...opts }));

  program
    .command("resume <run-id>")
    .description("Resume a failed, blocked, or canceled pipeline run")
    .option("--json", "Output state as JSON", false)
    .option("--skip-task <id>", "Skip a blocked task before resuming")
    .option("--retry-failed", "Retry from the exact failed stage")
    .action((runId: string, opts: { json?: boolean; skipTask?: string; retryFailed?: boolean }) =>
      commandHandlers.resume({ runId, ...opts })
    );

  program
    .command("approve <run-id>")
    .description("Approve a blocked pipeline run awaiting approval")
    .option("--json", "Emit machine-readable JSON output")
    .action((runId: string, opts: { json?: boolean }) => commandHandlers.approve({ runId, ...opts }));

  program
    .command("pending")
    .description("List pipeline runs awaiting approval")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.pending);

  program
    .command("cancel <run-id>")
    .description("Cancel a running, pending, or blocked pipeline run")
    .option("--json", "Output state as JSON", false)
    .action((runId: string, opts: { json?: boolean }) => commandHandlers.cancel({ runId, ...opts }));

  const tf = program.command("tf").description("Reference adapter generation commands");
  tf.command("generate")
    .description("Generate reference adapters and config for comparison or migration workflows")
    .option("--host <host>", "Target host (claude|codex|opencode)")
    .option("--output <dir>", "Output directory", undefined)
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--manifest-path <path>", "Path to approved plan/task manifest reference", undefined)
    .action(commandHandlers.tf);

  program
    .command("validate <file>")
    .description("Validate an artifact file against its schema")
    .option("--kind <kind>", "Override artifact kind inference")
    .option("--json", "Emit machine-readable JSON output")
    .action((file: string, opts: { kind?: string; json?: boolean }) =>
      commandHandlers.validate({ file, ...opts })
    );

  const artifacts = program.command("artifacts").description("Inspect pipeline artifacts");

  artifacts
    .command("show <kind>")
    .description("Show contents of an artifact from a pipeline run")
    .option("--run <id>", "Specify a run ID (default: latest)")
    .option("--json", "Emit machine-readable JSON output")
    .action((kind: string, opts: { run?: string; json?: boolean }) =>
      commandHandlers.artifactsShow({ kind, ...opts })
    );

  artifacts
    .command("path <kind>")
    .description("Print the filesystem path of an artifact")
    .option("--run <id>", "Specify a run ID (default: latest)")
    .action((kind: string, opts: { run?: string }) =>
      commandHandlers.artifactsPath({ kind, ...opts })
    );

  artifacts
    .command("diff <kind>")
    .description("Show unified diff of an artifact between two runs")
    .option("--from <run-id>", "Source run ID (default: second-latest)")
    .option("--to <run-id>", "Target run ID (default: latest)")
    .option("--json", "Emit machine-readable JSON output")
    .action((kind: string, opts: { from?: string; to?: string; json?: boolean }) =>
      commandHandlers.artifactsDiff({ kind, ...opts })
    );

  const workflow = program.command("workflow").description("Workflow authoring commands");

  workflow
    .command("lint <path>")
    .description("Validate a workflow YAML file")
    .option("--json", "Emit machine-readable JSON output")
    .action((filePath: string, opts: { json?: boolean }) =>
      commandHandlers.workflowLint({ path: filePath, ...opts })
    );

  workflow
    .command("list")
    .description("List available workflows")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.workflowList);

  const tactic = program.command("tactic").description("Tactic authoring commands");

  tactic
    .command("new <name>")
    .description("Scaffold a new tactic YAML file")
    .action((name: string) => commandHandlers.tacticNew({ name }));

  tactic
    .command("list")
    .description("List available tactics")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.tacticList);

  tactic
    .command("convert <name>")
    .description("Convert a tactic to workflow YAML (or JSON with --json)")
    .option("--json", "Emit machine-readable JSON output")
    .action((name: string, opts: { json?: boolean }) =>
      commandHandlers.tacticConvert({ name, ...opts })
    );

  const gate = program.command("gate").description("Pipeline gate interaction commands");

  gate
    .command("respond <run-id> <request-id>")
    .description("Respond to a pending pipeline gate")
    .requiredOption("--choice <value>", "Response choice")
    .option("--reason <text>", "Optional reason for the choice")
    .option("--json", "Emit machine-readable JSON output")
    .action((runId: string, requestId: string, opts: { choice: string; reason?: string; json?: boolean }) =>
      commandHandlers.gateRespond({ runId, requestId, ...opts })
    );

  program
    .command("completion <shell>")
    .description("Generate shell completion script (bash, zsh, fish)")
    .action((shell: string) => commandHandlers.completion({ shell }));

  program
    .command("dag")
    .description("Visualize the workflow DAG")
    .option("--workflow <path>", "Path to workflow YAML")
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.dag);

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
