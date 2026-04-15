import { Box, Text } from '../ink-shim'
import { badge, bulletList, card, emptyState, kvRow, modal, split } from '../layout'
import { formatIsoTimestamp, formatShortHash } from '../format'
import type { TuiGateViewModel } from '../types'
import { stateBadges, stateRow } from './state'

export type GateModalProps = {
  viewModel: TuiGateViewModel
}

export function GateModal(props: GateModalProps) {
  const { viewModel } = props
  const artifactPreview = viewModel.artifactPreview as TuiGateViewModel['artifactPreview'] & {
    relatedArtifactLabel?: string
    relatedArtifactSummary?: string
    contentLabel?: string
    contentSummary?: string
  }
  const recoveryBadge =
    viewModel.recoveryAction ? badge(`recovery: ${viewModel.recoveryAction}`, viewModel.recoveryAction === 'resume' ? 'warning' : 'accent') : null
  const recoveryDetails = [
    viewModel.statusLine ? Text({ dim: true, children: [viewModel.statusLine] }) : null,
    viewModel.expiresAt ? kvRow('expires', formatIsoTimestamp(viewModel.expiresAt)) : null,
    viewModel.recoveryCommand ? kvRow('recovery command', viewModel.recoveryCommand) : null
  ].filter((item): item is NonNullable<typeof item> => item !== null)

  const choices = viewModel.choices.length > 0
    ? viewModel.choices.map((choice, index) =>
        card(
          choice.label,
          [
            choice.selected || choice.value === viewModel.selectedChoiceValue ? badge('selected', 'success') : null,
            typeof viewModel.focusedChoiceIndex === 'number' && viewModel.focusedChoiceIndex === index ? badge('focused', 'warning') : null,
            stateRow(
              'choice',
              choice,
              choice.value,
              choice.tone ?? (choice.isDefault ? 'accent' : 'neutral')
            ),
            choice.description ? Text({ dim: true, children: [choice.description] }) : null,
            choice.isDefault ? badge('default', 'accent') : null,
            choice.focused ? badge('focused', 'warning') : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('Gate choices are pending', 'Approval, clarification, and verification choices will appear here when the controller provides them.')]

  const preview = viewModel.artifactPreview
    ? card(
        artifactPreview.label,
        [
          Box({ direction: 'row', artifact: artifactPreview.kind }, ...stateBadges(artifactPreview, 'accent')),
          kvRow('kind', artifactPreview.kind),
          artifactPreview.path ? kvRow('path', artifactPreview.path) : null,
          artifactPreview.hash ? kvRow('hash', formatShortHash(artifactPreview.hash)) : null,
          artifactPreview.summary ? Text({ children: [artifactPreview.summary] }) : null,
          artifactPreview.relatedArtifactLabel ? kvRow('related', artifactPreview.relatedArtifactLabel) : null,
          artifactPreview.relatedArtifactSummary ? Text({ dim: true, children: [artifactPreview.relatedArtifactSummary] }) : null,
          artifactPreview.contentLabel ? kvRow('content', artifactPreview.contentLabel) : null,
          artifactPreview.contentSummary ? Text({ children: [artifactPreview.contentSummary] }) : null
        ].filter((item): item is NonNullable<typeof item> => item !== null)
      )
    : emptyState('Artifact preview is unavailable', 'The gate modal can show the related plan, review, or verification artifact.')

  return modal(viewModel.title, [
    kvRow('request', String(viewModel.requestId)),
    kvRow('gate', viewModel.gateType),
    recoveryBadge,
    Text({ bold: true, children: [viewModel.question] }),
    viewModel.context ? Text({ children: [viewModel.context] }) : null,
    ...recoveryDetails,
    split([preview], [bulletList(viewModel.help, 'Help'), ...choices]),
    viewModel.allowFreeText ? Text({ dim: true, children: [viewModel.freeTextLabel ?? 'Type a response and press Enter to submit it.'] }) : null,
    typeof viewModel.focusedChoiceIndex === 'number'
      ? Text({ dim: true, children: [`focused choice: ${viewModel.focusedChoiceIndex + 1}`] })
      : null,
    viewModel.selectedChoiceValue ? Text({ dim: true, children: [`selected: ${viewModel.selectedChoiceValue}`] }) : null,
    viewModel.freeTextValue ? Text({ dim: true, children: [`draft: ${viewModel.freeTextValue}`] }) : null
  ].filter((item): item is NonNullable<typeof item> => item !== null))
}
