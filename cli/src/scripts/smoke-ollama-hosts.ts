import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CliError, asErrorMessage } from "../lib/errors";
import { captureFileActivity, hasFileActivity, listImmediateFiles } from "../lib/file-activity.js";
import { planHostLaunch } from "../lib/launch-planner.js";
import {
  lineupRunBridgeEventsFile,
  lineupRunBridgeStderrLogFile,
  lineupRunBridgeStdoutLogFile,
  lineupRunDebugBundleFile,
  lineupRunDir,
  lineupRunStateFile,
  lineupRunsDir,
  packageRoot
} from "../lib/paths";

type HostName = "claude" | "codex" | "opencode";

type SmokeOptions = {
  host: HostName | "all";
  model: string;
  baseUrl: string;
  keepTemp: boolean;
};

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type HostIntegrationMode = "launch" | "env" | "managed";

type HostSmokeSummary = {
  host: HostName;
  status: "passed" | "failed" | "stalled" | "skipped";
  failureClass?: "parse" | "timeout" | "stall" | "lock" | "host_error";
  integrationMode: HostIntegrationMode;
  fallbackLaneUsed?: "direct" | "env" | "managed" | "none";
  resolvedPlannerCommand: string;
  hostConfigPath: string;
  managedConfigPath: string;
  homeDir: string;
  repoDir: string;
  preservedTempRoot?: string;
  primaryBridgeRunId?: string;
  primaryBridgeRunRoot?: string;
  primaryBridgeHostTraceRoot?: string;
  primaryBridgeEventsPath?: string;
  primaryBridgeStdoutPath?: string;
  primaryBridgeStderrPath?: string;
  primaryBridgeDebugBundlePath?: string;
  primaryBridgeTraceFiles?: string[];
  bridgeRunId?: string;
  bridgeRunRoot?: string;
  bridgeHostTraceRoot?: string;
  bridgeEventsPath?: string;
  bridgeStdoutPath?: string;
  bridgeStderrPath?: string;
  bridgeStatePath?: string;
  bridgeDebugBundlePath?: string;
  bridgeTraceFiles?: string[];
  explainRunId?: string;
  explainRunRoot?: string;
  explainHostTraceRoot?: string;
  explainTraceFiles?: string[];
  failure?: string;
};

type RunDebugPaths = {
  runRoot: string;
  artifactRoot: string;
  hostTraceRoot: string;
  bridgeEventsPath: string;
  bridgeStdoutPath: string;
  bridgeStderrPath: string;
  statePath: string;
  debugBundlePath: string;
};

type DoctorReport = {
  healthy: boolean;
  checks: {
    ollama: Record<
      HostName,
      {
        mode: { ok: boolean; detail: string };
        binary: { ok: boolean; detail: string };
        readiness: { ok: boolean; detail: string };
        integration: { ok: boolean; detail: string };
      }
    >;
  };
};

type BridgeStartPayload = {
  runId: string;
  status: string;
  workerPid?: number;
  executorHost: HostName;
};

type BridgeEventsPayload = {
  events: Array<
    | {
        type: "status";
        seq: number;
        stageId?: string;
        text?: string;
      }
    | {
        type: "question";
        seq: number;
        requestId: number;
        choices?: string[];
        defaultChoice?: string;
        question?: string;
      }
    | {
        type: "complete";
        seq: number;
        status: string;
        summary?: string;
      }
  >;
  nextCursor?: number;
  session?: { currentSeq?: number };
  pendingQuestion?: {
    requestId: number;
    choices?: string[];
    defaultChoice?: string;
  };
};

const SUPPORTED_HOSTS: HostName[] = ["claude", "codex", "opencode"];

const PIPELINE_SMOKE_PROMPT = [
  "Run the full Lineup smoke pipeline on this tiny repository.",
  "Make one deterministic change: append a second sentence to README.md stating that this repo validates Ollama host execution.",
  "For research, inspect only README.md, .lineup-core/workflows/full-pipeline.yaml, and .lineup/tactics/example.yaml unless a later stage truly requires more.",
  "Do not inspect Ollama service health, host CLI configuration, runtime logs, bridge files, or network endpoints.",
  "Keep every artifact concise, structured, and scoped to this tiny repo.",
  "Auto-answer any bridge questions."
].join(" ");

