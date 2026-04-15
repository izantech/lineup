import { Box, Text } from '../ink-shim'
import { actionLabel, badge, card, emptyState, kvRow, panel, section, split } from '../layout'
import { formatIsoTimestamp, formatShortHash } from '../format'
import type { TuiInspectionViewModel } from '../types'
import { stateBadges, stateRow } from './state'

export type InspectionViewProps = {
  viewModel: TuiInspectionViewModel
}

export function InspectionView(props: InspectionViewProps) {
  const { viewModel } = props

  const sectionBody = viewModel.sections.length > 0
    ? viewModel.sections.map((entry) =>
        card(
          entry.title,
          [
            stateRow(
              'section',
              {
                focused: entry.focused || (viewModel.focusedSection === 'summary' && entry.title === 'Summary'),
                selected: entry.selected
              },
              entry.selected ? 'selected' : entry.focused ? 'focused' : undefined,
              entry.tone ?? 'neutral'
            ),
            ...entry.body.map((line) => Text({ children: [line] })),
            ...((entry.actions ?? []).map((action) =>
              Box(
                { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
                actionLabel(action),
                action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
                ...stateBadges(action, 'accent')
              )
            ))
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('Inspection details are empty', 'Summary, diff, and artifact sections will appear once the controller provides them.')]

  const artifactBody = viewModel.artifacts.length > 0
    ? viewModel.artifacts.map((artifact) =>
        card(
          artifact.label,
          [
            Box(
              { direction: 'row', artifact: artifact.kind, selected: artifact.kind === viewModel.selectedArtifactKind },
              artifact.kind === viewModel.selectedArtifactKind ? badge('selected', 'success') : null,
              ...stateBadges(artifact, 'accent')
            ),
            kvRow('kind', artifact.kind),
            artifact.path ? kvRow('path', artifact.path) : null,
            artifact.hash ? kvRow('hash', formatShortHash(artifact.hash)) : null,
            artifact.summary ? Text({ children: [artifact.summary] }) : null,
            artifact.status ? Text({ dim: true, children: [`status: ${artifact.status}`] }) : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('Artifacts are empty', 'Artifact links and summaries will appear once a run produces them.')];

  const diffBody = viewModel.diffs.length > 0
    ? viewModel.diffs.map((diff) =>
        card(
          diff.kind,
          [
            stateRow(
              'diff',
              {
                focused: diff.focused || viewModel.selectedDiffKind === diff.kind,
                selected: diff.selected || viewModel.selectedDiffKind === diff.kind
              },
              diff.selected ? 'selected' : diff.focused ? 'focused' : undefined,
              diff.status ?? 'neutral'
            ),
            Text({ children: [diff.summary] }),
            diff.fromRunId || diff.toRunId
              ? Text({ dim: true, children: [`${diff.fromRunId ?? 'current'} -> ${diff.toRunId ?? 'current'}`] })
              : null,
            diff.action ? actionLabel(diff.action) : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('Diffs are empty', 'Comparison shortcuts appear when a previous run is available.')];

  return panel(viewModel.title, [
    kvRow('run', viewModel.runId),
    kvRow('status', viewModel.status),
    viewModel.summary ? Text({ children: [viewModel.summary] }) : null,
    viewModel.focusedSection ? Text({ dim: true, children: [`focus: ${viewModel.focusedSection}`] }) : null,
    split(
      [section('Summary', sectionBody)],
      [
        section('Actions', viewModel.actions.length > 0
          ? viewModel.actions.map((action) =>
              Box(
                { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
                actionLabel(action),
                action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
                ...stateBadges(action, 'accent')
              )
            )
          : [emptyState('Actions are empty', 'Resume and cancel controls will appear here.')]),
        section('Recent runs', viewModel.recentRuns.length > 0
          ? viewModel.recentRuns.map((run) =>
              card(
                run.runId,
                [
                  Box(
                    { direction: 'row', run: run.runId, selected: run.selected || run.runId === viewModel.selectedRunId, focused: run.focused || run.runId === viewModel.selectedRunId },
                    run.selected || run.runId === viewModel.selectedRunId ? badge('selected', 'success') : null,
                    ...stateBadges(run, 'accent')
                  ),
                  kvRow('status', run.status),
                  run.stage ? kvRow('stage', run.stage) : null,
                  run.updatedAt ? kvRow('updated', formatIsoTimestamp(run.updatedAt)) : null
                ].filter((item): item is NonNullable<typeof item> => item !== null)
              )
            )
          : [emptyState('Recent runs are empty', 'The inspection screen can show neighboring runs for comparison.')])
      ]
    ),
    section('Artifacts', artifactBody),
    section('Diffs', diffBody)
  ])
}
