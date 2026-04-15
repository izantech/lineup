import { describe, expect, it } from 'vitest'

import { runTuiApp } from '../../src/tui/runtime'
import { createTuiLiveRunViewModel } from '../../src/tui/types'

describe('runTuiApp', () => {
  it('renders a stacked main pane and input panel from a provided view model', async () => {
    const session = await runTuiApp({
      viewModel: {
        route: { screen: 'home' },
        chrome: {
          title: 'Lineup',
          subtitle: 'Repository overview',
          modeSummary: 'interactive · codex · ready',
          inputLabel: 'Task prompt',
          inputValue: 'Update the TUI to use a stacked input panel',
          inputHint: 'Type the task you want Lineup to run. Enter starts the pipeline.',
          inputPlaceholder: 'Describe the task you want Lineup to make progress on',
          hints: ['/ palette', 'q quit']
        },
        home: {
          title: 'Home',
          subtitle: 'Repository overview',
          repoPath: '/tmp/repo',
          focusedSection: 'quickActions',
          readiness: [],
          latestRun: null,
          recentRuns: [],
          quickActions: [],
          notes: []
        }
      }
    })

    expect(session.snapshot).toContain('Workspace')
    expect(session.snapshot).toContain('Input')
    expect(session.text).toContain('Task prompt')
    expect(session.text).toContain('Update the TUI to use a stacked input panel')
    expect(session.text).toContain('Type the task you want Lineup to run. Enter starts the pipeline.')
  })

  it('keeps the input panel context available when a gate is pending', async () => {
    const session = await runTuiApp({
      viewModel: {
        route: { screen: 'live', modal: 'gate' },
        chrome: {
          title: 'Lineup',
          subtitle: 'Gate response required',
          modeSummary: 'interactive · codex · ready',
          inputLabel: 'Gate response',
          inputValue: 'approve',
          inputHint: 'Type a response for the pending gate. Enter submits it.',
          inputPlaceholder: 'Respond to the pending gate',
          hints: ['q quit']
        },
        liveRun: createTuiLiveRunViewModel({
          runId: 'run-123',
          status: 'blocked'
        }),
        gate: {
          title: 'Gate',
          requestId: 'gate-1',
          gateType: 'approval',
          question: 'Approve the plan?',
          statusLine: 'Waiting for a response',
          allowFreeText: true,
          freeTextLabel: 'Reason',
          artifactPreview: null,
          choices: [],
          help: []
        }
      }
    })

    expect(session.snapshot).toContain('Gate')
    expect(session.snapshot).toContain('Input')
    expect(session.text).toContain('Gate response')
    expect(session.text).toContain('approve')
    expect(session.text).toContain('Type a response for the pending gate. Enter submits it.')
  })

  it('keeps a bottom dock visible while the pipeline is executing without a question', async () => {
    const session = await runTuiApp({
      viewModel: {
        route: { screen: 'live' },
        chrome: {
          title: 'Lineup',
          subtitle: 'Pipeline running',
          modeSummary: 'interactive · codex · busy',
          hints: []
        },
        liveRun: createTuiLiveRunViewModel({
          runId: 'run-456',
          status: 'running'
        }),
        input: {
          title: 'Input',
          label: 'Task prompt',
          value: '',
          placeholder: 'Describe the task you want Lineup to make progress on',
          hint: 'Type the task you want Lineup to run. Enter starts the pipeline.',
          visible: false
        }
      }
    })

    expect(session.snapshot).toContain('Live run')
    expect(session.snapshot).toContain('Input')
    expect(session.text).toContain('Input unavailable')
    expect(session.text).toContain('Lineup is executing the pipeline.')
  })
})
