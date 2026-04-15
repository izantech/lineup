import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Command } from "commander";

import { runApproveCommand, type ApproveCommandOptions } from "./commands/approve";
import {
  runBridgeAnswerCommand,
  runBridgeEventsCommand,
  runBridgeStartCommand,
  runBridgeWorkerCommand,
  type BridgeAnswerOptions,
  type BridgeEventsOptions,
  type BridgeStartOptions,
  type BridgeWorkerOptions
} from "./commands/bridge";
import { runCancelCommand, type CancelCommandOptions } from "./commands/cancel";
import { runCompletionCommand, type CompletionCommandOptions } from "./commands/completion";
import { runDagCommand, type DagCommandOptions } from "./commands/dag";
import { runGateRespondCommand, type GateRespondOptions } from "./commands/gate";
import { runWavesCommand, type WavesCommandOptions } from "./commands/waves";
import { runHistoryCommand, type HistoryCommandOptions } from "./commands/history";
import { runInitCommand, type InitCommandOptions } from "./commands/init";
import { runInstallCommand, type InstallCommandOptions } from "./commands/install";
import { runLogsCommand, type LogsCommandOptions } from "./commands/logs";
import { runReplayCommand, type ReplayCommandOptions } from "./commands/replay";
import { runPendingCommand, type PendingCommandOptions } from "./commands/pending";
import { runResumeCommand, type ResumeCommandOptions } from "./commands/resume";
import { runRunCommand, type RunCommandOptions } from "./commands/run";
import { runStartCommand, type StartCommandOptions } from "./commands/start";
import { runRunsCommand, type RunsCommandOptions } from "./commands/runs";
import { runShowCommand, type ShowCommandOptions } from "./commands/show";
import { runStatusCommand, type StatusCommandOptions } from "./commands/status";
import { runDoctorCommand, type DoctorCommandOptions } from "./commands/doctor";
import { runTuiCommand, type TuiCommandOptions } from "./commands/tui";
import {
  runTacticNewCommand,
  runTacticListCommand,
  runTacticConvertCommand,
  type TacticNewOptions,
  type TacticListOptions,
  type TacticConvertOptions
} from "./commands/tactic";
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
export type CliHandlers = {
  install: (options: InstallCommandOptions) => Promise<void>;
  update: (options: UpdateCommandOptions) => Promise<void>;
  uninstall: (options: UninstallCommandOptions) => Promise<void>;
  status: (options: StatusCommandOptions) => Promise<void>;
  doctor: (options: DoctorCommandOptions) => Promise<void>;
  start: (options: StartCommandOptions) => Promise<void>;
  run: (options: RunCommandOptions) => Promise<void>;
  tui: (options: TuiCommandOptions) => Promise<void>;
  resume: (options: ResumeCommandOptions) => Promise<void>;
  cancel: (options: CancelCommandOptions) => Promise<void>;
  runs: (options: RunsCommandOptions) => Promise<void>;
  show: (options: ShowCommandOptions) => Promise<void>;
  logs: (options: LogsCommandOptions) => Promise<void>;
  replay: (options: ReplayCommandOptions) => Promise<void>;
  validate: (options: ValidateCommandOptions) => Promise<void>;
  artifactsShow: (options: ArtifactsShowOptions) => Promise<void>;
  artifactsPath: (options: ArtifactsPathOptions) => Promise<void>;
  artifactsDiff: (options: ArtifactsDiffOptions) => Promise<void>;
  approve: (options: ApproveCommandOptions) => Promise<void>;
  bridgeStart: (options: BridgeStartOptions) => Promise<void>;
  bridgeEvents: (options: BridgeEventsOptions) => Promise<void>;
  bridgeAnswer: (options: BridgeAnswerOptions) => Promise<void>;
  bridgeWorker: (options: BridgeWorkerOptions) => Promise<void>;
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
  waves: (options: WavesCommandOptions) => Promise<void>;
  history: (options: HistoryCommandOptions) => Promise<void>;
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
    start: runStartCommand,
    run: runRunCommand,
    tui: runTuiCommand,
    resume: runResumeCommand,
    cancel: runCancelCommand,
    runs: runRunsCommand,
    show: runShowCommand,
    logs: runLogsCommand,
    replay: runReplayCommand,
    validate: runValidateCommand,
    artifactsShow: runArtifactsShowCommand,
    artifactsPath: runArtifactsPathCommand,
    artifactsDiff: runArtifactsDiffCommand,
    approve: runApproveCommand,
    bridgeStart: runBridgeStartCommand,
    bridgeEvents: runBridgeEventsCommand,
    bridgeAnswer: runBridgeAnswerCommand,
    bridgeWorker: runBridgeWorkerCommand,
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
    waves: runWavesCommand,
    history: runHistoryCommand,
    ...handlers
  };

  const program = new Command();

  program
    .name("lineup")
    .description("Lineup multi-agent pipeline for Claude Code, Codex, and OpenCode")
    .showHelpAfterError();

  program.addHelpText(
    "after",
    `
Interactive use:
  lineup
  lineup tui
  lineup --no-tui --help

Programmatic and operator use:
  lineup run "<task>" --mode host
  lineup bridge start "<task>" --executor-host codex --json
  lineup doctor --json
  lineup status --host all --json

Command groups:
  Hosts: install, update, uninstall, status, doctor
  Runs: start, run, tui, runs, show, logs, replay, resume, cancel, history
  Artifacts: artifacts, validate, dag, waves
  Authoring: init, workflow, tactic, completion
  Automation: bridge, gate, approve, pending
`
  );

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
    .command("start [task]")
    .description("Prepare this repo for its first native run, then start Lineup when ready")
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--tactic <name>", "Run a specific tactic", undefined)
    .option("--host <host>", "Local execution host for human mode: claude|codex|opencode")
    .option("--timeout <seconds>", "Apply a default stage timeout hint", parseInt)
    .option("--max-parallel <n>", "Max concurrent tasks in a wave", parseInt)
    .option("--isolation <mode>", "Isolation mode: index|full|sparse")
    .option("--mode <mode>", "Run mode: human|host")
    .option("--implement-method <method>", "Task execution method: phase|task|single-session (default: phase)")
    .option("--gate-timeout <seconds>", "Timeout for gate responses in seconds; on timeout saves state as blocked", parseInt)
    .option("--approve-plan", "Skip interactive plan approval gate", false)
    .action((task: string | undefined, opts: StartCommandOptions) =>
      commandHandlers.start({ ...opts, prompt: task ?? opts.prompt })
    );

  program
    .command("run [task]")
    .description("Run a Lineup pipeline through the native v3 engine")
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--tactic <name>", "Run a specific tactic", undefined)
    .option("--host <host>", "Local execution host for human mode: claude|codex|opencode")
    .option("--from-stage <id>", "Resume from a specific stage", undefined)
    .option("--dry-run", "Parse and validate without executing", false)
    .option("--force-rerun", "Ignore cache, re-run all stages", false)
    .option("--timeout <seconds>", "Apply a default stage timeout hint", parseInt)
    .option("--max-parallel <n>", "Max concurrent tasks in a wave", parseInt)
    .option("--isolation <mode>", "Isolation mode: index|full|sparse")
    .option("--mode <mode>", "Run mode: human|host")
    .option("--implement-method <method>", "Task execution method: phase|task|single-session (default: phase)")
    .option("--gate-timeout <seconds>", "Timeout for gate responses in seconds; on timeout saves state as blocked", parseInt)
    .option("--approve-plan", "Skip interactive plan approval gate", false)
    .action((task: string | undefined, opts: RunCommandOptions) =>
      commandHandlers.run({ ...opts, prompt: task ?? opts.prompt })
    );

  program
    .command("tui")
    .description("Launch the interactive Lineup terminal UI")
    .action(commandHandlers.tui);

  const bridge = program.command("bridge").description("Detached host bridge commands");

  bridge
    .command("start [task]")
    .description("Start a detached bridge session backed by the native engine")
    .requiredOption("--executor-host <host>", "Execution host: claude|codex|opencode")
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--tactic <name>", "Run a specific tactic", undefined)
    .option("--host <host>", "Preferred local execution host override inside the worker")
    .option("--timeout <seconds>", "Apply a default stage timeout hint", parseInt)
    .option("--max-parallel <n>", "Max concurrent tasks in a wave", parseInt)
    .option("--isolation <mode>", "Isolation mode: index|full|sparse")
    .option("--implement-method <method>", "Task execution method: phase|task|single-session (default: phase)")
    .option("--gate-timeout <seconds>", "Timeout for gate responses in seconds", parseInt)
    .option("--approve-plan", "Skip interactive plan approval gate", false)
    .option("--json", "Emit machine-readable JSON output")
    .action((task: string | undefined, opts: BridgeStartOptions) =>
      commandHandlers.bridgeStart({ ...opts, prompt: task ?? opts.prompt })
    );

  bridge
    .command("events <run-id>")
    .description("Read bridge events for a detached session")
    .option("--after <seq>", "Return events with seq greater than this value", parseInt)
    .option("--wait <seconds>", "Long-poll for new events before returning", parseInt)
    .option("--json", "Emit machine-readable JSON output")
    .action((runId: string, opts: { after?: number; wait?: number; json?: boolean }) =>
      commandHandlers.bridgeEvents({ runId, ...opts })
    );

  bridge
    .command("answer <run-id> <request-id>")
    .description("Answer a pending bridge question")
    .requiredOption("--choice <value>", "Response choice")
    .option("--reason <text>", "Optional reason for the choice")
    .option("--json", "Emit machine-readable JSON output")
    .action((runId: string, requestId: string, opts: { choice: string; reason?: string; json?: boolean }) =>
      commandHandlers.bridgeAnswer({ runId, requestId, ...opts })
    );

  bridge
    .command("_worker <task>", { hidden: true })
    .description("Internal detached bridge worker")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--executor-host <host>", "Execution host")
    .option("--workflow <path>", "Path to workflow YAML", undefined)
    .option("--tactic <name>", "Run a specific tactic", undefined)
    .option("--host <host>", "Preferred local execution host override inside the worker")
    .option("--timeout <seconds>", "Apply a default stage timeout hint", parseInt)
    .option("--max-parallel <n>", "Max concurrent tasks in a wave", parseInt)
    .option("--isolation <mode>", "Isolation mode: index|full|sparse")
    .option("--implement-method <method>", "Task execution method: phase|task|single-session (default: phase)")
    .option("--gate-timeout <seconds>", "Timeout for gate responses in seconds", parseInt)
    .option("--approve-plan", "Skip interactive plan approval gate", false)
    .action((task: string, opts: Omit<BridgeWorkerOptions, "prompt">) =>
      commandHandlers.bridgeWorker({ ...opts, prompt: task } as BridgeWorkerOptions)
    );

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
    .option("--max-retries <n>", "Max retry attempts per stage (default: 3)", parseInt)
    .action((runId: string, opts: { json?: boolean; skipTask?: string; retryFailed?: boolean; maxRetries?: number }) =>
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
    .option("--include-builtins", "Include bundled CLI tactics alongside project-local tactics")
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

  program
    .command("waves")
    .description("Visualize task execution waves from a compiled plan")
    .option("--run <id>", "Specify a run ID (default: latest)")
    .option("--json", "Emit machine-readable JSON output")
    .option("--compact", "Compact output without dependency details")
    .action(commandHandlers.waves);

  program
    .command("history")
    .description("Show pipeline execution history")
    .option("--status <status>", "Filter by status")
    .option("--limit <n>", "Max entries to show (default: 20)", parseInt)
    .option("--json", "Emit machine-readable JSON output")
    .action(commandHandlers.history);

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
  const { argv: normalizedArgv, noTui } = stripGlobalNoTui(argv);

  if (isTopLevelVersionRequest(normalizedArgv)) {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }

  if (shouldLaunchDefaultTui(normalizedArgv, noTui)) {
    await runTuiCommand({});
    return;
  }

  const program = buildProgram();
  if (normalizedArgv.slice(2).length === 0) {
    program.outputHelp();
    return;
  }
  await program.parseAsync(normalizedArgv);
}

function stripGlobalNoTui(argv: string[]): { argv: string[]; noTui: boolean } {
  const prefix = argv.slice(0, 2);
  const args = argv.slice(2);
  const normalizedArgs: string[] = [];
  let noTui = false;

  for (const arg of args) {
    if (arg === "--no-tui") {
      noTui = true;
      continue;
    }
    normalizedArgs.push(arg);
  }

  return {
    argv: [...prefix, ...normalizedArgs],
    noTui
  };
}

function shouldLaunchDefaultTui(argv: string[], noTui: boolean): boolean {
  if (noTui) {
    return false;
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return false;
  }

  return argv.slice(2).length === 0;
}

function isTopLevelVersionRequest(argv: string[]): boolean {
  const args = argv.slice(2);
  if (args.length !== 1) {
    return false;
  }

  return args[0] === "--version" || args[0] === "-V" || args[0] === "--cli-version";
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
