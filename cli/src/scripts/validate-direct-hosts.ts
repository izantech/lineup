import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { spawn as spawnPty } from 'node-pty'

import type { DoctorReport } from '../commands/doctor.js'
import { SUPPORTED_HOSTS, type HostName } from '../lib/constants.js'
import { CliError, asErrorMessage } from '../lib/errors.js'
import { captureFileActivity, hasFileActivity, listImmediateFiles } from '../lib/file-activity.js'
import {
  lineupRunBridgeEventsFile,
  lineupRunBridgeStderrLogFile,
  lineupRunBridgeStdoutLogFile,
  lineupRunDebugBundleFile,
  lineupRunDir,
  lineupRunStateFile,
  lineupRuntimeLockFile,
  lineupRunsDir,
  packageRoot
} from '../lib/paths.js'
import {
  classifyHumanTranscriptPrompt,
  classifyValidationFailure,
  laneSelection,
  parseValidateDirectHostArgs,
  type BlockerClassification,
  type ValidationLane,
  type ValidationOptions,
  type ValidationScenario
} from './validate-direct-hosts-helpers.js'

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type HumanPtyProcess = {
  onData(handler: (chunk: string) => void): void;
  onExit(handler: ({ exitCode }: { exitCode: number }) => void): void;
  write(chunk: string): void;
  kill(): void;
};

type PreflightSummary = {
  status: 'passed' | 'failed';
  buildCommand: string;
  smokeCommand: string;
  failure?: string;
  blockerClassification?: BlockerClassification;
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

type BridgeStartPayload = {
  runId: string;
  status: string;
  workerPid?: number;
  executorHost: HostName;
};

type BridgeRecovery = {
  action: 'answer' | 'resume' | 'inspect';
  command: string;
  message?: string;
};

type BridgeQuestionPayload = {
  type: 'question';
  seq: number;
  requestId: number;
  stageId?: string;
  gateType?: string;
  question?: string;
  choices?: string[];
  defaultChoice?: string;
  context?: string;
  allowFreeText?: boolean;
  createdAt?: string;
  expiresAt?: string;
};

type BridgeStatusPayload = {
  type: 'status';
  seq: number;
  stageId?: string;
  stageLabel?: string;
  kind?: string;
  text?: string;
};

type BridgeCompletePayload = {
  type: 'complete';
  seq: number;
  status: 'succeeded' | 'blocked' | 'failed' | 'canceled';
  summary?: string;
  completedAt?: string;
};

type BridgeEventsPayload = {
  events: Array<BridgeStatusPayload | BridgeQuestionPayload | BridgeCompletePayload>;
  nextCursor?: number;
  terminal?: boolean;
  status?: string;
  session?: {
    executorHost?: HostName;
    currentSeq?: number;
  };
  pendingQuestion?: Omit<BridgeQuestionPayload, 'type' | 'seq'>;
  recovery?: BridgeRecovery;
};

type AnswerMode = 'certification' | 'verify-abort';

type RunReference = {
  runId: string;
  runRoot: string;
  traceFiles: string[];
  artifactKinds: string[];
  summary?: string;
  transcriptPath?: string;
};

type BridgeWaitResult = {
  payload: BridgeEventsPayload;
  finalEvent: BridgeCompletePayload;
  answeredQuestions: number;
  answeredGateTypes: string[];
  firstAnsweredQuestion?: {
    requestId: number;
    gateType?: string;
    choice: string;
  };
};

type ScenarioResult = {
  scenario: ValidationScenario;
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
  blockerClassification?: BlockerClassification;
  run?: RunReference;
  secondaryRun?: RunReference;
  diffFiles?: string[];
  transcriptPath?: string;
  failure?: string;
};

type LaneReport = {
  lane: Exclude<ValidationLane, 'all'>;
  status: 'passed' | 'failed' | 'skipped';
  repoDir?: string;
  preservedPath?: string;
  scenarios: ScenarioResult[];
  failure?: string;
  blockerClassification?: BlockerClassification;
};

type HostValidationReport = {
  host: HostName;
  hostVersion: string;
  lanes: Partial<Record<Exclude<ValidationLane, 'all'>, LaneReport>>;
};

type ArtifactParitySummary = {
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
  blockerClassification?: BlockerClassification;
};

type ValidationReport = {
  generatedAt: string;
  repoRoot: string;
  tempRoot: string;
  overallStatus: 'passed' | 'failed';
  supportStatementReady: boolean;
  selectedHosts: HostName[];
  selectedLane: ValidationLane;
  selectedScenario?: ValidationScenario;
  preflight?: PreflightSummary;
  hosts: HostValidationReport[];
  artifactParity?: ArtifactParitySummary;
};

const DIRECT_HOST_PLACEHOLDER = 'REPLACE_ME_VALIDATE_DIRECT_HOST_EXECUTION'
const DIRECT_HOST_SENTENCE = 'This repo validates direct host execution.'
const REAL_REPO_DOCS_MARKER = 'REPLACE_ME_VALIDATE_REAL_REPO_DOCS'
const REAL_REPO_DOCS_SENTENCE = 'This docs file validates the real-repo direct-host docs lane.'
const REAL_REPO_README_MARKER = 'REPLACE_ME_VALIDATE_REAL_REPO_README'
const REAL_REPO_README_SENTENCE = 'This README line validates the real-repo direct-host multi-file lane.'

const DIRECT_HOST_PROMPT = [
  'Run the full Lineup direct-host certification task on this tiny repo.',
  `Replace \`${DIRECT_HOST_PLACEHOLDER}\` in README.md with exactly \`${DIRECT_HOST_SENTENCE}\` once.`,
  'For research, inspect README.md first and stop once you have enough evidence to complete the task.',
  'Do not propose unrelated repo changes or create extra files for this validation task.',
  'Do not inspect host config, runtime logs, bridge files, or network endpoints.',
  'Keep artifacts concise and structured.'
].join(' ')

const EXPLAIN_PROMPT = 'Explain how this tiny repo is set up for direct-host Lineup validation.'
const REAL_REPO_ANALYSIS_PROMPT = 'Explain how Lineup’s direct-host validation and bridge contract work in this repository.'
const REAL_REPO_DOCS_PROMPT = [
  'Update the seeded docs-only validation marker in this Lineup repo worktree.',
  `Replace \`${REAL_REPO_DOCS_MARKER}\` in docs/commands.md with exactly \`${REAL_REPO_DOCS_SENTENCE}\` once.`,
  'Do not modify any other files.'
].join(' ')
const REAL_REPO_MULTI_PROMPT = [
  'Update the seeded multi-file validation markers in this Lineup repo worktree.',
  `Replace \`${REAL_REPO_README_MARKER}\` in README.md with exactly \`${REAL_REPO_README_SENTENCE}\` once.`,
  `Replace \`${REAL_REPO_DOCS_MARKER}\` in docs/commands.md with exactly \`${REAL_REPO_DOCS_SENTENCE}\` once.`,
  'Do not modify any other files.'
].join(' ')
const REAL_REPO_PLAN_APPROVAL_PROMPT = [
  'Run the real-repo plan-approval validation task on this Lineup worktree.',
  `Replace \`${REAL_REPO_DOCS_MARKER}\` in docs/commands.md with exactly \`${REAL_REPO_DOCS_SENTENCE}\` once.`,
  'Do not modify any other files.'
].join(' ')

const LANE_SCENARIOS: Record<Exclude<ValidationLane, 'all'>, ValidationScenario[]> = {
  bridge: ['implementation', 'explain'],
  recovery: ['gate-timeout', 'late-answer', 'cancel', 'lock-conflict', 'retry-failed'],
  human: ['implementation', 'explain'],
  'real-repo': ['analysis-only', 'docs-only', 'multi-file', 'plan-approval', 'resume-recovery']
}
const CREATED_WORKTREES = new Set<string>()

function repoRoot(): string {
  return path.resolve(packageRoot(), '..')
}

function tempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'lineup-validate-direct-hosts-'))
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: npm --prefix cli run validate:direct-hosts -- [options]',
      '',
      'Options:',
      '  --host claude|codex|opencode|all   Host or hosts to validate (default: all)',
      '  --lane bridge|recovery|human|real-repo|all',
      '                                     Validation lane to execute (default: all)',
      '  --scenario <name>                  Focus on one scenario within the selected lane',
      '  --report <path>                    Write the JSON validation report to a file',
      '  --skip-preflight                   Skip ./dev check and the Ollama smoke baseline',
      '  --skip-certification               Legacy alias to skip the bridge lane when --lane all',
      '  --skip-recovery                    Legacy alias to skip the recovery lane when --lane all',
      '  --keep-temp                        Preserve temporary validation repos/worktrees',
      '  -h, --help                         Show this help'
    ].join('\n') + '\n'
  )
}

