import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { createArtifactStore } from './artifact-store.js'
import { createDoctorReport, type DoctorReport } from '../commands/doctor.js'
import { findPreviousRunState, formatArtifactDiffHeader } from './inspection.js'
import { lineupArtifactStoreDir, lineupRunDebugBundleFile, packageRoot } from './paths.js'
import { observePipelineRuns } from './observer.js'
import { readStatus } from './operations.js'
import { loadPipelineState, type PipelineStateRecord } from './state.js'
import type { HostName } from './constants.js'
import type {
  ArtifactKind,
  BridgeEventsResult,
  BridgeRecoveryInfo,
  BridgeSessionRecord,
  ObservedPipelineRun,
  StatusOutput
} from './types.js'
import { loadBridgeSession, readBridgeEvents } from './bridge.js'
import { isJsonRpcMessage, isJsonRpcNotification, isJsonRpcRequest, isJsonRpcSuccessResponse } from './protocol.js'
import { parseRestrictedYaml, parseWorkflowYaml } from './validation.js'

export type TuiArtifactContentResult = {
  runId: string
  kind: ArtifactKind
  path: string
  content: string
}

export type TuiArtifactPathResult = {
  runId: string
  kind: ArtifactKind
  path: string
}

export type TuiArtifactDiffResult = {
  fromRunId: string
  toRunId: string
  kind: ArtifactKind
  changed: boolean
  fromSha256: string
  toSha256: string
  fromPath: string
  toPath: string
  diff: string
  header: string
}

export type TuiLogsResult = {
  runId: string
  entries: unknown[]
}

export type TuiReplayEntry = {
  offsetMs: number
  label: string
}

export type TuiHistoryEntry = {
  run_id: string
  status: string
  workflow: string | null
  current_stage: string | null
  started_at: string | null
  finished_at: string | null
  duration_human: string | null
  completed_stages: number
  retry_count: number
}

export type TuiWorkflowEntry = {
  file: string
  name: string
  stages: number
  apiVersion: string
}

export type TuiTacticEntry = {
  name: string
  description: string
  stages: number
  source: 'project-local' | 'builtin'
}

const VALID_ARTIFACT_KINDS: ArtifactKind[] = [
  'constitution',
  'spec',
  'plan',
  'tasks',
  'review',
  'config',
  'protocol',
  'pipeline-state'
]

function assertArtifactKind(kind: string): asserts kind is ArtifactKind {
  if (!VALID_ARTIFACT_KINDS.includes(kind as ArtifactKind)) {
    throw new Error(`Unknown artifact kind "${kind}".`)
  }
}

function findRun(runs: ObservedPipelineRun[], runId?: string): ObservedPipelineRun {
  if (!runId) {
    const latest = runs[0]
    if (!latest) {
      throw new Error('No pipeline runs found.')
    }
    return latest
  }

  const run = runs.find((candidate) => candidate.run_id === runId)
  if (!run) {
    throw new Error(`Run "${runId}" not found.`)
  }
  return run
}

function findArtifact(run: ObservedPipelineRun, kind: ArtifactKind) {
  const artifact = run.artifacts.find((candidate) => candidate.kind === kind)
  if (!artifact) {
    throw new Error(`Artifact "${kind}" not found in run "${run.run_id}".`)
  }
  if (!artifact.exists) {
    throw new Error(`Artifact "${kind}" in run "${run.run_id}" is missing from the store (${artifact.path}).`)
  }
  return artifact
}

export function readArtifactContent(kind: string, runId?: string, cwd = process.cwd()): TuiArtifactContentResult {
  assertArtifactKind(kind)
  const runs = observePipelineRuns(cwd)
  const run = findRun(runs, runId)
  const artifact = findArtifact(run, kind)
  return {
    runId: run.run_id,
    kind,
    path: artifact.path,
    content: readFileSync(artifact.path, 'utf8')
  }
}

export function readArtifactPath(kind: string, runId?: string, cwd = process.cwd()): TuiArtifactPathResult {
  assertArtifactKind(kind)
  const runs = observePipelineRuns(cwd)
  const run = findRun(runs, runId)
  const artifact = findArtifact(run, kind)
  return {
    runId: run.run_id,
    kind,
    path: artifact.path
  }
}

