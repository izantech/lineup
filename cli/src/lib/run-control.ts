import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'

import type { LocalAgentRunner } from './agent-runner.js'
import { appendBridgeCompleteEvent, loadBridgeSession } from './bridge.js'
import { CliError } from './errors.js'
import type { GateResponse } from './gate-store.js'
import type { RunPipelineHooks, PipelineResult } from './run-pipeline.js'
import { runPipeline } from './run-pipeline.js'
import {
  appendPipelineCompletedStage,
  assertPipelineStateFresh,
  getStageRetryCount,
  loadPipelineState,
  recordStageRetry,
  savePipelineState
} from './state.js'
import { lineupRuntimeLockFile } from './paths.js'

const RESUMABLE_STATUSES = new Set(['failed', 'blocked', 'canceled'])
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

export type ResumePipelineRunOptions = {
  runId: string
  skipTask?: string
  retryFailed?: boolean
  maxRetries?: number
  cwd?: string
  localAgentRunner?: LocalAgentRunner
  emitHumanTextToStderr?: boolean
  emitProtocolToStdout?: boolean
  onProtocolMessage?: RunPipelineHooks['onProtocolMessage']
  handleHumanGate?: RunPipelineHooks['handleHumanGate']
}

export type ResumePipelineRunResult = {
  resumedFrom: string
  fromStage: string | null
  mode: 'resume' | 'retry'
  message: string
  result: PipelineResult
  retryState: Record<string, unknown>
}

export type CancelPipelineRunOptions = {
  runId: string
  cwd?: string
}

