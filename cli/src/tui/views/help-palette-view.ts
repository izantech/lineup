import { Box, Text } from '../ink-shim'
import { actionLabel, badge, card, emptyState, keyBindingLabel, panel, section, split } from '../layout'
import type { TuiHelpPaletteViewModel } from '../types'
import { stateBadges, stateRow } from './state'

export type HelpPaletteViewProps = {
  viewModel: TuiHelpPaletteViewModel
}

export function HelpPaletteView(props: HelpPaletteViewProps) {
  const { viewModel } = props

  const sectionBody = viewModel.sections.length > 0
    ? viewModel.sections.map((group) =>
        card(
          group.title,
          group.commands.length > 0
            ? group.commands.map((command) =>
                card(
                  command.label,
                  [
                    command.id === viewModel.selectedCommandId ? badge('selected', 'success') : null,
                    stateRow(
                      'command',
                      command,
                      command.shortcut ?? command.category ?? 'available',
                      command.tone ?? 'neutral'
                    ),
                    command.description ? Text({ dim: true, children: [command.description] }) : null,
                    command.slashCommand ? Text({ children: [`/${command.slashCommand}`] }) : null,
                    ...stateBadges(command, 'accent')
                  ].filter((item): item is NonNullable<typeof item> => item !== null)
                )
              )
            : [emptyState('Command group is empty', 'Host, run, artifact, recovery, and help actions will be grouped here.')],
          viewModel.selectedSectionTitle === group.title ? 'current group' : undefined
        )
      )
    : [emptyState('Command groups are empty', 'The palette will populate once actions are wired in.')]

  const commandCards = viewModel.commands.length > 0
    ? viewModel.commands.map((command) =>
        card(
          command.label,
          [
            command.id === viewModel.selectedCommandId ? badge('selected', 'success') : null,
            stateRow(
              'command',
              command,
              command.shortcut ?? command.category ?? 'available',
              command.tone ?? 'neutral'
            ),
            command.description ? Text({ dim: true, children: [command.description] }) : null,
            command.slashCommand ? Text({ children: [`/${command.slashCommand}`] }) : null,
            command.disabled ? badge('disabled', 'warning') : null,
            ...stateBadges(command, 'accent')
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('Commands are empty', 'The controller will populate runnable commands here.')]

  return panel(viewModel.title, [
    card(
      'Search',
      [
        stateRow('query', { focused: viewModel.focusedSection === 'query' }, viewModel.query || viewModel.placeholder || 'Type to filter commands', 'accent'),
        viewModel.focusedSection ? Text({ dim: true, children: [`focus: ${viewModel.focusedSection}`] }) : null
      ]
    ),
    split(
      [section('Command groups', sectionBody)],
      [
        section(
          'Slash commands',
          viewModel.slashCommands.length > 0
          ? viewModel.slashCommands.map((command) =>
                card(
                  command.label,
                  [
                    command.id === viewModel.selectedCommandId ? badge('selected', 'success') : null,
                    stateRow(
                      'slash',
                      command,
                      command.slashCommand ? `/${command.slashCommand}` : command.shortcut ?? 'available',
                      command.tone ?? 'neutral'
                    ),
                    command.description ? Text({ dim: true, children: [command.description] }) : null,
                    command.disabled ? badge('disabled', 'warning') : null,
                    ...stateBadges(command, 'accent')
                  ].filter((item): item is NonNullable<typeof item> => item !== null)
                )
              )
            : [emptyState('Slash commands are empty', 'Type / to filter commands and run actions quickly.')]
        ),
        section(
          'Key bindings',
          viewModel.keyBindings.length > 0
            ? viewModel.keyBindings.map((binding, index) =>
                Box(
                  { direction: 'column', keyBinding: binding.label, selected: viewModel.selectedKeyBindingIndex === index },
                  viewModel.selectedKeyBindingIndex === index ? badge('selected', 'success') : null,
                  keyBindingLabel(binding),
                  ...stateBadges(viewModel.selectedKeyBindingIndex === index ? { selected: true, index, total: viewModel.keyBindings.length } : undefined, 'accent')
                )
              )
            : [emptyState('Key bindings are empty', 'Navigation and modal shortcuts will be shown here.')]
        )
      ]
    ),
    section('Available commands', commandCards),
    section(
      'Recent commands',
      viewModel.recentCommands.length > 0
        ? viewModel.recentCommands.map((command) => actionLabel({
            id: command.id,
            label: command.label,
            description: command.description,
            shortcut: command.shortcut,
            kind: 'ghost',
            tone: command.tone ?? 'neutral',
            disabled: command.disabled,
            focused: command.focused || command.id === viewModel.selectedCommandId,
            selected: command.selected || command.id === viewModel.selectedCommandId,
            index: command.index,
            total: command.total
          }))
        : [emptyState('Recent commands are empty', 'Previously used palette actions will be surfaced here.')]
    )
  ])
}