function parseArgs(argv: string[]): SmokeOptions {
  const result: SmokeOptions = {
    host: "all",
    model: "local-qwen",
    baseUrl: "http://127.0.0.1:11434/v1",
    keepTemp: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      const value = argv[++index];
      if (value === undefined) {
        throw new CliError("--host requires a value", { code: "smoke_ollama_missing_host" });
      }

      if (value !== "all" && !SUPPORTED_HOSTS.includes(value as HostName)) {
        throw new CliError(`Unsupported host '${value}'. Expected claude|codex|opencode|all.`, {
          code: "smoke_ollama_invalid_host"
        });
      }

      result.host = value as SmokeOptions["host"];
      continue;
    }

    if (arg === "--model") {
      const value = argv[++index];
      if (!value?.trim()) {
        throw new CliError("--model requires a value", { code: "smoke_ollama_missing_model" });
      }

      result.model = value.trim();
      continue;
    }

    if (arg === "--base-url") {
      const value = argv[++index];
      if (!value?.trim()) {
        throw new CliError("--base-url requires a value", { code: "smoke_ollama_missing_base_url" });
      }

      result.baseUrl = value.trim().replace(/\/$/, "");
      continue;
    }

    if (arg === "--keep-temp") {
      result.keepTemp = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: npm --prefix cli run smoke:ollama-hosts -- [options]",
          "",
          "Options:",
          "  --host claude|codex|opencode|all   Host or hosts to smoke test (default: all)",
          "  --model <name>                     Ollama model to configure",
          "  --base-url <url>                   Ollama base URL (default: http://127.0.0.1:11434/v1)",
          "  --keep-temp                        Preserve the temporary workspace on failure",
          "  -h, --help                         Show this help"
        ].join("\n") + "\n"
      );
      process.exit(0);
    }

    throw new CliError(`Unknown option: ${arg}`, { code: "smoke_ollama_unknown_option" });
  }

  return result;
}

function tempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "lineup-smoke-ollama-"));
}

function runDistCli(args: string[], cwd: string, homeDir: string, envOverrides: NodeJS.ProcessEnv = {}): CommandResult {
  const result = spawnSync(process.execPath, [path.join(packageRoot(), "bin", "lineup.mjs"), ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      ...envOverrides
    },
    encoding: "utf8"
  });

  if (result.error) {
    throw new CliError(`Failed to execute dist CLI (${args.join(" ")}): ${result.error.message}`, {
      code: "smoke_ollama_spawn_failed"
    });
  }

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function assertExitZero(label: string, result: CommandResult): void {
  if (result.status === 0) {
    return;
  }

  throw new CliError(
    [
      `${label} failed with exit code ${result.status ?? "null"}.`,
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null
    ]
      .filter(Boolean)
      .join("\n"),
    {
      code: "smoke_ollama_failed"
    }
  );
}

function parseJson<T>(label: string, output: string): T {
  try {
    const parsed = JSON.parse(output.trim()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("not an object");
    }

    return parsed as T;
  } catch (error) {
    throw new CliError(
      `${label} returned invalid JSON:\n${output.trim()}\n${error instanceof Error ? error.message : String(error)}`,
      { code: "smoke_ollama_invalid_json" }
    );
  }
}

function ensureDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function initGitRepo(repoDir: string): void {
  assertExitZero("git init", runHostCommand(repoDir, ["git", "init"]));
  assertExitZero(
    "git config user.email",
    runHostCommand(repoDir, ["git", "config", "user.email", "lineup@example.com"])
  );
  assertExitZero(
    "git config user.name",
    runHostCommand(repoDir, ["git", "config", "user.name", "Lineup Smoke"])
  );
  writeFileSync(path.join(repoDir, "README.md"), "# Lineup Ollama smoke\n", "utf8");
  assertExitZero("git add", runHostCommand(repoDir, ["git", "add", "README.md"]));
  assertExitZero("git commit", runHostCommand(repoDir, ["git", "commit", "-m", "Initial commit"]));
}

function runHostCommand(cwd: string, args: [string, ...string[]]): CommandResult {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    env: process.env
  });

  if (result.error) {
    throw new CliError(`Failed to execute ${args[0]}: ${result.error.message}`, {
      code: "smoke_ollama_spawn_failed"
    });
  }

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function hostConfigPath(homeDir: string, host: HostName): string {
  if (host === "claude") {
    return path.join(homeDir, ".claude", "lineup", "ollama.yaml");
  }

  if (host === "codex") {
    return path.join(homeDir, ".codex", "lineup", "ollama.yaml");
  }

  return path.join(homeDir, ".config", "opencode", "lineup", "ollama.yaml");
}

function managedConfigPath(homeDir: string, host: HostName): string | null {
  if (host === "codex") {
    return path.join(homeDir, ".codex", "config.toml");
  }

  if (host === "opencode") {
    return path.join(homeDir, ".config", "opencode", "opencode.json");
  }

  return null;
}

function writeHostOllamaConfig(homeDir: string, host: HostName, options: SmokeOptions): string {
  const filePath = hostConfigPath(homeDir, host);
  ensureDir(filePath);
  writeFileSync(
    filePath,
    [
      "enabled: true",
      `model: ${options.model}`,
      "scope: full",
      "host_integration:",
      "  enabled: true",
      "  strategy: auto",
      `baseUrl: ${options.baseUrl}`,
      ""
    ].join("\n"),
    "utf8"
  );
  return filePath;
}