function resolveGitTreeSha(cwd = process.cwd()): string | undefined {
  try {
    return execSync('git rev-parse HEAD^{tree}', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}

function findFirstIncompleteStage(_completed: Set<string>): string | null {
  return null
}

function describeResumeTarget(
  state: NonNullable<ReturnType<typeof loadPipelineState>>,
  completedStages: Set<string>
): string {
  if (state.current_stage) {
    return `stage '${state.current_stage}'`
  }

  if (completedStages.size > 0) {
    return `the first incomplete stage after ${Array.from(completedStages).join(', ')}`
  }

  return 'the beginning'
}

function buildResumeGuidance(
  state: NonNullable<ReturnType<typeof loadPipelineState>>,
  options: ResumePipelineRunOptions,
  completedStages: Set<string>
): string {
  const base = describeResumeTarget(state, completedStages)
  const gateTimeout = [...(state.errors ?? [])].reverse().find((error) => error.code === 'gate_timeout')

  if (state.status === 'blocked') {
    if (gateTimeout) {
      return options.skipTask
        ? `Run ${options.runId} is blocked at ${base} after a gate timed out. Marked '${options.skipTask}' as complete, then continuing from ${base}. Inspect with \`lineup show ${options.runId}\` if you want the pending context first.`
        : `Run ${options.runId} is blocked at ${base} because a gate timed out. Resuming will reopen that point in the workflow. Inspect with \`lineup show ${options.runId}\`, or cancel with \`lineup cancel ${options.runId}\` if you want to stop instead.`
    }

    return options.skipTask
      ? `Run ${options.runId} is blocked at ${base}. Marked '${options.skipTask}' as complete, then continuing from ${base}. Inspect with \`lineup show ${options.runId}\` if you want to review the blocked state first.`
      : `Run ${options.runId} is blocked at ${base}. Resuming will continue from there once the blocker clears. Inspect with \`lineup show ${options.runId}\`, or cancel with \`lineup cancel ${options.runId}\` if you want to stop instead.`
  }

  if (state.status === 'canceled') {
    return `Run ${options.runId} was canceled. Resuming will continue from ${base}. Inspect with \`lineup show ${options.runId}\` before resuming if you need the previous context.`
  }

  return `Run ${options.runId} failed at ${base}. Use \`lineup resume ${options.runId} --retry-failed\` to retry only the failed stage, or inspect with \`lineup show ${options.runId}\` and \`lineup logs ${options.runId}\`.`
}

function buildRetryGuidance(
  state: NonNullable<ReturnType<typeof loadPipelineState>>,
  fromStage: string | null,
  attempt: number,
  maxRetries: number,
  lastError?: string
): string {
  const target = fromStage ?? state.current_stage ?? 'the beginning'
  const suffix = lastError ? ` Last error: ${lastError}` : ''
  return `Retrying stage '${target}' (attempt ${attempt}/${maxRetries}).${suffix}`
}

function syncBridgeCancellation(runId: string, cwd = process.cwd()): void {
  const session = loadBridgeSession(runId, cwd)
  if (!session || session.status === 'canceled') {
    return
  }

  appendBridgeCompleteEvent(
    runId,
    {
      status: 'canceled',
      summary: 'Run was canceled by the user.',
      completedAt: new Date().toISOString()
    },
    cwd
  )
}

function releaseRuntimeLockIfHeld(runId: string, cwd = process.cwd()): void {
  const lockPath = lineupRuntimeLockFile(cwd)
  if (!existsSync(lockPath)) {
    return
  }

  try {
    const current = JSON.parse(readFileSync(lockPath, 'utf8')) as { runId?: string }
    if (current.runId === runId) {
      rmSync(lockPath, { force: true })
    }
  } catch {
    return
  }
}

export async function resumePipelineRun(options: ResumePipelineRunOptions): Promise<ResumePipelineRunResult> {
  const cwd = options.cwd ?? process.cwd()
  const state = loadPipelineState(options.runId, cwd)

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: 'invalid_path' })
  }

  if (!RESUMABLE_STATUSES.has(state.status)) {
    throw new CliError(`Run ${options.runId} has status '${state.status}' and cannot be resumed.`, {
      code: 'state_mismatch'
    })
  }

  assertPipelineStateFresh(state, resolveGitTreeSha(cwd))

  if (options.skipTask) {
    savePipelineState(appendPipelineCompletedStage(state, options.skipTask), cwd)
  }

  const completedStages = new Set(state.completed_stages ?? [])
  if (options.skipTask) {
    completedStages.add(options.skipTask)
  }

  let fromStage: string | null
  let mode: 'resume' | 'retry' = 'resume'
  let guidance = buildResumeGuidance(state, options, completedStages)

  if (options.retryFailed && state.status === 'failed' && state.current_stage) {
    const maxRetries = options.maxRetries ?? 3
    const currentAttempts = getStageRetryCount(state, state.current_stage)

    if (currentAttempts >= maxRetries) {
      throw new CliError(`Stage '${state.current_stage}' has exhausted ${maxRetries} retry attempts.`, {
        code: 'command_failed'
      })
    }

    const lastError = state.errors?.[state.errors.length - 1]?.message
    savePipelineState(recordStageRetry(state, state.current_stage, maxRetries, lastError), cwd)

    fromStage = state.current_stage
    mode = 'retry'
    guidance = buildRetryGuidance(state, fromStage, currentAttempts + 1, maxRetries, lastError)
  } else {
    fromStage = state.current_stage ?? findFirstIncompleteStage(completedStages)
  }

  const result = await runPipeline(
    {
      workflow: state.workflow,
      fromStage: fromStage ?? undefined,
      gateTimeout: state.gate_timeout_seconds,
      mode: options.localAgentRunner ? 'human' : 'host',
      host: options.localAgentRunner?.host
    },
    {
      emitProtocolToStdout: options.emitProtocolToStdout,
      emitHumanTextToStderr: options.emitHumanTextToStderr,
      localAgentRunner: options.localAgentRunner,
      onProtocolMessage: options.onProtocolMessage,
      handleHumanGate: options.handleHumanGate
    }
  )

  return {
    resumedFrom: options.runId,
    fromStage,
    mode,
    message: guidance,
    result,
    retryState: state.retry_state ?? {}
  }
}

export function cancelPipelineRun(options: CancelPipelineRunOptions): {
  runId: string
  status: string
  alreadyTerminal: boolean
} {
  const cwd = options.cwd ?? process.cwd()
  const state = loadPipelineState(options.runId, cwd)

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: 'invalid_path' })
  }

  if (TERMINAL_STATUSES.has(state.status)) {
    if (state.status === 'canceled') {
      syncBridgeCancellation(options.runId, cwd)
    }

    return {
      runId: options.runId,
      status: state.status,
      alreadyTerminal: true
    }
  }

  savePipelineState({ ...state, status: 'canceled' }, cwd)
  syncBridgeCancellation(options.runId, cwd)
  releaseRuntimeLockIfHeld(options.runId, cwd)

  return {
    runId: options.runId,
    status: 'canceled',
    alreadyTerminal: false
  }
}