export function readArtifactDiff(kind: string, fromRunId?: string, toRunId?: string, cwd = process.cwd()): TuiArtifactDiffResult {
  assertArtifactKind(kind)
  const runs = observePipelineRuns(cwd)
  if (runs.length < 2 && !fromRunId) {
    throw new Error('Need at least two runs to diff. Use an explicit comparison target.')
  }

  const toRun = findRun(runs, toRunId)
  const fromRun = findRun(runs, fromRunId ?? runs[1]?.run_id)
  const fromArtifact = findArtifact(fromRun, kind)
  const toArtifact = findArtifact(toRun, kind)
  const fromContent = readFileSync(fromArtifact.path, 'utf8')
  const toContent = readFileSync(toArtifact.path, 'utf8')
  const header = formatArtifactDiffHeader(kind, fromRun.run_id, toRun.run_id, fromArtifact.sha256, toArtifact.sha256)

  if (fromContent === toContent) {
    return {
      fromRunId: fromRun.run_id,
      toRunId: toRun.run_id,
      kind,
      changed: false,
      fromSha256: fromArtifact.sha256,
      toSha256: toArtifact.sha256,
      fromPath: fromArtifact.path,
      toPath: toArtifact.path,
      diff: '',
      header
    }
  }

  let diff: string
  try {
    execSync('which diff', { stdio: 'ignore' })
    diff = execSync(
      `diff -u --label "${kind}@${fromRun.run_id}" --label "${kind}@${toRun.run_id}" "${fromArtifact.path}" "${toArtifact.path}"`,
      { encoding: 'utf8' }
    )
  } catch (error) {
    const execError = error as { stdout?: string; status?: number }
    if (execError.status === 1 && execError.stdout) {
      diff = execError.stdout
    } else {
      diff = `--- ${kind}@${fromRun.run_id}\n+++ ${kind}@${toRun.run_id}\n`
      for (const line of fromContent.split('\n')) {
        diff += `-${line}\n`
      }
      for (const line of toContent.split('\n')) {
        diff += `+${line}\n`
      }
    }
  }

  return {
    fromRunId: fromRun.run_id,
    toRunId: toRun.run_id,
    kind,
    changed: true,
    fromSha256: fromArtifact.sha256,
    toSha256: toArtifact.sha256,
    fromPath: fromArtifact.path,
    toPath: toArtifact.path,
    diff,
    header
  }
}

export function readRunLogs(runId: string, cwd = process.cwd()): TuiLogsResult {
  const state = loadPipelineState(runId, cwd)
  if (!state) {
    throw new Error(`Run not found: ${runId}`)
  }

  const protocolHash = state.artifact_hashes.protocol
  const debugBundlePath = lineupRunDebugBundleFile(runId, cwd)
  const entries: unknown[] = []

  if (protocolHash) {
    const store = createArtifactStore(lineupArtifactStoreDir(cwd))
    const content = store.readText({ kind: 'protocol', format: 'json', sha256: protocolHash })
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }
      try {
        entries.push(JSON.parse(trimmed))
      } catch {
        entries.push({ raw: trimmed })
      }
    }
  }

  if (existsSync(debugBundlePath)) {
    try {
      entries.push({ type: 'debug-bundle', data: JSON.parse(readFileSync(debugBundlePath, 'utf8')) })
    } catch {
      entries.push({ type: 'debug-bundle', error: 'unreadable' })
    }
  }

  if (entries.length === 0) {
    throw new Error(`No protocol logs found for run ${runId}`)
  }

  return { runId, entries }
}

export function readRunReplay(runId: string, cwd = process.cwd()): TuiReplayEntry[] {
  const state = loadPipelineState(runId, cwd)
  if (!state?.artifact_hashes.protocol) {
    throw new Error(`No protocol logs found for run ${runId}`)
  }

  const store = createArtifactStore(lineupArtifactStoreDir(cwd))
  const content = store.readText({ kind: 'protocol', format: 'json', sha256: state.artifact_hashes.protocol })

  let rawMessages: unknown[]
  try {
    const parsed = JSON.parse(content) as unknown
    rawMessages = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    rawMessages = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return null
        }
      })
      .filter(Boolean) as unknown[]
  }

  const messages = rawMessages.filter(isJsonRpcMessage)
  const entries: TuiReplayEntry[] = []
  let seq = 0

  for (const message of messages) {
    const offsetMs = seq * 1000
    if (isJsonRpcRequest(message)) {
      const params = (message as Record<string, unknown>).params as Record<string, unknown> | undefined
      if (message.method === 'agent/spawn') {
        entries.push({
          offsetMs,
          label: `Stage "${(params?.stageId as string) ?? 'unknown'}" started`
        })
        seq++
      } else if (message.method === 'gate/request') {
        entries.push({
          offsetMs,
          label: `Gate "${(params?.stageId as string) ?? 'unknown'}" requested (${(params?.gateType as string) ?? 'unknown'})`
        })
        seq++
      }
    } else if (isJsonRpcNotification(message)) {
      const params = (message as Record<string, unknown>).params as Record<string, unknown> | undefined
      if (message.method === 'agent/done') {
        entries.push({
          offsetMs,
          label: `Stage "${(params?.stageId as string) ?? 'unknown'}" completed (${(params?.status as string) ?? 'unknown'})`
        })
        seq++
      } else if (message.method === 'pipeline/complete') {
        entries.push({
          offsetMs,
          label: `Pipeline completed (${(params?.status as string) ?? 'unknown'})`
        })
        seq++
      } else if (message.method === 'agent/cancel') {
        entries.push({
          offsetMs,
          label: `Stage "${(params?.stageId as string) ?? 'unknown'}" cancelled`
        })
        seq++
      }
    } else if (isJsonRpcSuccessResponse(message)) {
      const result = (message as Record<string, unknown>).result as Record<string, unknown> | undefined
      if (result && 'choice' in result) {
        const approved = result.approved as boolean | undefined
        entries.push({
          offsetMs,
          label: `Gate responded — ${approved === false ? 'rejected' : 'approved'} (${String(result.choice)})`
        })
        seq++
      }
    }
  }

  return entries
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatWorkflowName(workflowPath: string | null | undefined): string | null {
  if (!workflowPath) {
    return null
  }
  return path.basename(workflowPath, '.yaml')
}

