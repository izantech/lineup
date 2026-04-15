import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildTuiAppViewModel } from '../../src/lib/tui-app-state.js'
import { lineupRunStateFile } from '../../src/lib/paths.js'
import { createDefaultTuiSessionState, type TuiComposerState } from '../../src/tui/controller.js'

const DEFAULT_COMPOSER: TuiComposerState = {
  prompt: '',
  host: 'codex',
  workflow: undefined,
  tactic: undefined,
  isolation: 'index',
  implementMethod: 'phase',
  fromStage: undefined,
  timeout: undefined,
  gateTimeout: undefined,
  dryRun: false,
  forceRerun: false,
  approvePlan: false,
  maxParallel: 3
}

const tempDirs: string[] = []

function createTempDir(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lineup-tui-app-state-'))
  tempDirs.push(tempDir)
  return tempDir
}

function writePipelineState(cwd: string, runId: string, status: 'running' | 'blocked' | 'failed' | 'canceled') {
  const filePath = lineupRunStateFile(runId, cwd)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        apiVersion: 'lineup/v3',
        kind: 'PipelineState',
        run_id: runId,
        status,
        workflow: '/tmp/stale-workflow.yaml',
        artifact_hashes: {},
        updated_at: '2026-04-15T16:07:00.000Z'
      },
      null,
      2
    )}\n`,
    'utf8'
  )
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('buildTuiAppViewModel', () => {
  it('stays on the idle home screen when stale local runs exist but no run is selected', async () => {
    const cwd = createTempDir()
    writePipelineState(cwd, 'run-stale', 'running')

    const session = createDefaultTuiSessionState(DEFAULT_COMPOSER)
    const viewModel = await buildTuiAppViewModel({
      cwd,
      session,
      liveEventsByRunId: {}
    })

    expect(viewModel.route.screen).toBe('home')
    expect(viewModel.chrome.selectionSummary).toBeUndefined()
    expect(viewModel.chrome.runId).toBeUndefined()
    expect(viewModel.input.visible).toBe(true)
    expect(viewModel.input.label).toBe('Task prompt')
    expect(viewModel.home.latestRun?.runId).toBe('run-stale')
  })
})
