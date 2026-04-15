import { describe, expect, it } from 'vitest'

import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { InspectionView } from '../../src/tui/views/inspection-view'
import { createTuiAction, createTuiInspectionViewModel } from '../../src/tui/types'

describe('InspectionView', () => {
  it('renders the unified inspect workspace panes and recovery summary', () => {
    const viewModel = createTuiInspectionViewModel({
      title: 'Inspect run',
      runId: 'run-123',
      status: 'blocked',
      summary: 'Blocked on approval and ready to resume',
      activePane: 'logs',
      focusedSection: 'artifacts',
      sections: [
        {
          title: 'Overview',
          tone: 'accent',
          body: ['This run is waiting for inspection in the unified workspace.']
        },
        {
          title: 'Bridge recovery',
          tone: 'warning',
          body: [
            'Use the bridge events stream to inspect the last question.',
            'Resume or inspect the run from the recovery command.'
          ],
          actions: [createTuiAction({ id: 'resume', label: 'Resume run', shortcut: 'r', kind: 'primary' })]
        }
      ],
      artifacts: [
        {
          kind: 'plan',
          label: 'Plan artifact',
          path: '/tmp/plan.md',
          summary: 'Approved plan'
        },
        {
          kind: 'protocol',
          label: 'Protocol artifact',
          path: '/tmp/protocol.log',
          summary: 'Event stream'
        }
      ],
      artifactContent: {
        title: 'Plan content',
        kind: 'plan',
        path: '/tmp/plan.md',
        summary: 'Rendered plan content',
        lines: ['# Plan', '- item one', '- item two']
      },
      diffs: [
        {
          kind: 'compare with previous run',
          fromRunId: 'run-122',
          toRunId: 'run-123',
          summary: 'Only documentation and routing changed',
          action: createTuiAction({ id: 'diff', label: 'Open diff', shortcut: 'd' })
        }
      ],
      logs: [
        {
          id: 'log-1',
          label: 'Protocol log',
          lines: ['queued task', 'entered verify'],
          focused: true,
          selected: true
        }
      ],
      replay: [
        {
          id: 'replay-1',
          label: 'Run replay',
          timestamp: '2026-04-12T10:35:00.000Z',
          detail: 'Worker completed verify and emitted artifacts.'
        }
      ],
      history: [
        {
          runId: 'run-122',
          status: 'succeeded',
          workflow: 'human',
          currentStage: 'verify',
          startedAt: '2026-04-12T10:20:00.000Z',
          finishedAt: '2026-04-12T10:40:00.000Z',
          duration: '20m',
          retryCount: 1,
          selected: true
        }
      ],
      recovery: {
        action: 'resume',
        message: 'Resume is required because the gate has already expired.',
        command: 'lineup bridge answer run-123 request-42 --choice resume'
      },
      recentRuns: [
        { runId: 'run-122', status: 'succeeded', stage: 'verify', updatedAt: '2026-04-12T10:40:00.000Z', summary: 'previous run' }
      ],
      actions: [
        createTuiAction({ id: 'logs', label: 'Open logs', shortcut: 'l' }),
        createTuiAction({ id: 'cancel', label: 'Cancel run', shortcut: 'x', kind: 'destructive' })
      ]
    })

    const node = InspectionView({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Inspect run')
    expect(text).toContain('active pane')
    expect(text).toContain('logs')
    expect(text).toContain('Overview')
    expect(text).toContain('Bridge recovery')
    expect(text).toContain('Plan artifact')
    expect(text).toContain('Plan content')
    expect(text).toContain('Protocol log')
    expect(text).toContain('Run replay')
    expect(text).toContain('run-122')
    expect(text).toContain('Open diff')
    expect(text).toContain('Resume run')
    expect(text).toContain('Recovery summary')
    expect(text).toContain('Resume is required because the gate has already expired.')
    expect(snapshot).toContain('section=Artifacts [active] border=true tone=accent')
    expect(snapshot).toContain('compare with previous run')
    expect(snapshot).toContain('active pane')
  })
})
