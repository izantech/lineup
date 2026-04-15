import { describe, expect, it } from 'vitest'

import { collectTuiText, serializeTuiNode } from '../../src/tui/snapshot'
import { HelpPaletteView } from '../../src/tui/views/help-palette-view'
import { createTuiHelpPaletteViewModel } from '../../src/tui/types'

describe('HelpPaletteView', () => {
  it('renders grouped palette actions, shortcuts, and recent commands', () => {
    const viewModel = createTuiHelpPaletteViewModel({
      title: 'Command palette',
      query: 'run',
      placeholder: 'Search commands',
      sections: [
        {
          title: 'Runs',
          commands: [
            { id: 'new-run', label: 'New run', description: 'Open the composer', shortcut: 'enter', category: 'Runs', slashCommand: 'run', tone: 'accent' },
            { id: 'resume', label: 'Resume selected run', description: 'Resume the selected run', shortcut: 'r', category: 'Runs' }
          ]
        }
      ],
      commands: [
        { id: 'new-run', label: 'New run', description: 'Open the composer', shortcut: 'enter', category: 'Runs', slashCommand: 'run', tone: 'accent' }
      ],
      keyBindings: [
        { keys: ['/'], label: 'Open palette', description: 'Focus the command search' },
        { keys: ['tab'], label: 'Move focus', description: 'Cycle through the active region' }
      ],
      slashCommands: [
        { id: 'run', label: 'Run command', description: 'Open the composer', slashCommand: 'run' }
      ],
      recentCommands: [
        { id: 'logs', label: 'Logs', description: 'Show the latest status stream', shortcut: 'l', category: 'Runs' }
      ]
    })

    const node = HelpPaletteView({ viewModel })
    const text = collectTuiText(node)
    const snapshot = serializeTuiNode(node)

    expect(text).toContain('Command palette')
    expect(text).toContain('Runs')
    expect(text).toContain('New run')
    expect(text).toContain('Open palette')
    expect(text).toContain('Logs')
    expect(text).not.toContain('The main agent can group host, run, artifact, and help actions here')
    expect(snapshot).toContain('/run')
  })
})
