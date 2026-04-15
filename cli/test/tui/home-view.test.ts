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
      focusedSection: 'quickActions',
      selectedActionId: 'init',
      selectedReadinessId: 'git',
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
        workflow: 'default',
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
        createTuiAction({ id: 'init', label: 'Initialize repo', shortcut: 'i' }),
        createTuiAction({ id: 'start', label: 'Start run', shortcut: 'enter' })
      ],
      notes: ['Use the composer to fill in a prompt']
    })

    viewModel.latestRun = {
      ...viewModel.latestRun!,
      recoveryAction: 'resume',
      recoveryCommand: 'lineup bridge answer run-123 request-9 --choice resume',
      expiresAt: '2026-04-12T12:30:00.000Z',
      artifactLabel: 'Plan artifact',
      artifactSummary: 'Plan preview is ready for review',
      relatedArtifactLabel: 'Task list',
      relatedArtifactSummary: 'Related task breakdown and follow-up work'
    } as typeof viewModel.latestRun

    const node = HomeView({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Readiness')
    expect(text).toContain('Latest run')
    expect(text).toContain('run-123')
    expect(text).toContain('Selected readiness')
    expect(text).toContain('Recovery and artifact context')
    expect(text).toContain('recovery:')
    expect(text).toContain('resume')
    expect(text).toContain('Plan preview is ready for review')
    expect(text).toContain('Initialize repo')
    expect(text).toContain('Start run')
    expect(text).toContain('Resume run')
    expect(text).not.toContain('The main agent will')
    expect(text).not.toContain('No quick actions')
    expect(snapshot).toContain('<Box')
    expect(snapshot).toContain('section=Quick actions [active] border=true tone=accent')
    expect(snapshot).toContain('Git repository detected')
  })
})
