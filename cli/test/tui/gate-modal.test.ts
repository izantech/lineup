import { describe, expect, it } from 'vitest'

import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { GateModal } from '../../src/tui/views/gate-modal'
import { createTuiGateViewModel } from '../../src/tui/types'

describe('GateModal', () => {
  it('renders gate choices, default selection, and artifact preview', () => {
    const viewModel = createTuiGateViewModel({
      requestId: 'gate-1',
      gateType: 'approval',
      question: 'Approve the plan?',
      context: 'The plan is ready to move into implementation.',
      statusLine: 'Waiting for an approval response',
      choices: [
        { value: 'approve', label: 'Approve', description: 'Continue with the current plan', tone: 'success', isDefault: true },
        { value: 'revise', label: 'Request revision', description: 'Return to planning', tone: 'warning' },
        { value: 'abort', label: 'Abort run', description: 'Stop this run', tone: 'danger' }
      ],
      allowFreeText: true,
      freeTextLabel: 'Reason for the response',
      artifactPreview: {
        kind: 'plan',
        label: 'Plan artifact',
        path: '/tmp/plan.md',
        summary: 'Implementation plan preview'
      },
      help: [
        'Use number keys to choose quickly',
        'Enter confirms the default choice'
      ]
    })

    const node = GateModal({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Approve the plan?')
    expect(text).toContain('Approve')
    expect(text).toContain('Reason for the response')
    expect(text).toContain('Plan artifact')
    expect(text).not.toContain('The main agent will attach the actionable approval choices here')
    expect(snapshot).toContain('gate-1')
  })
})
