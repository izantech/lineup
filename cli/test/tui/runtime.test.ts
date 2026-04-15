import { describe, expect, it } from 'vitest'

import { runTuiApp } from '../../src/tui/runtime'
import { createTuiHelpPaletteViewModel } from '../../src/tui/types'

describe('runTuiApp', () => {
  it('builds a shell session from the provided view model and rerenders route changes', async () => {
    const session = await runTuiApp({
      viewModel: {
        route: { screen: 'help', modal: 'help' },
        help: createTuiHelpPaletteViewModel({
          title: 'Command palette',
          query: 'run',
          placeholder: 'Search commands',
          sections: [
            {
              title: 'Runs',
              commands: [
                {
                  id: 'new-run',
                  label: 'New run',
                  description: 'Open the composer and start a pipeline',
                  shortcut: 'enter',
                  slashCommand: 'run'
                }
              ]
            }
          ],
          commands: [
            {
              id: 'new-run',
              label: 'New run',
              description: 'Open the composer and start a pipeline',
              shortcut: 'enter',
              slashCommand: 'run'
            }
          ],
          keyBindings: [
            { keys: ['/'], label: 'Open palette', description: 'Focus the command search' }
          ],
          slashCommands: [
            { id: 'run', label: 'Run command', description: 'Open the composer', slashCommand: 'run' }
          ],
          recentCommands: [
            { id: 'logs', label: 'Logs', description: 'Show the latest status stream', shortcut: 'l' }
          ]
        })
      }
    })

    expect(session.text).toContain('route: help + help')
    expect(session.snapshot).toContain('Command palette')
    expect(session.text).toContain('New run')

    session.update({
      route: { screen: 'inspect' }
    })

    expect(session.text).toContain('route: inspect')
  })
})
