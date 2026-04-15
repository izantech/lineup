import { Box, Text } from '../ink-shim'
import { actionLabel, badge, card, emptyState, panel, section } from '../layout'
import type { TuiComposerViewModel } from '../types'
import { stateBadges, stateRow } from './state'

export type RunComposerViewProps = {
  viewModel: TuiComposerViewModel
}

export function RunComposerView(props: RunComposerViewProps) {
  const { viewModel } = props
  const promptFocused = viewModel.focusedFieldId === undefined || viewModel.focusedFieldId === 'prompt'

  const fieldLines = viewModel.fields.length > 0
    ? viewModel.fields.map((field, index) => {
        const fieldId = field.id ?? field.label
        const isFocused = field.focused || fieldId === viewModel.focusedFieldId || (!viewModel.focusedFieldId && index === 0)

        return card(
          field.label,
          [
            Box(
              { direction: 'row', field: fieldId, editable: field.editable, focused: isFocused },
              ...stateBadges({ ...field, focused: isFocused }, 'accent'),
              field.editable ? badge('editable', 'accent') : badge('read-only', 'muted')
            ),
            Text({ bold: isFocused, children: [field.value || ''] }),
            field.hint ? Text({ dim: true, children: [field.hint] }) : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      })
    : [emptyState('Composer is empty', 'Prompt, host, workflow, and approval controls will appear once the controller populates them.')]

  const validationBody = viewModel.validation.length > 0
    ? viewModel.validation.map((line) => Text({ children: [line] }))
    : [Text({ dim: true, children: ['Validation is clean'] })]

  const helpBody = viewModel.help.length > 0
    ? viewModel.help.map((line) => Text({ children: [line] }))
    : [Text({ dim: true, children: ['Use Tab to move, Enter to confirm, Esc to back out, and / for the command palette.'] })]

  return panel(viewModel.title, [
    viewModel.modeSummary ? Text({ dim: true, children: [viewModel.modeSummary] }) : null,
    viewModel.focusedFieldId ? Text({ dim: true, children: [`focus: ${viewModel.focusedFieldId}`] }) : null,
    stateRow('prompt', { focused: promptFocused, selected: Boolean(viewModel.selectedActionId) }, viewModel.prompt || 'Type the task you want to run.', 'accent'),
    section('Configuration', fieldLines),
    section('Validation', validationBody),
    section(
      'Suggested actions',
      viewModel.suggestedActions.length > 0
        ? viewModel.suggestedActions.map((action) =>
            Box(
              { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
              actionLabel(action),
              action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
              ...stateBadges(action, 'accent')
            )
          )
        : [emptyState('Suggested actions are not ready', 'Launch and approval actions will appear once the controller exposes them.')]
    ),
    section('Help', helpBody)
  ])
}