function runCommand(cwd: string, args: [string, ...string[]], envOverrides: NodeJS.ProcessEnv = {}): CommandResult {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...envOverrides
    }
  })

  if (result.error) {
    throw new CliError(`Failed to execute ${args[0]}: ${result.error.message}`, {
      code: 'validate_direct_spawn_failed'
    })
  }

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

function runDistCli(args: string[], cwd: string, envOverrides: NodeJS.ProcessEnv = {}): CommandResult {
  return runCommand(cwd, [process.execPath, path.join(packageRoot(), 'bin', 'lineup.mjs'), ...args], envOverrides)
}

function assertExitZero(label: string, result: CommandResult): void {
  if (result.status === 0) {
    return
  }

  throw new CliError(
    [
      `${label} failed with exit code ${result.status ?? 'null'}.`,
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null
    ].filter(Boolean).join('\n'),
    { code: 'validate_direct_command_failed' }
  )
}

function parseJson<T>(label: string, output: string): T {
  try {
    const parsed = JSON.parse(output.trim()) as unknown
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('not an object')
    }
    return parsed as T
  } catch (error) {
    throw new CliError(
      `${label} returned invalid JSON:\n${output.trim()}\n${error instanceof Error ? error.message : String(error)}`,
      { code: 'validate_direct_invalid_json' }
    )
  }
}

function ensureDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
}

function resolveHosts(host: ValidationOptions['host']): HostName[] {
  return host === 'all' ? [...SUPPORTED_HOSTS] : [host]
}

function initGitRepo(repoDir: string, options: { failingTest?: boolean } = {}): void {
  assertExitZero('git init', runCommand(repoDir, ['git', 'init']))
  assertExitZero('git config user.email', runCommand(repoDir, ['git', 'config', 'user.email', 'lineup@example.com']))
  assertExitZero('git config user.name', runCommand(repoDir, ['git', 'config', 'user.name', 'Lineup Validation']))
  assertExitZero('git config commit.gpgsign', runCommand(repoDir, ['git', 'config', 'commit.gpgsign', 'false']))

  writeFileSync(
    path.join(repoDir, 'README.md'),
    `# Lineup direct-host validation\n\n${DIRECT_HOST_PLACEHOLDER}\n`,
    'utf8'
  )
  writeFileSync(path.join(repoDir, '.gitignore'), '.lineup/\n', 'utf8')

  if (options.failingTest) {
    writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify(
        {
          name: 'lineup-direct-host-validation',
          private: true,
          scripts: {
            test: "node -e \"process.exit(require('node:fs').existsSync('ALLOW_PASS') ? 0 : 1)\""
          }
        },
        null,
        2
      ) + '\n',
      'utf8'
    )
  }

  assertExitZero('git add', runCommand(repoDir, ['git', 'add', 'README.md', '.gitignore', ...(options.failingTest ? ['package.json'] : [])]))
  assertExitZero('git commit', runCommand(repoDir, ['git', 'commit', '-m', 'Initial commit']))
}

function resolveWorkflowPath(repoDir: string): string {
  const sourceWorkflowPath = path.resolve(repoRoot(), '.lineup-core', 'workflows', 'full-pipeline.yaml')
  if (!existsSync(sourceWorkflowPath)) {
    throw new CliError(`Expected source workflow was not found: ${sourceWorkflowPath}`, {
      code: 'validate_direct_missing_source_workflow'
    })
  }

  const workflowPath = path.join(repoDir, '.lineup-core', 'workflows', 'full-pipeline.yaml')
  ensureDir(workflowPath)
  copyFileSync(sourceWorkflowPath, workflowPath)
  assertExitZero('git add workflow', runCommand(repoDir, ['git', 'add', workflowPath]))
  assertExitZero('git commit workflow', runCommand(repoDir, ['git', 'commit', '-m', 'Add Lineup workflow']))
  return workflowPath
}

function configureGitIdentity(repoDir: string): void {
  assertExitZero('git config user.email', runCommand(repoDir, ['git', 'config', 'user.email', 'lineup@example.com']))
  assertExitZero('git config user.name', runCommand(repoDir, ['git', 'config', 'user.name', 'Lineup Validation']))
  assertExitZero('git config commit.gpgsign', runCommand(repoDir, ['git', 'config', 'commit.gpgsign', 'false']))
}

function setupValidationRepo(baseDir: string, options: { failingTest?: boolean } = {}): { repoDir: string; workflowPath: string } {
  mkdirSync(baseDir, { recursive: true })
  initGitRepo(baseDir, options)
  const initResult = runDistCli(['init', '--workflow', 'full-pipeline', '--json'], baseDir)
  assertExitZero('lineup init --workflow full-pipeline --json', initResult)
  const workflowPath = resolveWorkflowPath(baseDir)
  const doctorResult = runDistCli(['doctor', '--json'], baseDir)
  assertExitZero('lineup doctor --json', doctorResult)
  return { repoDir: baseDir, workflowPath }
}

function setupRealRepoWorktree(baseDir: string, name: string): string {
  const worktreeDir = path.join(baseDir, name)
  assertExitZero(`git worktree add ${worktreeDir}`, runCommand(repoRoot(), ['git', 'worktree', 'add', '--detach', worktreeDir, 'HEAD']))
  configureGitIdentity(worktreeDir)
  CREATED_WORKTREES.add(worktreeDir)
  return worktreeDir
}

function resolveRunDebugPaths(repoDir: string, runId: string): RunDebugPaths {
  const runRoot = lineupRunDir(runId, repoDir)
  return {
    runRoot,
    artifactRoot: path.join(runRoot, 'artifacts'),
    hostTraceRoot: path.join(runRoot, 'host'),
    bridgeEventsPath: lineupRunBridgeEventsFile(runId, repoDir),
    bridgeStdoutPath: lineupRunBridgeStdoutLogFile(runId, repoDir),
    bridgeStderrPath: lineupRunBridgeStderrLogFile(runId, repoDir),
    statePath: lineupRunStateFile(runId, repoDir),
    debugBundlePath: lineupRunDebugBundleFile(runId, repoDir)
  }
}

function trackedRunFiles(debugPaths: RunDebugPaths): string[] {
  return [
    debugPaths.bridgeStdoutPath,
    debugPaths.bridgeStderrPath,
    ...listImmediateFiles(debugPaths.hostTraceRoot),
    ...listImmediateFiles(debugPaths.artifactRoot)
  ]
}

