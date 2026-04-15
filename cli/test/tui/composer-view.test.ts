import { describe, expect, it } from 'vitest'

import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { RunComposerView } from '../../src/tui/views/run-composer-view'
import { createTuiAction, createTuiComposerViewModel } from '../../src/tui/types'

describe('RunComposerView', () => {
  it('renders the expanded composer contract with guidance and validation', () => {
    const viewModel = createTuiComposerViewModel({
      title: 'Compose run',
      prompt: 'Update the TUI docs and keep the operator surface stable',
      focusedFieldId: 'workflow',
      workflowOptions: ['human', 'bridge', 'batch'],
      tacticOptions: ['guided', 'research', 'repair'],
      fields: [
        { id: 'workflow', label: 'Workflow', value: 'human', hint: 'Choose the run workflow', editable: true },
        { id: 'tactic', label: 'Tactic', value: 'guided', hint: 'Choose the orchestration tactic', editable: true },
        { id: 'timeout', label: 'Timeout', value: '45m', hint: 'Total run timeout', editable: true },
        { id: 'gateTimeout', label: 'Gate timeout', value: '10m', hint: 'Gate response window', editable: true },
        { id: 'fromStage', label: 'From stage', value: 'plan', hint: 'Resume from a later stage', editable: true },
        { id: 'dryRun', label: 'Dry run', value: 'enabled', hint: 'Validate without executing workers', editable: true },
        { id: 'forceRerun', label: 'Force rerun', value: 'disabled', hint: 'Ignore cached results and rerun', editable: true }
      ],
      validation: ['Workflow selection is required before launch', 'Gate timeout must be shorter than the run timeout'],
      suggestedActions: [
        createTuiAction({ id: 'start', label: 'Start run', shortcut: 'enter', kind: 'primary' }),
        createTuiAction({ id: 'back', label: 'Back to home', shortcut: 'esc' })
      ],
      help: [
        'Tab moves between prompt, configuration, options, and actions',
        'Enter starts the run when validation passes',
        'Workflow selects the execution template; tactic narrows the orchestration strategy',
        'Use from stage, dry run, and force rerun for controlled restarts'
      ]
    })

    const node = RunComposerView({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Compose run')
    expect(text).toContain('Run summary')
    expect(text).toContain('Workflow')
    expect(text).toContain('Tactic')
    expect(text).toContain('Timeout')
    expect(text).toContain('Gate timeout')
    expect(text).toContain('From stage')
    expect(text).toContain('Dry run')
    expect(text).toContain('Force rerun')
    expect(text).toContain('Workflow options')
    expect(text).toContain('Tactic options')
    expect(text).toContain('Start run')
    expect(text).toContain('Workflow selection is required before launch')
    expect(text).toContain('Gate timeout must be shorter than the run timeout')
    expect(text).toContain('Workflow selects the execution template; tactic narrows the orchestration strategy')
    expect(text).toContain('Use from stage, dry run, and force rerun for controlled restarts')
    expect(snapshot).toContain('<Box')
    expect(snapshot).toContain('section=Configuration [active] border=true tone=accent')
  })
})
