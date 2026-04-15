import { describe, expect, it } from 'vitest'

import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { RunComposerView } from '../../src/tui/views/run-composer-view'
import { createTuiAction, createTuiComposerViewModel } from '../../src/tui/types'

describe('RunComposerView', () => {
  it('renders editable fields, validation, and suggested actions', () => {
    const viewModel = createTuiComposerViewModel({
      title: 'Compose run',
      prompt: 'Update the TUI docs and keep the operator surface stable',
      fields: [
        { label: 'Host', value: 'codex', hint: 'Local execution host', editable: true },
        { label: 'Isolation', value: 'index', hint: 'Default workspace isolation', editable: true },
        { label: 'Implement method', value: 'phase', hint: 'How tasks are grouped', editable: true },
        { label: 'Approval', value: 'plan approval disabled', hint: 'Plan gate defaults', editable: true }
      ],
      validation: ['Prompt is required before launch'],
      suggestedActions: [
        createTuiAction({ id: 'start', label: 'Start run', shortcut: 'enter', kind: 'primary' }),
        createTuiAction({ id: 'back', label: 'Back to home', shortcut: 'esc' })
      ],
      help: [
        'Tab moves between fields',
        'Enter starts the run when the prompt is valid'
      ]
    })

    const node = RunComposerView({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Compose run')
    expect(text).toContain('Host')
    expect(text).toContain('Start run')
    expect(text).toContain('Prompt is required before launch')
    expect(text).not.toContain('The main agent will provide prompt')
    expect(snapshot).toContain('<Box')
  })
})