function writeWorkflow(repoDir: string): string {
  const workflowPath = path.join(repoDir, ".lineup-core", "workflows", "full-pipeline.yaml");
  ensureDir(workflowPath);
  writeFileSync(
    workflowPath,
    [
      "apiVersion: lineup/v3",
      "kind: Workflow",
      "name: ollama-smoke",
      "stages:",
      "  - id: triage",
      "    type: builtin",
      "  - id: research",
      "    type: agent",
      "    agent: researcher",
      "    depends_on: [triage]",
      "  - id: plan",
      "    type: agent",
      "    agent: architect",
      "    depends_on: [research]",
      "  - id: plan-approval",
      "    type: approval",
      "    depends_on: [plan]",
      "  - id: implement",
      "    type: agent",
      "    agent: developer",
      "    depends_on: [plan-approval]",
      "  - id: verify",
      "    type: agent",
      "    agent: reviewer",
      "    depends_on: [implement]",
      ""
    ].join("\n"),
    "utf8"
  );
  return workflowPath;
}

function resolveRunDebugPaths(repoDir: string, runId: string): RunDebugPaths {
  const runRoot = lineupRunDir(runId, repoDir);

  return {
    runRoot,
    artifactRoot: path.join(runRoot, "artifacts"),
    hostTraceRoot: path.join(runRoot, "host"),
    bridgeEventsPath: lineupRunBridgeEventsFile(runId, repoDir),
    bridgeStdoutPath: lineupRunBridgeStdoutLogFile(runId, repoDir),
    bridgeStderrPath: lineupRunBridgeStderrLogFile(runId, repoDir),
    statePath: lineupRunStateFile(runId, repoDir),
    debugBundlePath: lineupRunDebugBundleFile(runId, repoDir)
  };
}