function detectNewestNewRunId(repoDir: string, before: string[]): string | null {
  const beforeSet = new Set(before)
  const runsDir = lineupRunsDir(repoDir)
  if (!existsSync(runsDir)) {
    return null
  }

  const candidates = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !beforeSet.has(entry.name))
    .map((entry) => ({
      runId: entry.name,
      mtimeMs: statSync(path.join(runsDir, entry.name)).mtimeMs
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  return candidates[0]?.runId ?? null
}

function snapshotRunIds(repoDir: string): string[] {
  const runsDir = lineupRunsDir(repoDir)
  if (!existsSync(runsDir)) {
    return []
  }

  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function hostVersion(host: HostName, cwd: string): string {
  for (const args of [[host, '--version'], [host, 'version']] as Array<[string, ...string[]]>) {
    const result = runCommand(cwd, args)
    if (result.status === 0) {
      const text = `${result.stdout}\n${result.stderr}`.trim()
      if (text) {
        return text.split('\n')[0] ?? text
      }
    }
  }

  return 'unknown'
}

function validateHostReady(report: DoctorReport, host: HostName): void {
  const check = report.checks.hosts[host]
  if (!check?.ok) {
    throw new CliError(`${host} is not ready for direct-host validation: ${check?.detail ?? 'missing host check'}`, {
      code: 'validate_direct_host_unavailable'
    })
  }
}

function chooseBridgeAnswer(question: Omit<BridgeQuestionPayload, 'type' | 'seq'>, mode: AnswerMode): { choice: string; reason?: string } {
  if (question.gateType === 'classify' && question.choices?.includes('simple')) {
    return {
      choice: 'simple',
      reason: 'Bounded validation task with deterministic marker replacement only.'
    }
  }

  if (question.gateType === 'approval' && question.choices?.includes('approve')) {
    return { choice: 'approve' }
  }

  if (question.gateType === 'verify-decision') {
    if (mode === 'verify-abort' && question.choices?.includes('abort')) {
      return {
        choice: 'abort',
        reason: 'Force a failed run so retry-failed can be validated.'
      }
    }
    if (question.choices?.includes('accept')) {
      return { choice: 'accept' }
    }
  }

  if (question.defaultChoice) {
    return { choice: question.defaultChoice }
  }

  if (question.choices?.[0]) {
    return { choice: question.choices[0] }
  }

  if (question.allowFreeText) {
    return { choice: 'Proceed with the bounded validation task only.' }
  }

  throw new CliError(`Bridge question ${question.requestId} did not include a supported answer path.`, {
    code: 'validate_direct_missing_bridge_choice'
  })
}

function answerBridgeQuestion(
  repoDir: string,
  runId: string,
  question: Omit<BridgeQuestionPayload, 'type' | 'seq'>,
  mode: AnswerMode
): { choice: string; reason?: string } {
  const answer = chooseBridgeAnswer(question, mode)
  const args = ['bridge', 'answer', runId, String(question.requestId), '--choice', answer.choice, '--json']
  if (answer.reason) {
    args.push('--reason', answer.reason)
  }
  const result = runDistCli(args, repoDir)
  assertExitZero(`lineup bridge answer ${runId} ${question.requestId}`, result)
  return answer
}

function waitForBridgeTerminal(
  repoDir: string,
  runId: string,
  options: {
    mode: AnswerMode;
    autoAnswer: boolean;
    acceptStatuses: Array<BridgeCompletePayload['status']>;
  }
): BridgeWaitResult {
  let cursor = 0
  let lastPayload: BridgeEventsPayload | null = null
  const debugPaths = resolveRunDebugPaths(repoDir, runId)
  let lastProgressAt = Date.now()
  let lastFileActivity = captureFileActivity(trackedRunFiles(debugPaths))
  const answeredRequestIds = new Set<number>()
  const answeredGateTypes: string[] = []
  let answeredQuestions = 0
  let firstAnsweredQuestion: BridgeWaitResult['firstAnsweredQuestion']
  const deadline = Date.now() + 10 * 60 * 1000
  const noProgressDeadlineMs = 5 * 60 * 1000

  while (Date.now() < deadline) {
    const result = runDistCli(['bridge', 'events', runId, '--after', String(cursor), '--wait', '1', '--json'], repoDir)
    assertExitZero(`lineup bridge events ${runId}`, result)
    const payload = parseJson<BridgeEventsPayload>('bridge events', result.stdout)
    lastPayload = payload

    for (const event of payload.events) {
      cursor = Math.max(cursor, event.seq)
      lastProgressAt = Date.now()

      if (event.type === 'question' && options.autoAnswer && !answeredRequestIds.has(event.requestId)) {
        const answer = answerBridgeQuestion(repoDir, runId, event, options.mode)
        answeredRequestIds.add(event.requestId)
        answeredGateTypes.push(event.gateType ?? 'unknown')
        answeredQuestions += 1
        firstAnsweredQuestion ??= {
          requestId: event.requestId,
          gateType: event.gateType,
          choice: answer.choice
        }
      }

      if (event.type === 'complete') {
        if (!options.acceptStatuses.includes(event.status)) {
          throw new CliError(
            `Bridge run ${runId} completed with status ${event.status}: ${event.summary ?? 'no summary'}`,
            { code: 'validate_direct_unexpected_bridge_status' }
          )
        }
        return {
          payload,
          finalEvent: event,
          answeredQuestions,
          answeredGateTypes,
          firstAnsweredQuestion
        }
      }
    }

    if (payload.pendingQuestion && options.autoAnswer && !answeredRequestIds.has(payload.pendingQuestion.requestId)) {
      const answer = answerBridgeQuestion(repoDir, runId, payload.pendingQuestion, options.mode)
      answeredRequestIds.add(payload.pendingQuestion.requestId)
      answeredGateTypes.push(payload.pendingQuestion.gateType ?? 'unknown')
      answeredQuestions += 1
      firstAnsweredQuestion ??= {
        requestId: payload.pendingQuestion.requestId,
        gateType: payload.pendingQuestion.gateType,
        choice: answer.choice
      }
      lastProgressAt = Date.now()
    }

    const currentFileActivity = captureFileActivity(trackedRunFiles(debugPaths))
    if (hasFileActivity(lastFileActivity, currentFileActivity)) {
      lastProgressAt = Date.now()
      lastFileActivity = currentFileActivity
    }

    if (Date.now() - lastProgressAt > noProgressDeadlineMs) {
      throw new CliError(
        `Bridge run ${runId} stalled: no progress for ${Math.floor(noProgressDeadlineMs / 1000)} seconds.`,
        { code: 'validate_direct_bridge_stalled' }
      )
    }
  }

  throw new CliError(
    `Timed out waiting for bridge completion on ${runId}.${lastPayload ? ` Last payload: ${JSON.stringify(lastPayload)}` : ''}`,
    { code: 'validate_direct_bridge_timeout' }
  )
}

function waitForBridgeQuestion(repoDir: string, runId: string): Omit<BridgeQuestionPayload, 'type' | 'seq'> {
  let cursor = 0
  const deadline = Date.now() + 2 * 60 * 1000

  while (Date.now() < deadline) {
    const result = runDistCli(['bridge', 'events', runId, '--after', String(cursor), '--wait', '1', '--json'], repoDir)
    assertExitZero(`lineup bridge events ${runId}`, result)
    const payload = parseJson<BridgeEventsPayload>('bridge events', result.stdout)

    for (const event of payload.events) {
      cursor = Math.max(cursor, event.seq)
      if (event.type === 'question') {
        return event
      }
      if (event.type === 'complete') {
        throw new CliError(`Bridge run ${runId} completed before producing a question.`, {
          code: 'validate_direct_missing_question'
        })
      }
    }

    if (payload.pendingQuestion) {
      return payload.pendingQuestion
    }
  }

  throw new CliError(`Timed out waiting for a bridge question on ${runId}.`, {
    code: 'validate_direct_question_timeout'
  })
}

function startBridgeRun(repoDir: string, args: string[]): BridgeStartPayload {
  const before = snapshotRunIds(repoDir)
  const result = runDistCli(args, repoDir)
  assertExitZero(args.join(' '), result)
  const payload = parseJson<BridgeStartPayload>('bridge start', result.stdout)
  if (!payload.runId) {
    const fallbackRunId = detectNewestNewRunId(repoDir, before)
    if (!fallbackRunId) {
      throw new CliError(`Bridge start did not return a run id.\n${result.stdout}`, {
        code: 'validate_direct_missing_run_id'
      })
    }
    payload.runId = fallbackRunId
  }
  return payload
}

function validateReadme(repoDir: string): number {
  const contents = readFileSync(path.join(repoDir, 'README.md'), 'utf8')
  return contents.split(DIRECT_HOST_SENTENCE).length - 1
}

function validateExactSentence(repoDir: string, relativePath: string, sentence: string): number {
  const contents = readFileSync(path.join(repoDir, relativePath), 'utf8')
  return contents.split(sentence).length - 1
}

function diffFiles(repoDir: string): string[] {
  const result = runCommand(repoDir, ['git', 'diff', '--name-only', 'HEAD'])
  assertExitZero('git diff --name-only HEAD', result)
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
}

function verifyInspectionCommands(repoDir: string, runId: string): { showOk: boolean; logsOk: boolean } {
  const showResult = runDistCli(['show', runId, '--json'], repoDir)
  const logsResult = runDistCli(['logs', runId, '--json'], repoDir)
  return {
    showOk: showResult.status === 0,
    logsOk: logsResult.status === 0
  }
}

function listTraceFiles(repoDir: string, runId: string): string[] {
  return listImmediateFiles(resolveRunDebugPaths(repoDir, runId).hostTraceRoot)
}

function listArtifactKinds(runRoot: string): string[] {
  const artifactRoot = path.join(runRoot, 'artifacts')
  if (!existsSync(artifactRoot)) {
    return []
  }
  return readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.replace(/\.[^.]+$/, ''))
    .sort()
}

function waitForRuntimeLock(repoDir: string, runId: string): void {
  const lockPath = lineupRuntimeLockFile(repoDir)
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    if (existsSync(lockPath)) {
      try {
        const record = JSON.parse(readFileSync(lockPath, 'utf8')) as { runId?: string }
        if (record.runId === runId) {
          return
        }
      } catch {
        // continue polling
      }
    }

    spawnSync(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 250)'], { stdio: 'ignore' })
  }

  throw new CliError(`Timed out waiting for runtime lock ownership by ${runId}.`, {
    code: 'validate_direct_runtime_lock_timeout'
  })
}

function buildRunReference(repoDir: string, runId: string, summary?: string, transcriptPath?: string): RunReference {
  const debugPaths = resolveRunDebugPaths(repoDir, runId)
  return {
    runId,
    runRoot: debugPaths.runRoot,
    traceFiles: listTraceFiles(repoDir, runId),
    artifactKinds: listArtifactKinds(debugPaths.runRoot),
    summary,
    ...(transcriptPath ? { transcriptPath } : {})
  }
}

function scenarioSelected(lane: Exclude<ValidationLane, 'all'>, scenario: ValidationScenario | undefined): boolean {
  if (!scenario) {
    return true
  }
  return LANE_SCENARIOS[lane].includes(scenario)
}

function scenarioFailure(scenario: ValidationScenario, error: unknown): ScenarioResult {
  const failure = asErrorMessage(error)
  return {
    scenario,
    status: 'failed',
    detail: failure,
    failure,
    blockerClassification: classifyValidationFailure(failure)
  }
}

function finalizeLane(lane: Exclude<ValidationLane, 'all'>, repoDir: string | undefined, scenarios: ScenarioResult[]): LaneReport {
  if (scenarios.length === 0) {
    return {
      lane,
      status: 'skipped',
      repoDir,
      scenarios: []
    }
  }

  const failed = scenarios.find((scenario) => scenario.status === 'failed')
  return {
    lane,
    status: failed ? 'failed' : scenarios.every((scenario) => scenario.status === 'skipped') ? 'skipped' : 'passed',
    repoDir,
    scenarios,
    ...(failed
      ? {
          failure: failed.failure ?? failed.detail,
          blockerClassification: failed.blockerClassification
        }
      : {})
  }
}

function runPreflight(): PreflightSummary {
  const summary: PreflightSummary = {
    status: 'failed',
    buildCommand: './dev check',
    smokeCommand: 'npm --prefix cli run smoke:ollama-hosts -- --host all --model qwen3-coder:30b'
  }

  try {
    assertExitZero('./dev check', runCommand(repoRoot(), ['./dev', 'check']))
    assertExitZero(
      'npm --prefix cli run smoke:ollama-hosts -- --host all --model qwen3-coder:30b',
      runCommand(repoRoot(), ['npm', '--prefix', 'cli', 'run', 'smoke:ollama-hosts', '--', '--host', 'all', '--model', 'qwen3-coder:30b'])
    )
    summary.status = 'passed'
    return summary
  } catch (error) {
    summary.failure = asErrorMessage(error)
    summary.blockerClassification = classifyValidationFailure(summary.failure)
    return summary
  }
}

function runBridgeLane(host: HostName, tempRoot: string, requestedScenario?: ValidationScenario): LaneReport {
  const repoDir = path.join(tempRoot, 'bridge', host)
  const scenarios: ScenarioResult[] = []

  try {
    const setup = setupValidationRepo(repoDir)
    const doctorResult = runDistCli(['doctor', '--json'], repoDir)
    const doctorReport = parseJson<DoctorReport>('doctor --json', doctorResult.stdout)
    validateHostReady(doctorReport, host)

    if (scenarioSelected('bridge', requestedScenario) && (!requestedScenario || requestedScenario === 'implementation')) {
      try {
        const implementationStart = startBridgeRun(repoDir, [
          'bridge',
          'start',
          DIRECT_HOST_PROMPT,
          '--executor-host',
          host,
          '--workflow',
          setup.workflowPath,
          '--timeout',
          '90',
          '--json'
        ])
        const implementationWait = waitForBridgeTerminal(repoDir, implementationStart.runId, {
          mode: 'certification',
          autoAnswer: true,
          acceptStatuses: ['succeeded']
        })
        const inspection = verifyInspectionCommands(repoDir, implementationStart.runId)
        const repoDiffFiles = diffFiles(repoDir)
        const readmeOccurrences = validateReadme(repoDir)
        if (
          repoDiffFiles.length !== 1 ||
          repoDiffFiles[0] !== 'README.md' ||
          readmeOccurrences !== 1 ||
          !inspection.showOk ||
          !inspection.logsOk
        ) {
          throw new CliError(
            `Unexpected bridge validation outcome for ${host}: diff=${repoDiffFiles.join(',') || 'none'} readme_occurrences=${String(readmeOccurrences)} show_ok=${String(inspection.showOk)} logs_ok=${String(inspection.logsOk)}`,
            { code: 'validate_direct_bridge_mismatch' }
          )
        }
        scenarios.push({
          scenario: 'implementation',
          status: 'passed',
          detail: implementationWait.finalEvent.summary ?? 'Bounded implementation bridge run succeeded.',
          run: buildRunReference(repoDir, implementationStart.runId, implementationWait.finalEvent.summary),
          diffFiles: repoDiffFiles
        })
      } catch (error) {
        scenarios.push(scenarioFailure('implementation', error))
      }
    }

    if (scenarioSelected('bridge', requestedScenario) && (!requestedScenario || requestedScenario === 'explain')) {
      try {
        const explainStart = startBridgeRun(repoDir, [
          'bridge',
          'start',
          EXPLAIN_PROMPT,
          '--executor-host',
          host,
          '--tactic',
          'explain',
          '--timeout',
          '180',
          '--json'
        ])
        const explainWait = waitForBridgeTerminal(repoDir, explainStart.runId, {
          mode: 'certification',
          autoAnswer: true,
          acceptStatuses: ['succeeded']
        })
        scenarios.push({
          scenario: 'explain',
          status: 'passed',
          detail: explainWait.finalEvent.summary ?? 'Bounded explain bridge run succeeded.',
          run: buildRunReference(repoDir, explainStart.runId, explainWait.finalEvent.summary),
          diffFiles: diffFiles(repoDir)
        })
      } catch (error) {
        scenarios.push(scenarioFailure('explain', error))
      }
    }

    return finalizeLane('bridge', repoDir, scenarios)
  } catch (error) {
    return {
      lane: 'bridge',
      status: 'failed',
      repoDir,
      scenarios,
      failure: asErrorMessage(error),
      blockerClassification: classifyValidationFailure(asErrorMessage(error))
    }
  }
}

async function runHumanCommand(
  repoDir: string,
  args: string[],
  transcriptPath: string,
  runTimeoutMs = 10 * 60 * 1000
): Promise<{ exitCode: number; transcript: string; runId: string }> {
  ensureDir(transcriptPath)
  const before = snapshotRunIds(repoDir)
  let transcript = ''
  let lastResponseSignature = ''
  const pty = createHumanPtyProcess(repoDir, args)

  const settled = await new Promise<{ exitCode: number }>((resolve, reject) => {
    const timer = setTimeout(() => {
      pty.kill()
      reject(new CliError(`Human-mode run timed out after ${runTimeoutMs}ms.`, {
        code: 'validate_direct_human_timeout'
      }))
    }, runTimeoutMs)

    pty.onData((chunk) => {
      transcript += chunk
      writeFileSync(transcriptPath, transcript, 'utf8')
      const prompt = classifyHumanTranscriptPrompt(transcript)
      const signature = `${prompt.kind}:${prompt.response ?? ''}:${transcript.slice(-240)}`
      if (prompt.kind !== 'none' && prompt.response && signature !== lastResponseSignature) {
        lastResponseSignature = signature
        pty.write(prompt.response)
      }
    })

    pty.onExit(({ exitCode }) => {
      clearTimeout(timer)
      resolve({ exitCode })
    })
  })

  writeFileSync(transcriptPath, transcript, 'utf8')
  const runId = detectNewestNewRunId(repoDir, before)
  if (!runId) {
    throw new CliError(`Human-mode run did not create a new Lineup run.\n${transcript}`, {
      code: 'validate_direct_missing_human_run'
    })
  }

  return {
    exitCode: settled.exitCode,
    transcript,
    runId
  }
}

function createHumanPtyProcess(repoDir: string, args: string[]): HumanPtyProcess {
  const command = process.execPath
  const commandArgs = [path.join(packageRoot(), 'bin', 'lineup.mjs'), ...args]
  const shell = process.env.SHELL ?? '/bin/zsh'
  const env = {
    ...process.env,
    TERM: process.env.TERM ?? 'xterm-256color'
  }

  try {
    const pty = spawnPty(shell, ['-lc', shellEscapeCommand([command, ...commandArgs])], {
      cwd: repoDir,
      cols: 120,
      rows: 40,
      env
    })

    return {
      onData(handler) {
        pty.onData(handler)
      },
      onExit(handler) {
        pty.onExit(({ exitCode }) => handler({ exitCode }))
      },
      write(chunk) {
        pty.write(chunk)
      },
      kill() {
        pty.kill()
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('posix_spawnp failed')) {
      throw error
    }

    return createScriptBackedHumanPty(repoDir, command, commandArgs, env)
  }
}

function createScriptBackedHumanPty(
  repoDir: string,
  command: string,
  commandArgs: string[],
  env: NodeJS.ProcessEnv
): HumanPtyProcess {
  const dataHandlers = new Set<(chunk: string) => void>()
  const exitHandlers = new Set<({ exitCode }: { exitCode: number }) => void>()
  const child = spawn('python3', ['-u', '-c', buildPythonPtyBroker(), command, ...commandArgs], {
    cwd: repoDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const emitData = (chunk: string): void => {
    for (const handler of dataHandlers) {
      handler(chunk)
    }
  }

  child.stdout.on('data', (chunk) => emitData(chunk.toString()))
  child.stderr.on('data', (chunk) => emitData(chunk.toString()))
  child.on('error', (error) => {
    emitData(`${error.message}\n`)
  })
  child.on('close', (code) => {
    for (const handler of exitHandlers) {
      handler({ exitCode: code ?? 1 })
    }
  })

  return {
    onData(handler) {
      dataHandlers.add(handler)
    },
    onExit(handler) {
      exitHandlers.add(handler)
    },
    write(chunk) {
      child.stdin.write(chunk)
    },
    kill() {
      child.kill('SIGTERM')
    }
  }
}

function shellEscapeCommand(parts: string[]): string {
  return parts
    .map((part) => `'${part.replace(/'/g, `'\\''`)}'`)
    .join(' ')
}

function buildPythonPtyBroker(): string {
  return [
    'import os, pty, select, subprocess, sys',
    'master, slave = pty.openpty()',
    'proc = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, close_fds=True)',
    'os.close(slave)',
    'stdin_fd = sys.stdin.fileno()',
    'while True:',
    '    watch = [master, stdin_fd]',
    '    readable, _, _ = select.select(watch, [], [], 0.1)',
    '    if master in readable:',
    '        try:',
    '            data = os.read(master, 4096)',
    '        except OSError:',
    '            data = b""',
    '        if data:',
    '            sys.stdout.buffer.write(data)',
    '            sys.stdout.buffer.flush()',
    '        elif proc.poll() is not None:',
    '            break',
    '    if stdin_fd in readable:',
    '        data = os.read(stdin_fd, 4096)',
    '        if data:',
    '            os.write(master, data)',
    '    if proc.poll() is not None and master not in readable:',
    '        try:',
    '            data = os.read(master, 4096)',
    '            if data:',
    '                sys.stdout.buffer.write(data)',
    '                sys.stdout.buffer.flush()',
    '        except OSError:',
    '            pass',
    '        break',
    'sys.exit(proc.wait())'
  ].join('\n')
}

async function runHumanLane(host: HostName, tempRoot: string, requestedScenario?: ValidationScenario): Promise<LaneReport> {
  const repoDir = path.join(tempRoot, 'human', host)
  const scenarios: ScenarioResult[] = []

  try {
    const setup = setupValidationRepo(repoDir)
    const doctorResult = runDistCli(['doctor', '--json'], repoDir)
    const doctorReport = parseJson<DoctorReport>('doctor --json', doctorResult.stdout)
    validateHostReady(doctorReport, host)

    if (scenarioSelected('human', requestedScenario) && (!requestedScenario || requestedScenario === 'implementation')) {
      try {
        const transcriptPath = path.join(repoDir, '.lineup', 'human-transcripts', `${host}-implementation.log`)
        const humanRun = await runHumanCommand(
          repoDir,
          ['run', DIRECT_HOST_PROMPT, '--mode', 'human', '--host', host, '--workflow', setup.workflowPath, '--timeout', '90'],
          transcriptPath
        )
        if (humanRun.exitCode !== 0) {
          throw new CliError(`Human-mode implementation exited with code ${humanRun.exitCode}.`, {
            code: 'validate_direct_human_exit_code'
          })
        }
        const repoDiffFiles = diffFiles(repoDir)
        const readmeOccurrences = validateReadme(repoDir)
        const inspection = verifyInspectionCommands(repoDir, humanRun.runId)
        if (
          repoDiffFiles.length !== 1 ||
          repoDiffFiles[0] !== 'README.md' ||
          readmeOccurrences !== 1 ||
          !inspection.showOk ||
          !inspection.logsOk
        ) {
          throw new CliError(
            `Unexpected human implementation outcome for ${host}: diff=${repoDiffFiles.join(',') || 'none'} readme_occurrences=${String(readmeOccurrences)} show_ok=${String(inspection.showOk)} logs_ok=${String(inspection.logsOk)}`,
            { code: 'validate_direct_human_mismatch' }
          )
        }
        scenarios.push({
          scenario: 'implementation',
          status: 'passed',
          detail: 'Human-mode bounded implementation run succeeded.',
          run: buildRunReference(repoDir, humanRun.runId, 'Human-mode bounded implementation run succeeded.', transcriptPath),
          diffFiles: repoDiffFiles,
          transcriptPath
        })
      } catch (error) {
        scenarios.push(scenarioFailure('implementation', error))
      }
    }

    if (scenarioSelected('human', requestedScenario) && (!requestedScenario || requestedScenario === 'explain')) {
      try {
        const transcriptPath = path.join(repoDir, '.lineup', 'human-transcripts', `${host}-explain.log`)
        const humanRun = await runHumanCommand(
          repoDir,
          ['run', EXPLAIN_PROMPT, '--mode', 'human', '--host', host, '--tactic', 'explain', '--timeout', '180'],
          transcriptPath
        )
        if (humanRun.exitCode !== 0) {
          throw new CliError(`Human-mode explain exited with code ${humanRun.exitCode}.`, {
            code: 'validate_direct_human_exit_code'
          })
        }
        scenarios.push({
          scenario: 'explain',
          status: 'passed',
          detail: 'Human-mode bounded explain run succeeded.',
          run: buildRunReference(repoDir, humanRun.runId, 'Human-mode bounded explain run succeeded.', transcriptPath),
          diffFiles: diffFiles(repoDir),
          transcriptPath
        })
      } catch (error) {
        scenarios.push(scenarioFailure('explain', error))
      }
    }

    return finalizeLane('human', repoDir, scenarios)
  } catch (error) {
    return {
      lane: 'human',
      status: 'failed',
      repoDir,
      scenarios,
      failure: asErrorMessage(error),
      blockerClassification: classifyValidationFailure(asErrorMessage(error))
    }
  }
}

function appendMarkerAndCommit(repoDir: string, relativePath: string, marker: string, commitMessage: string): void {
  const filePath = path.join(repoDir, relativePath)
  const contents = readFileSync(filePath, 'utf8').replace(/\s*$/, '\n')
  writeFileSync(filePath, `${contents}\n${marker}\n`, 'utf8')
  assertExitZero('git add seeded marker', runCommand(repoDir, ['git', 'add', relativePath]))
  assertExitZero('git commit seeded marker', runCommand(repoDir, ['git', 'commit', '-m', commitMessage]))
}

function runRealRepoBridgeScenario(
  worktreeDir: string,
  host: HostName,
  prompt: string,
  options: {
    tactic?: string;
    approvePlan?: boolean;
    expectDiffFiles: string[];
    expectSentenceChecks?: Array<{ path: string; sentence: string; count: number }>;
    expectApprovalGate?: boolean;
  }
): ScenarioResult {
  const before = snapshotRunIds(worktreeDir)
  const args = [
    'bridge',
    'start',
    prompt,
    '--executor-host',
    host,
    '--timeout',
    '90',
    '--json'
  ]
  if (options.tactic) {
    args.push('--tactic', options.tactic)
  }
  if (options.approvePlan) {
    args.push('--approve-plan')
  }

  const start = startBridgeRun(worktreeDir, args)
  const wait = waitForBridgeTerminal(worktreeDir, start.runId, {
    mode: 'certification',
    autoAnswer: true,
    acceptStatuses: ['succeeded']
  })
  const repoDiffFiles = diffFiles(worktreeDir)
  const inspection = verifyInspectionCommands(worktreeDir, start.runId)
  if (repoDiffFiles.join('\n') !== options.expectDiffFiles.join('\n')) {
    throw new CliError(
      `Unexpected real-repo diff for ${start.runId}: expected ${options.expectDiffFiles.join(',') || 'none'} got ${repoDiffFiles.join(',') || 'none'}`,
      { code: 'validate_direct_real_repo_diff_mismatch' }
    )
  }
  if (!inspection.showOk || !inspection.logsOk) {
    throw new CliError(`Real-repo inspection commands failed for ${start.runId}.`, {
      code: 'validate_direct_real_repo_inspection_failed'
    })
  }
  for (const check of options.expectSentenceChecks ?? []) {
    const occurrences = validateExactSentence(worktreeDir, check.path, check.sentence)
    if (occurrences !== check.count) {
      throw new CliError(`Expected ${check.count} occurrences of '${check.sentence}' in ${check.path}, got ${occurrences}.`, {
        code: 'validate_direct_real_repo_sentence_mismatch'
      })
    }
  }
  if (options.expectApprovalGate && !wait.answeredGateTypes.includes('approval')) {
    throw new CliError(`Expected an approval gate during ${start.runId}, but answered gate types were ${wait.answeredGateTypes.join(', ') || 'none'}.`, {
      code: 'validate_direct_missing_approval_gate'
    })
  }
  const runId = detectNewestNewRunId(worktreeDir, before) ?? start.runId
  return {
    scenario: 'analysis-only',
    status: 'passed',
    detail: wait.finalEvent.summary ?? 'Real-repo scenario succeeded.',
    run: buildRunReference(worktreeDir, runId, wait.finalEvent.summary),
    diffFiles: repoDiffFiles
  }
}

function runRealRepoLane(
  host: HostName,
  tempRoot: string,
  recoveryLane?: LaneReport,
  requestedScenario?: ValidationScenario
): LaneReport {
  const baseDir = path.join(tempRoot, 'real-repo', host)
  mkdirSync(baseDir, { recursive: true })
  const scenarios: ScenarioResult[] = []

  const maybeRun = (
    scenario: ValidationScenario,
    name: string,
    fn: (worktreeDir: string) => ScenarioResult
  ): void => {
    if (!scenarioSelected('real-repo', requestedScenario) || (requestedScenario && requestedScenario !== scenario)) {
      return
    }

    let worktreeDir = ''
    try {
      worktreeDir = setupRealRepoWorktree(baseDir, name)
      const result = fn(worktreeDir)
      scenarios.push({ ...result, scenario })
    } catch (error) {
      scenarios.push(scenarioFailure(scenario, error))
    }
  }

  try {
    maybeRun('analysis-only', 'analysis-only', (worktreeDir) =>
      runRealRepoBridgeScenario(worktreeDir, host, REAL_REPO_ANALYSIS_PROMPT, {
        tactic: 'explain',
        expectDiffFiles: []
      })
    )

    maybeRun('docs-only', 'docs-only', (worktreeDir) => {
      appendMarkerAndCommit(worktreeDir, 'docs/commands.md', REAL_REPO_DOCS_MARKER, 'Seed real-repo docs marker')
      return {
        ...runRealRepoBridgeScenario(worktreeDir, host, REAL_REPO_DOCS_PROMPT, {
          approvePlan: true,
          expectDiffFiles: ['docs/commands.md'],
          expectSentenceChecks: [{ path: 'docs/commands.md', sentence: REAL_REPO_DOCS_SENTENCE, count: 1 }]
        }),
        scenario: 'docs-only'
      }
    })

    maybeRun('multi-file', 'multi-file', (worktreeDir) => {
      appendMarkerAndCommit(worktreeDir, 'README.md', REAL_REPO_README_MARKER, 'Seed real-repo readme marker')
      appendMarkerAndCommit(worktreeDir, 'docs/commands.md', REAL_REPO_DOCS_MARKER, 'Seed real-repo docs marker')
      return {
        ...runRealRepoBridgeScenario(worktreeDir, host, REAL_REPO_MULTI_PROMPT, {
          approvePlan: true,
          expectDiffFiles: ['README.md', 'docs/commands.md'],
          expectSentenceChecks: [
            { path: 'README.md', sentence: REAL_REPO_README_SENTENCE, count: 1 },
            { path: 'docs/commands.md', sentence: REAL_REPO_DOCS_SENTENCE, count: 1 }
          ]
        }),
        scenario: 'multi-file'
      }
    })

    maybeRun('plan-approval', 'plan-approval', (worktreeDir) => {
      appendMarkerAndCommit(worktreeDir, 'docs/commands.md', REAL_REPO_DOCS_MARKER, 'Seed real-repo plan approval marker')
      return {
        ...runRealRepoBridgeScenario(worktreeDir, host, REAL_REPO_PLAN_APPROVAL_PROMPT, {
          expectDiffFiles: ['docs/commands.md'],
          expectSentenceChecks: [{ path: 'docs/commands.md', sentence: REAL_REPO_DOCS_SENTENCE, count: 1 }],
          expectApprovalGate: true
        }),
        scenario: 'plan-approval'
      }
    })

    if (scenarioSelected('real-repo', requestedScenario) && (!requestedScenario || requestedScenario === 'resume-recovery')) {
      const retryScenario = recoveryLane?.scenarios.find((scenario) => scenario.scenario === 'retry-failed' && scenario.status === 'passed')
      if (retryScenario?.run) {
        scenarios.push({
          scenario: 'resume-recovery',
          status: 'passed',
          detail: `Reused bounded recovery run ${retryScenario.run.runId} for resume/recovery evidence.`,
          secondaryRun: retryScenario.run
        })
      } else {
        scenarios.push({
          scenario: 'resume-recovery',
          status: 'failed',
          detail: 'No successful retry-failed recovery run was available to reuse for the real-repo resume/recovery scenario.',
          failure: 'Recovery lane did not produce a reusable retry-failed run.',
          blockerClassification: 'expected_variance'
        })
      }
    }

    return finalizeLane('real-repo', baseDir, scenarios)
  } catch (error) {
    return {
      lane: 'real-repo',
      status: 'failed',
      repoDir: baseDir,
      scenarios,
      failure: asErrorMessage(error),
      blockerClassification: classifyValidationFailure(asErrorMessage(error))
    }
  }
}

function runRecoveryLane(host: HostName, tempRoot: string, requestedScenario?: ValidationScenario): LaneReport {
  const repoDir = path.join(tempRoot, 'recovery', host)
  const scenarios: ScenarioResult[] = []

  const record = (result: ScenarioResult): void => {
    scenarios.push(result)
  }

  try {
    const setup = setupValidationRepo(repoDir)
    const doctorResult = runDistCli(['doctor', '--json'], repoDir)
    const doctorReport = parseJson<DoctorReport>('doctor --json', doctorResult.stdout)
    validateHostReady(doctorReport, host)

    if (!requestedScenario || requestedScenario === 'gate-timeout') {
      try {
        const timeoutStart = startBridgeRun(repoDir, [
          'bridge',
          'start',
          DIRECT_HOST_PROMPT,
          '--executor-host',
          host,
          '--workflow',
          setup.workflowPath,
          '--gate-timeout',
          '1',
          '--timeout',
          '90',
          '--json'
        ])
        const timeoutQuestion = waitForBridgeQuestion(repoDir, timeoutStart.runId)
        const timeoutWait = waitForBridgeTerminal(repoDir, timeoutStart.runId, {
          mode: 'certification',
          autoAnswer: false,
          acceptStatuses: ['blocked']
        })
        if (timeoutWait.payload.recovery?.action !== 'resume') {
          throw new CliError(`Expected recovery.action=resume for ${timeoutStart.runId}.`, {
            code: 'validate_direct_missing_resume_recovery'
          })
        }
        record({
          scenario: 'gate-timeout',
          status: 'passed',
          detail: timeoutWait.finalEvent.summary ?? 'Blocked after gate timeout with resume recovery.',
          run: buildRunReference(repoDir, timeoutStart.runId, timeoutWait.finalEvent.summary),
          secondaryRun: {
            runId: String(timeoutQuestion.requestId),
            runRoot: resolveRunDebugPaths(repoDir, timeoutStart.runId).runRoot,
            traceFiles: [],
            artifactKinds: []
          }
        })
      } catch (error) {
        record(scenarioFailure('gate-timeout', error))
      }
    }

    if (!requestedScenario || requestedScenario === 'late-answer') {
      try {
        const timeoutScenario = scenarios.find((scenario) => scenario.scenario === 'gate-timeout' && scenario.status === 'passed')
        const timeoutRunId = timeoutScenario?.run?.runId
        if (!timeoutRunId) {
          throw new CliError('Late-answer scenario requires a successful gate-timeout scenario in the same run.', {
            code: 'validate_direct_missing_timeout_prereq'
          })
        }
        const timeoutQuestion = waitForBridgeQuestion(repoDir, timeoutRunId)
        const lateAnswer = runDistCli(
          ['bridge', 'answer', timeoutRunId, String(timeoutQuestion.requestId), '--choice', 'approve', '--json'],
          repoDir
        )
        const lateAnswerPayload = lateAnswer.status === 0
          ? parseJson<{ accepted?: boolean; recovery?: { command?: string }; message?: string }>('bridge answer --json', lateAnswer.stdout)
          : null
        const lateAnswerGuidance = lateAnswerPayload?.recovery?.command || lateAnswerPayload?.message || `${lateAnswer.stdout}\n${lateAnswer.stderr}`
        if (
          (lateAnswer.status === 0 && lateAnswerPayload?.accepted !== false) ||
          !lateAnswerGuidance.includes(`lineup resume ${timeoutRunId}`)
        ) {
          throw new CliError(`Late answer did not provide resume guidance for ${timeoutRunId}.`, {
            code: 'validate_direct_late_answer_missing_guidance'
          })
        }
        record({
          scenario: 'late-answer',
          status: 'passed',
          detail: lateAnswerGuidance.trim(),
          run: buildRunReference(repoDir, timeoutRunId, lateAnswerGuidance.trim())
        })
      } catch (error) {
        record(scenarioFailure('late-answer', error))
      }
    }

    if (!requestedScenario || requestedScenario === 'cancel') {
      try {
        const cancelStart = startBridgeRun(repoDir, [
          'bridge',
          'start',
          DIRECT_HOST_PROMPT,
          '--executor-host',
          host,
          '--workflow',
          setup.workflowPath,
          '--timeout',
          '90',
          '--json'
        ])
        waitForBridgeQuestion(repoDir, cancelStart.runId)
        const cancelResult = runDistCli(['cancel', cancelStart.runId, '--json'], repoDir)
        assertExitZero(`lineup cancel ${cancelStart.runId}`, cancelResult)
        const canceled = waitForBridgeTerminal(repoDir, cancelStart.runId, {
          mode: 'certification',
          autoAnswer: false,
          acceptStatuses: ['canceled']
        })
        record({
          scenario: 'cancel',
          status: 'passed',
          detail: canceled.finalEvent.summary ?? 'Run canceled successfully.',
          run: buildRunReference(repoDir, cancelStart.runId, canceled.finalEvent.summary)
        })
      } catch (error) {
        record(scenarioFailure('cancel', error))
      }
    }

    if (!requestedScenario || requestedScenario === 'lock-conflict') {
      try {
        const lockStart = startBridgeRun(repoDir, [
          'bridge',
          'start',
          DIRECT_HOST_PROMPT,
          '--executor-host',
          host,
          '--workflow',
          setup.workflowPath,
          '--approve-plan',
          '--timeout',
          '90',
          '--json'
        ])
        const lockQuestion = waitForBridgeQuestion(repoDir, lockStart.runId)
        answerBridgeQuestion(repoDir, lockStart.runId, lockQuestion, 'certification')
        waitForRuntimeLock(repoDir, lockStart.runId)
        const beforeConflictRuns = snapshotRunIds(repoDir)
        const lockConflictStart = runDistCli(
          ['bridge', 'start', DIRECT_HOST_PROMPT, '--executor-host', host, '--workflow', setup.workflowPath, '--approve-plan', '--timeout', '90', '--json'],
          repoDir
        )
        let lockConflictDetail = `${lockConflictStart.stdout}\n${lockConflictStart.stderr}`.trim()
        if (lockConflictStart.status === 0) {
          const lockConflictPayload = parseJson<BridgeStartPayload>('bridge start', lockConflictStart.stdout)
          const lockConflictRunId = lockConflictPayload.runId && lockConflictPayload.runId.length >= 6
            ? lockConflictPayload.runId
            : detectNewestNewRunId(repoDir, beforeConflictRuns)
          if (!lockConflictRunId) {
            throw new CliError('Could not infer the lock-conflict run id for the second bridge session.', {
              code: 'validate_direct_infer_lock_conflict_run_id_failed'
            })
          }
          const lockConflictWait = waitForBridgeTerminal(repoDir, lockConflictRunId, {
            mode: 'certification',
            autoAnswer: false,
            acceptStatuses: ['failed']
          })
          lockConflictDetail = lockConflictWait.finalEvent.summary ?? lockConflictDetail
        }
        if (
          !lockConflictDetail.includes(`lineup show ${lockStart.runId}`) ||
          !lockConflictDetail.includes(`lineup cancel ${lockStart.runId}`)
        ) {
          throw new CliError(`Lock conflict did not reference the active run ${lockStart.runId}.`, {
            code: 'validate_direct_lock_conflict_missing_guidance'
          })
        }
        assertExitZero(`lineup cancel ${lockStart.runId}`, runDistCli(['cancel', lockStart.runId, '--json'], repoDir))
        waitForBridgeTerminal(repoDir, lockStart.runId, {
          mode: 'certification',
          autoAnswer: false,
          acceptStatuses: ['canceled']
        })
        record({
          scenario: 'lock-conflict',
          status: 'passed',
          detail: lockConflictDetail,
          run: buildRunReference(repoDir, lockStart.runId, lockConflictDetail)
        })
      } catch (error) {
        record(scenarioFailure('lock-conflict', error))
      }
    }

    if (!requestedScenario || requestedScenario === 'retry-failed') {
      try {
        const retryRepoDir = path.join(tempRoot, 'recovery', `${host}-retry`)
        const retrySetup = setupValidationRepo(retryRepoDir, { failingTest: true })
        const retryStart = startBridgeRun(retryRepoDir, [
          'bridge',
          'start',
          DIRECT_HOST_PROMPT,
          '--executor-host',
          host,
          '--workflow',
          retrySetup.workflowPath,
          '--approve-plan',
          '--timeout',
          '45',
          '--json'
        ])
        const retryWait = waitForBridgeTerminal(retryRepoDir, retryStart.runId, {
          mode: 'verify-abort',
          autoAnswer: true,
          acceptStatuses: ['failed']
        })
        if (!retryWait.finalEvent.summary?.includes(`lineup resume ${retryStart.runId} --retry-failed`)) {
          throw new CliError(`Failed run ${retryStart.runId} did not surface retry-failed guidance.`, {
            code: 'validate_direct_missing_retry_guidance'
          })
        }
        writeFileSync(path.join(retryRepoDir, 'ALLOW_PASS'), 'ok\n', 'utf8')
        const resumeResult = runDistCli(['resume', retryStart.runId, '--retry-failed', '--json'], retryRepoDir)
        assertExitZero(`lineup resume ${retryStart.runId} --retry-failed --json`, resumeResult)
        const resumed = parseJson<{ status: string; from_stage?: string; mode?: string; message?: string }>('resume --json', resumeResult.stdout)
        if (resumed.mode !== 'retry' || resumed.from_stage !== 'verify' || resumed.status !== 'success') {
          throw new CliError(`Retry result for ${retryStart.runId} was unexpected: ${JSON.stringify(resumed)}`, {
            code: 'validate_direct_retry_result_mismatch'
          })
        }
        record({
          scenario: 'retry-failed',
          status: 'passed',
          detail: resumed.message ?? 'retry-failed resumed from verify successfully',
          run: buildRunReference(retryRepoDir, retryStart.runId, retryWait.finalEvent.summary)
        })
      } catch (error) {
        record(scenarioFailure('retry-failed', error))
      }
    }

    return finalizeLane('recovery', repoDir, scenarios)
  } catch (error) {
    return {
      lane: 'recovery',
      status: 'failed',
      repoDir,
      scenarios,
      failure: asErrorMessage(error),
      blockerClassification: classifyValidationFailure(asErrorMessage(error))
    }
  }
}

function compareArtifactParity(hostReports: HostValidationReport[]): ArtifactParitySummary {
  const bridgeImplementationRuns = hostReports
    .map((report) => ({
      host: report.host,
      implementation: report.lanes.bridge?.scenarios.find((scenario) => scenario.scenario === 'implementation' && scenario.status === 'passed')
    }))
    .filter((item) => item.implementation?.run)

  if (bridgeImplementationRuns.length < 2) {
    return {
      status: 'skipped',
      detail: 'Artifact parity requires at least two successful bounded bridge implementation runs.'
    }
  }

  const baselineKinds = bridgeImplementationRuns[0]?.implementation?.run?.artifactKinds.join(',')
  const mismatch = bridgeImplementationRuns.find((item) => item.implementation?.run?.artifactKinds.join(',') !== baselineKinds)
  if (mismatch) {
    return {
      status: 'failed',
      detail: `Artifact kind mismatch between hosts; baseline=${baselineKinds ?? 'none'} mismatch_host=${mismatch.host} mismatch=${mismatch.implementation?.run?.artifactKinds.join(',') ?? 'none'}`,
      blockerClassification: 'contract_breakage'
    }
  }

  const humanMismatch = hostReports.find((report) => {
    const bridgeRun = report.lanes.bridge?.scenarios.find((scenario) => scenario.scenario === 'implementation' && scenario.status === 'passed')?.run
    const humanRun = report.lanes.human?.scenarios.find((scenario) => scenario.scenario === 'implementation' && scenario.status === 'passed')?.run
    if (!bridgeRun || !humanRun) {
      return false
    }
    return bridgeRun.artifactKinds.join(',') !== humanRun.artifactKinds.join(',')
  })

  if (humanMismatch) {
    return {
      status: 'failed',
      detail: `Human/bridge artifact mismatch on ${humanMismatch.host}.`,
      blockerClassification: 'contract_breakage'
    }
  }

  return {
    status: 'passed',
    detail: 'Bounded bridge artifacts match across validated hosts, and human/bridge artifact kinds are aligned per host.'
  }
}

async function runValidation(options: ValidationOptions): Promise<ValidationReport> {
  const tempRoot = tempWorkspace()
  const selectedHosts = resolveHosts(options.host)
  const lanes = laneSelection(options)
  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    repoRoot: repoRoot(),
    tempRoot,
    overallStatus: 'failed',
    supportStatementReady: false,
    selectedHosts,
    selectedLane: options.lane,
    ...(options.scenario ? { selectedScenario: options.scenario } : {}),
    hosts: []
  }

  try {
    if (!options.skipPreflight) {
      report.preflight = runPreflight()
    }

    for (const host of selectedHosts) {
      const hostReport: HostValidationReport = {
        host,
        hostVersion: hostVersion(host, repoRoot()),
        lanes: {}
      }

      if (lanes.bridge) {
        hostReport.lanes.bridge = runBridgeLane(host, tempRoot, options.scenario)
      }
      if (lanes.recovery) {
        hostReport.lanes.recovery = runRecoveryLane(host, tempRoot, options.scenario)
      }
      if (lanes.human) {
        hostReport.lanes.human = await runHumanLane(host, tempRoot, options.scenario)
      }
      if (lanes.realRepo) {
        hostReport.lanes['real-repo'] = runRealRepoLane(host, tempRoot, hostReport.lanes.recovery, options.scenario)
      }

      report.hosts.push(hostReport)
    }

    report.artifactParity = compareArtifactParity(report.hosts)
    const failed = [
      report.preflight?.status === 'failed',
      report.hosts.some((host) => Object.values(host.lanes).some((lane) => lane && lane.status === 'failed')),
      report.artifactParity.status === 'failed'
    ].some(Boolean)

    report.overallStatus = failed ? 'failed' : 'passed'
    report.supportStatementReady =
      report.overallStatus === 'passed' &&
      report.selectedHosts.length === SUPPORTED_HOSTS.length &&
      options.lane === 'all' &&
      !options.scenario &&
      (report.preflight?.status ?? 'passed') === 'passed'

    if (options.reportPath) {
      const resolvedPath = path.resolve(options.reportPath)
      ensureDir(resolvedPath)
      writeFileSync(resolvedPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
    }

    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return report
  } finally {
    if (options.keepTemp || report.overallStatus !== 'passed') {
      process.stdout.write(`Preserved temporary workspace: ${tempRoot}\n`)
    } else {
      for (const worktreeDir of CREATED_WORKTREES) {
        runCommand(repoRoot(), ['git', 'worktree', 'remove', '--force', worktreeDir])
      }
      CREATED_WORKTREES.clear()
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }
}

export async function main(argv = process.argv.slice(2)): Promise<ValidationReport> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  const options = parseValidateDirectHostArgs(argv, SUPPORTED_HOSTS)
  return runValidation(options)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await main()
    if (report.overallStatus !== 'passed') {
      process.exit(1)
    }
  } catch (error) {
    process.stderr.write(`${asErrorMessage(error)}\n`)
    process.exit(1)
  }
}
