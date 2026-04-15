import { describe, expect, it } from 'vitest'

import { HomeView } from '../../src/tui/views/home-view'
import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { createTuiAction, createTuiHomeViewModel } from '../../src/tui/types'

describe('HomeView', () => {
  it('renders readiness, latest run, and quick actions', () => {
    const viewModel = createTuiHomeViewModel({
      title: 'Home',
      subtitle: 'Repository overview',
      repoPath: '/tmp/repo',
      readiness: [
        {
          id: 'git',
          label: 'Git repository detected',
          status: 'ready',
          detail: 'The current working tree is clean',
          action: createTuiAction({ id: 'open', label: 'Open repo' })
        }
      ],
      latestRun: {
        runId: 'run-123',
        status: 'running',
        stage: 'plan',
        summary: 'waiting on approval',
        updatedAt: '2026-04-12T12:00:00.000Z',
        recoveryHint: 'Resume from the run list',
        actions: [createTuiAction({ id: 'resume', label: 'Resume run', shortcut: 'r' })]
      },
      recentRuns: [
        {
          runId: 'run-100',
          status: 'succeeded',
          stage: 'verify',
          updatedAt: '2026-04-12T11:00:00.000Z',
          summary: 'completed successfully'
        }
      ],
      quickActions: [
        createTuiAction({ id: 'start', label: 'Start run', shortcut: 'enter' })
      ],
      notes: ['Use the composer to fill in a prompt']
    })

    const node = HomeView({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Readiness')
    expect(text).toContain('Latest run')
    expect(text).toContain('run-123')
    expect(text).toContain('Start run')
    expect(text).toContain('Resume run')
    expect(text).not.toContain('The main agent will')
    expect(text).not.toContain('No quick actions')
    expect(snapshot).toContain('<Box')
    expect(snapshot).toContain('Git repository detected')
  })
})