function snapshotRunIds(repoDir: string): string[] {
  const runsDir = lineupRunsDir(repoDir);
  if (!existsSync(runsDir)) {
    return [];
  }

  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function detectNewestNewRunId(repoDir: string, before: string[]): string | null {
  const beforeSet = new Set(before);
  const runsDir = lineupRunsDir(repoDir);
  if (!existsSync(runsDir)) {
    return null;
  }

  const candidates = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !beforeSet.has(entry.name))
    .map((entry) => ({
      runId: entry.name,
      mtimeMs: statSync(path.join(runsDir, entry.name)).mtimeMs
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]?.runId ?? null;
}

function listHostTraceFiles(hostTraceRoot: string | undefined): string[] {
  return listImmediateFiles(hostTraceRoot);
}

function trackedRunFiles(debugPaths: RunDebugPaths): string[] {
  return [
    debugPaths.bridgeStdoutPath,
    debugPaths.bridgeStderrPath,
    ...listImmediateFiles(debugPaths.hostTraceRoot),
    ...listImmediateFiles(debugPaths.artifactRoot)
  ];
}

function failIfHostUnavailable(report: DoctorReport, host: HostName): void {
  const check = report.checks.ollama[host];
  if (!check.mode.ok || !check.binary.ok || !check.readiness.ok) {
    throw new CliError(
      [
        `${host} is not ready for Ollama smoke testing.`,
        `mode: ${check.mode.detail}`,
        `binary: ${check.binary.detail}`,
        `readiness: ${check.readiness.detail}`,
        `integration: ${check.integration.detail}`
      ].join("\n"),
      { code: "smoke_ollama_host_unavailable" }
    );
  }
}

function resolvePlannedCommand(
  host: HostName,
  repoDir: string,
  homeDir: string,
  envOverrides: NodeJS.ProcessEnv = {}
): { integrationMode: HostIntegrationMode; resolvedCommand: string } {
  const plan = planHostLaunch({
    host,
    projectRoot: repoDir,
    workingDirectory: repoDir,
    agent: "researcher",
    prompt: PIPELINE_SMOKE_PROMPT,
    homeDir,
    env: envOverrides
  });

  const integrationMode: HostIntegrationMode = plan.integration === "ollama-env"
    ? "env"
    : plan.integration === "ollama-managed"
      ? "managed"
      : "launch";

  return {
    integrationMode,
    resolvedCommand: `${plan.command} ${plan.args.join(" ")}`.trim()
  };
}

function classifyFailure(error: unknown): HostSmokeSummary["failureClass"] {
  const message = asErrorMessage(error).toLowerCase();
  const code = error instanceof CliError ? String((error as { code?: string }).code ?? "").toLowerCase() : "";

  if (code.includes("invalid_json") || message.includes("invalid json") || message.includes("parse")) {
    return "parse";
  }

  if (code.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }

  if (code.includes("stalled") || message.includes("stalled")) {
    return "stall";
  }

  if (code.includes("lock") || message.includes("lock")) {
    return "lock";
  }

  return "host_error";
}

function filterPathWithoutBinary(binaryName: string): string {
  const currentPath = process.env.PATH ?? "";
  const filteredSegments = currentPath
    .split(path.delimiter)
    .filter((segment) => segment.trim().length > 0 && !existsSync(path.join(segment, binaryName)));

  return filteredSegments.join(path.delimiter);
}

function answerBridgeQuestion(repoDir: string, homeDir: string, runId: string, question: { requestId: number; choices?: string[]; defaultChoice?: string }): void {
  const choice = question.defaultChoice ?? question.choices?.[0];
  if (!choice) {
    throw new CliError(`Bridge question ${question.requestId} did not include an answer choice.`, {
      code: "smoke_ollama_missing_bridge_choice"
    });
  }

  const result = runDistCli(
    ["bridge", "answer", runId, String(question.requestId), "--choice", choice, "--json"],
    repoDir,
    homeDir
  );
  assertExitZero(`lineup bridge answer ${runId} ${question.requestId}`, result);
}

function extractBridgeRunId(message: string): string | null {
  const match = message.match(/\bBridge run ([a-f0-9]{6,})\b/i);
  return match?.[1] ?? null;
}

function cancelRun(repoDir: string, homeDir: string, runId: string): void {
  const result = runDistCli(["cancel", runId, "--json"], repoDir, homeDir);
  assertExitZero(`lineup cancel ${runId}`, result);
}

function waitForBridgeCompletion(repoDir: string, homeDir: string, runId: string): BridgeEventsPayload {
  let cursor = 0;
  let lastPayload: BridgeEventsPayload | null = null;
  const deadline = Date.now() + 10 * 60 * 1000;
  const noProgressDeadlineMs = 5 * 60 * 1000;
  let lastProgressAt = Date.now();
  const debugPaths = resolveRunDebugPaths(repoDir, runId);
  let lastFileActivity = captureFileActivity(trackedRunFiles(debugPaths));

  while (Date.now() < deadline) {
    const result = runDistCli(
      ["bridge", "events", runId, "--after", String(cursor), "--wait", "1", "--json"],
      repoDir,
      homeDir
    );
    assertExitZero(`lineup bridge events ${runId}`, result);
    const payload = parseJson<BridgeEventsPayload>("bridge events", result.stdout);
    lastPayload = payload;
    const sawProgress = payload.events.length > 0 || Boolean(payload.pendingQuestion);

    for (const event of payload.events) {
      cursor = Math.max(cursor, event.seq);
      lastProgressAt = Date.now();
      if (event.type === "question") {
        answerBridgeQuestion(repoDir, homeDir, runId, event);
      }
      if (event.type === "complete" && event.status === "succeeded") {
        return payload;
      }
      if (event.type === "complete" && event.status !== "succeeded") {
        throw new CliError(
          `Bridge run ${runId} completed unsuccessfully with status ${event.status}: ${event.summary ?? "no summary"}`,
          { code: "smoke_ollama_bridge_failed" }
        );
      }
    }

    if (payload.pendingQuestion?.requestId !== undefined) {
      lastProgressAt = Date.now();
      answerBridgeQuestion(repoDir, homeDir, runId, payload.pendingQuestion);
    }

    if (sawProgress) {
      lastProgressAt = Date.now();
    }

    const currentFileActivity = captureFileActivity(trackedRunFiles(debugPaths));
    if (hasFileActivity(lastFileActivity, currentFileActivity)) {
      lastProgressAt = Date.now();
      lastFileActivity = currentFileActivity;
    }

    if (Date.now() - lastProgressAt > noProgressDeadlineMs) {
      throw new CliError(
        `Bridge run ${runId} stalled: no progress for ${Math.floor(noProgressDeadlineMs / 1000)} seconds.`,
        { code: "smoke_ollama_bridge_stalled" }
      );
    }
  }

  throw new CliError(
    `Timed out waiting for bridge completion on ${runId}.${lastPayload ? ` Last payload: ${JSON.stringify(lastPayload)}` : ""}`,
    { code: "smoke_ollama_bridge_timeout" }
  );
}

function collectManagedConfig(homeDir: string, host: HostName): string {
  const managedPath = managedConfigPath(homeDir, host);
  if (!managedPath) {
    return "";
  }

  if (!existsSync(managedPath)) {
    throw new CliError(`Expected managed config file was not written: ${managedPath}`, {
      code: "smoke_ollama_missing_managed_config"
    });
  }

  return readFileSync(managedPath, "utf8");
}

function runHostSmoke(host: HostName, options: SmokeOptions, rootDir: string): HostSmokeSummary {
  const hostRoot = path.join(rootDir, host);
  const homeDir = path.join(hostRoot, "home");
  const repoDir = path.join(hostRoot, "repo");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  const hostConfig = writeHostOllamaConfig(homeDir, host, options);
  const summary: HostSmokeSummary = {
    host,
    status: "skipped",
    integrationMode: "managed",
    fallbackLaneUsed: "none",
    resolvedPlannerCommand: "",
    hostConfigPath: hostConfig,
    managedConfigPath: managedConfigPath(homeDir, host) ?? "n/a",
    homeDir,
    repoDir
  };

  try {
    initGitRepo(repoDir);
    const lineupInit = runDistCli(["init", "--workflow", "full-pipeline", "--json"], repoDir, homeDir);
    assertExitZero(`lineup init --workflow full-pipeline --json (${host})`, lineupInit);

    const workflowPath = writeWorkflow(repoDir);

    const doctorResult = runDistCli(["doctor", "--json"], repoDir, homeDir);
    assertExitZero(`lineup doctor --json (${host})`, doctorResult);
    const report = parseJson<DoctorReport>("doctor --json", doctorResult.stdout);
    failIfHostUnavailable(report, host);

    const runIntegrationSmoke = (envOverrides: NodeJS.ProcessEnv = {}): HostSmokeSummary => {
      const preview = resolvePlannedCommand(host, repoDir, homeDir, envOverrides);
      const bridgeStart = runDistCli(
        [
          "bridge",
          "start",
          PIPELINE_SMOKE_PROMPT,
          "--executor-host",
          host,
          "--workflow",
          workflowPath,
          "--host",
          host,
          "--approve-plan",
          "--json"
        ],
        repoDir,
        homeDir,
        envOverrides
      );
      assertExitZero(`lineup bridge start (${host})`, bridgeStart);
      const bridgePayload = parseJson<BridgeStartPayload>("bridge start", bridgeStart.stdout);
      if (bridgePayload.executorHost !== host) {
        throw new CliError(`bridge start returned executor host '${bridgePayload.executorHost}' for '${host}'.`, {
          code: "smoke_ollama_bad_bridge_payload"
        });
      }

      const bridgeDebugPaths = resolveRunDebugPaths(repoDir, bridgePayload.runId);

      const events = waitForBridgeCompletion(repoDir, homeDir, bridgePayload.runId);
      const completeEvent = [...events.events].reverse().find((event) => event.type === "complete");
      if (!completeEvent || completeEvent.status !== "succeeded") {
        throw new CliError(`Bridge run ${bridgePayload.runId} did not complete successfully.`, {
          code: "smoke_ollama_bridge_incomplete"
        });
      }

      const explainRunSnapshot = snapshotRunIds(repoDir);
      const explainResult = runDistCli(
        [
          "run",
          "Explain the bundled explain tactic and confirm the smoke path.",
          "--tactic",
          "explain",
          "--host",
          host,
          "--mode",
          "human",
          "--workflow",
          workflowPath,
          "--approve-plan"
        ],
        repoDir,
        homeDir,
        envOverrides
      );
      assertExitZero(`lineup run --tactic explain (${host})`, explainResult);
      const explainRunId = detectNewestNewRunId(repoDir, explainRunSnapshot);
      const explainDebugPaths = explainRunId ? resolveRunDebugPaths(repoDir, explainRunId) : null;

      return {
        host,
        status: "passed",
        integrationMode: preview.integrationMode,
        fallbackLaneUsed: preview.integrationMode === "env" ? "env" : preview.integrationMode === "managed" ? "managed" : "direct",
        resolvedPlannerCommand: preview.resolvedCommand,
        hostConfigPath: hostConfig,
        managedConfigPath: managedConfigPath(homeDir, host) ?? "n/a",
        homeDir,
        repoDir,
        bridgeRunId: bridgePayload.runId,
        bridgeRunRoot: bridgeDebugPaths.runRoot,
        bridgeHostTraceRoot: bridgeDebugPaths.hostTraceRoot,
        bridgeEventsPath: bridgeDebugPaths.bridgeEventsPath,
        bridgeStdoutPath: bridgeDebugPaths.bridgeStdoutPath,
        bridgeStderrPath: bridgeDebugPaths.bridgeStderrPath,
        bridgeStatePath: bridgeDebugPaths.statePath,
        bridgeDebugBundlePath: bridgeDebugPaths.debugBundlePath,
        bridgeTraceFiles: listHostTraceFiles(bridgeDebugPaths.hostTraceRoot),
        explainRunId: explainRunId ?? undefined,
        explainRunRoot: explainDebugPaths?.runRoot,
        explainHostTraceRoot: explainDebugPaths?.hostTraceRoot,
        explainTraceFiles: listHostTraceFiles(explainDebugPaths?.hostTraceRoot)
      };
    };

    const primaryPreview = resolvePlannedCommand(host, repoDir, homeDir);
    summary.integrationMode = primaryPreview.integrationMode;
    summary.fallbackLaneUsed = primaryPreview.integrationMode === "env" ? "env" : primaryPreview.integrationMode === "managed" ? "managed" : "direct";
    summary.resolvedPlannerCommand = primaryPreview.resolvedCommand;

    try {
      const primarySummary = runIntegrationSmoke();
      summary.status = primarySummary.status;
      summary.bridgeRunId = primarySummary.bridgeRunId;
      summary.bridgeRunRoot = primarySummary.bridgeRunRoot;
      summary.bridgeHostTraceRoot = primarySummary.bridgeHostTraceRoot;
      summary.bridgeEventsPath = primarySummary.bridgeEventsPath;
      summary.bridgeStdoutPath = primarySummary.bridgeStdoutPath;
      summary.bridgeStderrPath = primarySummary.bridgeStderrPath;
      summary.bridgeStatePath = primarySummary.bridgeStatePath;
      summary.bridgeDebugBundlePath = primarySummary.bridgeDebugBundlePath;
      summary.bridgeTraceFiles = primarySummary.bridgeTraceFiles;
      summary.explainRunId = primarySummary.explainRunId;
      summary.explainRunRoot = primarySummary.explainRunRoot;
      summary.explainHostTraceRoot = primarySummary.explainHostTraceRoot;
      summary.explainTraceFiles = primarySummary.explainTraceFiles;
      summary.integrationMode = primarySummary.integrationMode;
      summary.fallbackLaneUsed = primarySummary.fallbackLaneUsed;
      summary.resolvedPlannerCommand = primarySummary.resolvedPlannerCommand;
    } catch (error) {
      const errorMessage = asErrorMessage(error);

      if (host === "claude" && /stalled/i.test(errorMessage)) {
        const stalledRunId = extractBridgeRunId(errorMessage);
        if (stalledRunId) {
          summary.primaryBridgeRunId = stalledRunId;
          const primaryDebugPaths = resolveRunDebugPaths(repoDir, stalledRunId);
          summary.primaryBridgeRunRoot = primaryDebugPaths.runRoot;
          summary.primaryBridgeHostTraceRoot = primaryDebugPaths.hostTraceRoot;
          summary.primaryBridgeEventsPath = primaryDebugPaths.bridgeEventsPath;
          summary.primaryBridgeStdoutPath = primaryDebugPaths.bridgeStdoutPath;
          summary.primaryBridgeStderrPath = primaryDebugPaths.bridgeStderrPath;
          summary.primaryBridgeDebugBundlePath = primaryDebugPaths.debugBundlePath;
          summary.primaryBridgeTraceFiles = listHostTraceFiles(primaryDebugPaths.hostTraceRoot);
          cancelRun(repoDir, homeDir, stalledRunId);
        }
        const filteredPath = filterPathWithoutBinary("ollama");
        const envOverrides = {
          PATH: filteredPath
        };
        const envPreview = resolvePlannedCommand(host, repoDir, homeDir, envOverrides);
        summary.integrationMode = envPreview.integrationMode;
        summary.fallbackLaneUsed = "env";
        summary.resolvedPlannerCommand = envPreview.resolvedCommand;

        try {
          const envSummary = runIntegrationSmoke(envOverrides);
          summary.status = envSummary.status;
          summary.primaryBridgeRunId = stalledRunId ?? undefined;
          summary.integrationMode = envSummary.integrationMode;
          summary.fallbackLaneUsed = envSummary.fallbackLaneUsed;
          summary.resolvedPlannerCommand = envSummary.resolvedPlannerCommand;
          summary.bridgeRunId = envSummary.bridgeRunId;
          summary.bridgeRunRoot = envSummary.bridgeRunRoot;
          summary.bridgeHostTraceRoot = envSummary.bridgeHostTraceRoot;
          summary.bridgeEventsPath = envSummary.bridgeEventsPath;
          summary.bridgeStdoutPath = envSummary.bridgeStdoutPath;
          summary.bridgeStderrPath = envSummary.bridgeStderrPath;
          summary.bridgeStatePath = envSummary.bridgeStatePath;
          summary.bridgeDebugBundlePath = envSummary.bridgeDebugBundlePath;
          summary.bridgeTraceFiles = envSummary.bridgeTraceFiles;
          summary.explainRunId = envSummary.explainRunId;
          summary.explainRunRoot = envSummary.explainRunRoot;
          summary.explainHostTraceRoot = envSummary.explainHostTraceRoot;
          summary.explainTraceFiles = envSummary.explainTraceFiles;
        } catch (fallbackError) {
          const fallbackMessage = asErrorMessage(fallbackError);
          const fallbackRunId = extractBridgeRunId(fallbackMessage);
          if (fallbackRunId && /stalled/i.test(fallbackMessage)) {
            cancelRun(repoDir, homeDir, fallbackRunId);
          }
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }

    const managedConfig = collectManagedConfig(homeDir, host);

    process.stdout.write(
      [
        `host: ${host}`,
        `  status: ${summary.status}`,
        summary.failureClass ? `  failure_class: ${summary.failureClass}` : `  failure_class: none`,
        `  integration_mode: ${summary.integrationMode}`,
        `  fallback_lane: ${summary.fallbackLaneUsed ?? "none"}`,
        `  resolved_planner_command: ${summary.resolvedPlannerCommand}`,
        `  home: ${summary.homeDir}`,
        `  repo: ${summary.repoDir}`,
        `  preserved_temp_root: ${summary.preservedTempRoot ?? "n/a"}`,
        `  host_config: ${summary.hostConfigPath}`,
        `  managed_config: ${summary.managedConfigPath}`,
        summary.primaryBridgeRunId ? `  primary_bridge_run: ${summary.primaryBridgeRunId}` : `  primary_bridge_run: n/a`,
        `  primary_bridge_run_root: ${summary.primaryBridgeRunRoot ?? "n/a"}`,
        `  primary_bridge_host_trace_root: ${summary.primaryBridgeHostTraceRoot ?? "n/a"}`,
        `  primary_bridge_events: ${summary.primaryBridgeEventsPath ?? "n/a"}`,
        `  primary_bridge_stdout: ${summary.primaryBridgeStdoutPath ?? "n/a"}`,
        `  primary_bridge_stderr: ${summary.primaryBridgeStderrPath ?? "n/a"}`,
        `  primary_bridge_debug_bundle: ${summary.primaryBridgeDebugBundlePath ?? "n/a"}`,
        `  primary_bridge_trace_files: ${summary.primaryBridgeTraceFiles?.join(", ") ?? "n/a"}`,
        summary.bridgeRunId ? `  bridge_run: ${summary.bridgeRunId}` : `  bridge_run: n/a`,
        `  bridge_run_root: ${summary.bridgeRunRoot ?? "n/a"}`,
        `  bridge_host_trace_root: ${summary.bridgeHostTraceRoot ?? "n/a"}`,
        `  bridge_events: ${summary.bridgeEventsPath ?? "n/a"}`,
        `  bridge_stdout: ${summary.bridgeStdoutPath ?? "n/a"}`,
        `  bridge_stderr: ${summary.bridgeStderrPath ?? "n/a"}`,
        `  bridge_state: ${summary.bridgeStatePath ?? "n/a"}`,
        `  bridge_debug_bundle: ${summary.bridgeDebugBundlePath ?? "n/a"}`,
        `  bridge_trace_files: ${summary.bridgeTraceFiles?.join(", ") ?? "n/a"}`,
        `  explain_run: ${summary.explainRunId ?? "n/a"}`,
        `  explain_run_root: ${summary.explainRunRoot ?? "n/a"}`,
        `  explain_host_trace_root: ${summary.explainHostTraceRoot ?? "n/a"}`,
        `  explain_trace_files: ${summary.explainTraceFiles?.join(", ") ?? "n/a"}`,
        `  managed_config_bytes: ${managedConfig.trim().length > 0 ? Buffer.byteLength(managedConfig, "utf8") : 0}`
      ].join("\n") + "\n"
    );

    return summary;
  } catch (error) {
    summary.status = /stalled/i.test(asErrorMessage(error)) ? "stalled" : "failed";
    summary.failure = asErrorMessage(error);
    summary.failureClass = classifyFailure(error);
    summary.preservedTempRoot = rootDir;
    const inferredRunId = summary.bridgeRunId ?? extractBridgeRunId(summary.failure ?? "");
    if (inferredRunId) {
      const debugPaths = resolveRunDebugPaths(repoDir, inferredRunId);
      summary.bridgeRunId = inferredRunId;
      summary.bridgeRunRoot ??= debugPaths.runRoot;
      summary.bridgeHostTraceRoot ??= debugPaths.hostTraceRoot;
      summary.bridgeEventsPath ??= debugPaths.bridgeEventsPath;
      summary.bridgeStdoutPath ??= debugPaths.bridgeStdoutPath;
      summary.bridgeStderrPath ??= debugPaths.bridgeStderrPath;
      summary.bridgeStatePath ??= debugPaths.statePath;
      summary.bridgeDebugBundlePath ??= debugPaths.debugBundlePath;
      summary.bridgeTraceFiles ??= listHostTraceFiles(debugPaths.hostTraceRoot);
      if (!summary.primaryBridgeRunId) {
        summary.primaryBridgeRunId = inferredRunId;
        summary.primaryBridgeRunRoot ??= debugPaths.runRoot;
        summary.primaryBridgeHostTraceRoot ??= debugPaths.hostTraceRoot;
        summary.primaryBridgeEventsPath ??= debugPaths.bridgeEventsPath;
        summary.primaryBridgeStdoutPath ??= debugPaths.bridgeStdoutPath;
        summary.primaryBridgeStderrPath ??= debugPaths.bridgeStderrPath;
        summary.primaryBridgeDebugBundlePath ??= debugPaths.debugBundlePath;
        summary.primaryBridgeTraceFiles ??= listHostTraceFiles(debugPaths.hostTraceRoot);
      }
    }
    process.stdout.write(
      [
        `host: ${host}`,
        `  status: ${summary.status}`,
        `  failure_class: ${summary.failureClass}`,
        `  integration_mode: ${summary.integrationMode}`,
        `  fallback_lane: ${summary.fallbackLaneUsed ?? "none"}`,
        `  resolved_planner_command: ${summary.resolvedPlannerCommand}`,
        `  home: ${summary.homeDir}`,
        `  repo: ${summary.repoDir}`,
        `  preserved_temp_root: ${summary.preservedTempRoot}`,
        `  host_config: ${summary.hostConfigPath}`,
        `  managed_config: ${summary.managedConfigPath}`,
        summary.primaryBridgeRunId ? `  primary_bridge_run: ${summary.primaryBridgeRunId}` : `  primary_bridge_run: n/a`,
        `  primary_bridge_run_root: ${summary.primaryBridgeRunRoot ?? "n/a"}`,
        `  primary_bridge_host_trace_root: ${summary.primaryBridgeHostTraceRoot ?? "n/a"}`,
        `  primary_bridge_events: ${summary.primaryBridgeEventsPath ?? "n/a"}`,
        `  primary_bridge_stdout: ${summary.primaryBridgeStdoutPath ?? "n/a"}`,
        `  primary_bridge_stderr: ${summary.primaryBridgeStderrPath ?? "n/a"}`,
        `  primary_bridge_debug_bundle: ${summary.primaryBridgeDebugBundlePath ?? "n/a"}`,
        `  primary_bridge_trace_files: ${summary.primaryBridgeTraceFiles?.join(", ") ?? "n/a"}`,
        `  bridge_run: ${summary.bridgeRunId ?? "n/a"}`,
        `  bridge_run_root: ${summary.bridgeRunRoot ?? "n/a"}`,
        `  bridge_host_trace_root: ${summary.bridgeHostTraceRoot ?? "n/a"}`,
        `  bridge_events: ${summary.bridgeEventsPath ?? "n/a"}`,
        `  bridge_stdout: ${summary.bridgeStdoutPath ?? "n/a"}`,
        `  bridge_stderr: ${summary.bridgeStderrPath ?? "n/a"}`,
        `  bridge_state: ${summary.bridgeStatePath ?? "n/a"}`,
        `  bridge_debug_bundle: ${summary.bridgeDebugBundlePath ?? "n/a"}`,
        `  bridge_trace_files: ${summary.bridgeTraceFiles?.join(", ") ?? "n/a"}`,
        `  explain_run: ${summary.explainRunId ?? "n/a"}`,
        `  explain_run_root: ${summary.explainRunRoot ?? "n/a"}`,
        `  explain_host_trace_root: ${summary.explainHostTraceRoot ?? "n/a"}`,
        `  explain_trace_files: ${summary.explainTraceFiles?.join(", ") ?? "n/a"}`,
        `  failure: ${summary.failure}`
      ].join("\n") + "\n"
    );
    return summary;
  }
}

function resolveHosts(host: SmokeOptions["host"]): HostName[] {
  return host === "all" ? SUPPORTED_HOSTS : [host];
}

function run(): void {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = tempWorkspace();
  const summaries: HostSmokeSummary[] = [];

  try {
    for (const host of resolveHosts(options.host)) {
      summaries.push(runHostSmoke(host, options, rootDir));
    }

    const failed = summaries.filter((summary) => summary.status !== "passed");
    if (failed.length > 0) {
      throw new CliError(
        [
          "One or more Ollama host smoke checks failed.",
          ...failed.map((summary) => `${summary.host}: ${summary.status}${summary.failure ? ` - ${summary.failure}` : ""}`)
        ].join("\n"),
        { code: "smoke_ollama_summary_failed" }
      );
    }

    process.stdout.write("Ollama host smoke checks passed.\n");
  } finally {
    const shouldPreserve =
      options.keepTemp ||
      summaries.some((summary) => summary.status !== "passed" || summary.primaryBridgeRunId !== undefined);
    if (!shouldPreserve) {
      rmSync(rootDir, { recursive: true, force: true });
    } else {
      process.stdout.write(`Preserved temporary workspace: ${rootDir}\n`);
    }
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`${asErrorMessage(error)}\n`);
  process.exit(1);
}