export function readRunHistory(options: { status?: string; limit?: number } = {}, cwd = process.cwd()): TuiHistoryEntry[] {
  const runs = observePipelineRuns(cwd)
  const limit = options.limit ?? 20
  const states: TuiHistoryEntry[] = []

  for (const run of runs) {
    const state = loadPipelineState(run.run_id, cwd)
    if (!state) {
      continue
    }
    if (options.status && state.status !== options.status) {
      continue
    }

    const retryCount = state.retry_state
      ? Object.values(state.retry_state).reduce((sum, retry) => sum + retry.attempt, 0)
      : 0

    states.push({
      run_id: state.run_id,
      status: state.status,
      workflow: formatWorkflowName(state.workflow),
      current_stage: state.current_stage ?? null,
      started_at: state.started_at ?? state.updated_at,
      finished_at: state.finished_at ?? null,
      duration_human: state.duration_ms ? formatDuration(state.duration_ms) : null,
      completed_stages: state.completed_stages?.length ?? 0,
      retry_count: retryCount
    })
  }

  return states
    .sort((left, right) => {
      const leftTime = left.started_at ? new Date(left.started_at).getTime() : 0
      const rightTime = right.started_at ? new Date(right.started_at).getTime() : 0
      return rightTime - leftTime
    })
    .slice(0, limit)
}

export function listWorkflowEntries(cwd = process.cwd()): TuiWorkflowEntry[] {
  const dirs = [
    path.resolve(cwd, '.lineup-core', 'workflows'),
    path.resolve(cwd, '.lineup', 'workflows')
  ]
  const entries: TuiWorkflowEntry[] = []

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      continue
    }
    for (const file of readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(dir, file.name)
      try {
        const workflow = parseWorkflowYaml(readFileSync(filePath, 'utf8'), filePath)
        entries.push({
          file: file.name,
          name: workflow.name,
          stages: workflow.stages.length,
          apiVersion: workflow.apiVersion
        })
      } catch {
        entries.push({
          file: file.name,
          name: '(invalid)',
          stages: 0,
          apiVersion: 'unknown'
        })
      }
    }
  }

  return entries
}

function scanTactics(dir: string, source: 'project-local' | 'builtin'): TuiTacticEntry[] {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((file) => {
      const filePath = path.join(dir, file.name)
      try {
        const parsed = parseRestrictedYaml(readFileSync(filePath, 'utf8'), filePath) as {
          name?: string
          description?: string
          stages?: unknown[]
        }
        const description = parsed.description ?? ''
        return {
          name: parsed.name ?? file.name.replace(/\.yaml$/, ''),
          description: description.length > 60 ? `${description.slice(0, 57)}...` : description,
          stages: Array.isArray(parsed.stages) ? parsed.stages.length : 0,
          source
        }
      } catch {
        return {
          name: file.name.replace(/\.yaml$/, ''),
          description: '(invalid)',
          stages: 0,
          source
        }
      }
    })
}

export function listTacticEntries(cwd = process.cwd(), includeBuiltins = true): TuiTacticEntry[] {
  const dirs: Array<{ dir: string; source: 'project-local' | 'builtin' }> = [
    { dir: path.resolve(cwd, '.lineup', 'tactics'), source: 'project-local' },
    { dir: path.resolve(cwd, 'tactics'), source: 'project-local' }
  ]

  if (includeBuiltins) {
    dirs.push({ dir: path.resolve(packageRoot(), 'tactics'), source: 'builtin' })
  }

  return dirs.flatMap(({ dir, source }) => scanTactics(dir, source))
}

export async function readTuiReadiness(cwd = process.cwd(), homeDir?: string): Promise<{
  doctor: DoctorReport
  status: StatusOutput
}> {
  const doctor = createDoctorReport(cwd, homeDir)
  const status = await readStatus(['claude', 'codex', 'opencode'] as HostName[])
  return { doctor, status }
}

export async function readBridgeRecovery(runId: string, cwd = process.cwd()): Promise<{
  session: BridgeSessionRecord | null
  events: BridgeEventsResult | null
  recovery: BridgeRecoveryInfo | null
}> {
  const session = loadBridgeSession(runId, cwd)
  if (!session) {
    return { session: null, events: null, recovery: null }
  }

  const events = await readBridgeEvents(runId, {}, cwd)
  return {
    session,
    events,
    recovery: events.recovery
  }
}

export function readPreviousRunState(runId: string, cwd = process.cwd()): PipelineStateRecord | null {
  return findPreviousRunState(runId, cwd)
}
