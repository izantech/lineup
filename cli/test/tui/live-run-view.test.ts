import { describe, expect, it } from 'vitest'

import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { LiveRunView } from '../../src/tui/views/live-run-view'
import { createTuiAction, createTuiLiveRunViewModel } from '../../src/tui/types'

describe('LiveRunView', () => {
  it('renders a full live-run status surface', () => {
    const viewModel = createTuiLiveRunViewModel({
      title: 'Live run',
      runId: 'run-123',
      host: 'codex',
      workflow: 'full-pipeline',
      tactic: 'docs-refresh',
      status: 'running',
      currentStage: 'plan',
      modeSummary: 'Human mode attached to the local terminal',
      approvalMode: 'plan approval required',
      stageTimeline: [
        { id: 'triage', label: 'Triage', status: 'done', detail: 'Scope confirmed', completedAt: '2026-04-12T11:00:00.000Z' },
        { id: 'plan', label: 'Plan', status: 'running', detail: 'Waiting on approval', startedAt: '2026-04-12T11:05:00.000Z' }
      ],
      statusStream: [
        { id: 'status-1', level: 'status', text: 'Planning stage started', timestamp: '2026-04-12T11:05:00.000Z' },
        { id: 'status-2', level: 'warning', text: 'Clarification gate pending', timestamp: '2026-04-12T11:06:00.000Z' }
      ],
      taskWaves: [
        {
          id: 'wave-1',
          label: 'Implementation wave 1',
          detail: 'Docs and routing updates',
          tasks: [
            { id: 'task-1', title: 'Update README', status: 'done' },
            { id: 'task-2', title: 'Align TUI docs', status: 'running' }
          ]
        }
      ],
      verification: {
        label: 'Verification',
        status: 'pending',
        detail: 'Tests will run after approval',
        actions: [createTuiAction({ id: 'logs', label: 'Open logs', shortcut: 'l' })]
      },
      artifacts: [
        { kind: 'plan', label: 'Plan artifact', path: '/tmp/plan.md', summary: 'Execution plan', status: 'present' }
      ],
      nextActions: [
        createTuiAction({ id: 'resume', label: 'Resume selected run', shortcut: 'r', kind: 'primary' }),
        createTuiAction({ id: 'cancel', label: 'Cancel run', shortcut: 'x', kind: 'destructive' })
      ],
      changedItems: [
        'docs/tui.md updated',
        'AGENTS.md aligned with the two-frontend model'
      ],
      lastUpdatedAt: '2026-04-12T11:06:30.000Z'
    })

    const node = LiveRunView({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Live run')
    expect(text).toContain('Stage timeline')
    expect(text).toContain('Verification')
    expect(text).toContain('Implementation wave 1')
    expect(text).toContain('What changed')
    expect(text).toContain('Resume selected run')
    expect(text).not.toContain('The main agent will inject resume, retry, or cancel actions here')
    expect(snapshot).toContain('Plan artifact')
  })
})
