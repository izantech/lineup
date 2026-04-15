import { Box, Text } from '../ink-shim'
import { actionLabel, badge, card, emptyState, kvRow, panel, section } from '../layout'
import type { TuiComposerViewModel } from '../types'
import { stateBadges, stateRow } from './state'

export type RunComposerViewProps = {
  viewModel: TuiComposerViewModel
}

function normalizeFieldLabel(label: string): string {
  return label.trim().length > 0 ? label : 'Untitled field'
}

function renderFieldCard(label: string, value: string, hint?: string, editable?: boolean, focused?: boolean, selected?: boolean, tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted' = 'accent') {
  const normalizedLabel = normalizeFieldLabel(label)

  return card(
    normalizedLabel,
    [
      Box(
        { direction: 'row', field: normalizedLabel, editable, focused, selected },
        ...stateBadges({ focused, selected }, tone),
        editable ? badge('editable', 'accent') : badge('read-only', 'muted')
      ),
      Text({ bold: focused || selected, children: [value || '—'] }),
      hint ? Text({ dim: true, children: [hint] }) : null
    ].filter((item): item is NonNullable<typeof item> => item !== null)
  )
}

export function RunComposerView(props: RunComposerViewProps) {
  const { viewModel } = props
  const promptFocused = viewModel.focusedFieldId === undefined || viewModel.focusedFieldId === 'prompt'
  const promptTitle = promptFocused ? 'Prompt [active]' : 'Prompt'
  const configurationTitle = viewModel.focusedFieldId && viewModel.focusedFieldId !== 'prompt' && !viewModel.selectedActionId
    ? 'Configuration [active]'
    : 'Configuration'
  const actionsTitle = viewModel.selectedActionId ? 'Suggested actions [active]' : 'Suggested actions'

  const fieldLines = viewModel.fields.length > 0
    ? viewModel.fields.map((field, index) => {
        const fieldId = field.id ?? field.label
        const isFocused = field.focused || fieldId === viewModel.focusedFieldId || (!viewModel.focusedFieldId && index === 0)

        return renderFieldCard(field.label, field.value, field.hint, field.editable, isFocused, field.selected)
      })
    : [emptyState('Composer is empty', 'Prompt, workflow, tactic, timing, and rerun controls appear once the controller populates them.')]

  const validationBody = viewModel.validation.length > 0
    ? [
        badge(`${viewModel.validation.length} validation issue${viewModel.validation.length === 1 ? '' : 's'}`, 'warning'),
        ...viewModel.validation.map((line, index) =>
          card(
            `Validation ${index + 1}`,
            [
              stateRow('check', { selected: index === 0 }, index === 0 ? 'launch blocker' : 'needs attention', 'warning'),
              Text({ children: [line] })
            ]
          )
        )
      ]
    : [
        badge('validation clean', 'success'),
        Text({ dim: true, children: ['Validation is clean and the composer is ready to launch.'] })
      ]

  const helpBody = viewModel.help.length > 0
    ? viewModel.help.map((line) => Text({ children: [line] }))
    : [
        Text({ dim: true, children: ['Use Tab to move between prompt, configuration, and actions.'] }),
        Text({ dim: true, children: ['Enter starts the run when validation passes.'] }),
        Text({ dim: true, children: ['Esc returns to Home without starting a run.'] })
      ]

  return panel(viewModel.title, [
    viewModel.modeSummary ? Text({ dim: true, children: [viewModel.modeSummary] }) : null,
    viewModel.focusedFieldId ? Text({ dim: true, children: [`focus: ${viewModel.focusedFieldId}`] }) : null,
    Text({ children: ['Tab cycles: Prompt -> Configuration -> Actions'] }),
    Text({ dim: true, children: ['Type directly in Prompt. Use ←/→ to change the focused configuration field. Press Enter to start.'] }),
    section(
      promptTitle,
      [stateRow('prompt', { focused: promptFocused, selected: Boolean(viewModel.selectedActionId) }, viewModel.prompt || 'Type the task you want to run.', 'accent')],
      undefined,
      { active: promptFocused }
    ),
    section('Run summary', [
      kvRow('workflow options', String(viewModel.workflowOptions?.length ?? 0)),
      kvRow('tactic options', String(viewModel.tacticOptions?.length ?? 0)),
      viewModel.workflowOptions?.length ? Text({ dim: true, children: ['Workflow is the execution template for the run.'] }) : null,
      viewModel.tacticOptions?.length ? Text({ dim: true, children: ['Tactic narrows the orchestration strategy for the task.'] }) : null
    ].filter((item): item is NonNullable<typeof item> => item !== null)),
    section(configurationTitle, fieldLines, undefined, { active: configurationTitle.includes('[active]') }),
    section(
      'Workflow options',
      viewModel.workflowOptions && viewModel.workflowOptions.length > 0
        ? viewModel.workflowOptions.map((workflow, index) =>
            renderFieldCard(
              `Workflow ${index + 1}`,
              workflow,
              'Select the run workflow.',
              false,
              viewModel.focusedFieldId === 'workflow' || viewModel.focusedFieldId === `workflowOptions.${index}`,
              false
            )
          )
        : [emptyState('No workflow options', 'The controller will populate workflow choices when it is ready.')]
    ),
    section(
      'Tactic options',
      viewModel.tacticOptions && viewModel.tacticOptions.length > 0
        ? viewModel.tacticOptions.map((tactic, index) =>
            renderFieldCard(
              `Tactic ${index + 1}`,
              tactic,
              'Select the tactic that matches the task.',
              false,
              viewModel.focusedFieldId === 'tactic' || viewModel.focusedFieldId === `tacticOptions.${index}`,
              false
            )
          )
        : [emptyState('No tactic options', 'The controller will populate tactic choices when it is ready.')]
    ),
    section('Validation', validationBody),
    section(
      actionsTitle,
      viewModel.suggestedActions.length > 0
        ? viewModel.suggestedActions.map((action) =>
            Box(
              { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
              actionLabel(action),
              action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
              ...stateBadges(action, 'accent')
            )
          )
        : [emptyState('Suggested actions are not ready', 'Launch and approval actions will appear once the controller exposes them.')],
      undefined,
      { active: Boolean(viewModel.selectedActionId) }
    ),
    section('Help', helpBody)
  ])
}
