import { describe, expect, it } from 'vitest'

import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { InspectionView } from '../../src/tui/views/inspection-view'
import { createTuiAction, createTuiInspectionViewModel } from '../../src/tui/types'

describe('InspectionView', () => {
  it('renders run inspection, artifacts, diffs, and recovery actions', () => {
    const viewModel = createTuiInspectionViewModel({
      title: 'Inspect run',
      runId: 'run-123',
      status: 'blocked',
      summary: 'Blocked on approval and ready to resume',
      sections: [
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
        }
      ],
      diffs: [
        {
          kind: 'compare with previous run',
          fromRunId: 'run-122',
          toRunId: 'run-123',
          summary: 'Only documentation and routing changed',
          action: createTuiAction({ id: 'diff', label: 'Open diff', shortcut: 'd' })
        }
      ],
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
    expect(text).toContain('Bridge recovery')
    expect(text).toContain('Plan artifact')
    expect(text).toContain('Open diff')
    expect(text).toContain('Resume run')
    expect(text).not.toContain('The main agent will populate summary, diff, and artifact sections here')
    expect(snapshot).toContain('compare with previous run')
  })
})
