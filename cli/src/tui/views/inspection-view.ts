import { Box, Text } from '../ink-shim'
import { actionLabel, badge, card, emptyState, kvRow, panel, section, split } from '../layout'
import { formatIsoTimestamp, formatShortHash } from '../format'
import type { TuiInspectionViewModel } from '../types'
import { stateBadges, stateRow } from './state'

export type InspectionViewProps = {
  viewModel: TuiInspectionViewModel
}

function renderTextLines(lines: readonly string[], emptyMessage: string, emptyHint: string) {
  return lines.length > 0
    ? lines.map((line) => Text({ children: [line] }))
    : [emptyState(emptyMessage, emptyHint)]
}

function renderArtifacts(viewModel: TuiInspectionViewModel) {
  return viewModel.artifacts.length > 0
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
    : [emptyState('Artifacts are empty', 'Artifact links and summaries will appear once a run produces them.')]
}

function renderDiffs(viewModel: TuiInspectionViewModel) {
  return viewModel.diffs.length > 0
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
    : [emptyState('Diff output is empty', 'Comparison shortcuts appear when a previous run is available.')]
}

function renderLogs(viewModel: TuiInspectionViewModel) {
  return viewModel.logs && viewModel.logs.length > 0
    ? viewModel.logs.map((log) =>
        card(
          log.label,
          [
            stateRow('log', { focused: log.focused, selected: log.selected }, log.tone ?? 'neutral', log.tone ?? 'neutral'),
            ...renderTextLines(log.lines, 'No log lines available', 'The controller has not supplied log content yet.')
          ]
        )
      )
    : [emptyState('Logs are empty', 'Protocol and debug entries will appear here once the controller supplies them.')]
}

function renderReplay(viewModel: TuiInspectionViewModel) {
  return viewModel.replay && viewModel.replay.length > 0
    ? viewModel.replay.map((entry) =>
        card(
          entry.label,
          [
            stateRow(
              'event',
              {
                focused: entry.focused,
                selected: entry.selected
              },
              entry.timestamp ? formatIsoTimestamp(entry.timestamp) : undefined
            ),
            entry.detail ? Text({ children: [entry.detail] }) : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('Replay is empty', 'Narrative execution events will appear once the run history is attached.')]
}

function renderHistory(viewModel: TuiInspectionViewModel) {
  return viewModel.history && viewModel.history.length > 0
    ? viewModel.history.map((entry) =>
        card(
          entry.runId,
          [
            Box(
              { direction: 'row', run: entry.runId, selected: entry.selected, focused: entry.focused },
              entry.selected ? badge('selected', 'success') : null,
              ...stateBadges(entry, 'accent')
            ),
            kvRow('status', entry.status),
            entry.workflow ? kvRow('workflow', entry.workflow) : null,
            entry.currentStage ? kvRow('stage', entry.currentStage) : null,
            entry.startedAt ? kvRow('started', formatIsoTimestamp(entry.startedAt)) : null,
            entry.finishedAt ? kvRow('finished', formatIsoTimestamp(entry.finishedAt)) : null,
            entry.duration ? kvRow('duration', entry.duration) : null,
            typeof entry.retryCount === 'number' ? kvRow('retries', String(entry.retryCount)) : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('History is empty', 'Recent run metadata will appear here once the orchestrator provides it.')]
}

function renderRecovery(viewModel: TuiInspectionViewModel) {
  return viewModel.recovery
    ? [
        card(
          'Recovery summary',
          [
            stateRow('recovery', { selected: true }, viewModel.recovery.action, viewModel.recovery.action === 'resume' ? 'warning' : 'accent'),
            Text({ children: [viewModel.recovery.message] }),
            viewModel.recovery.command ? Text({ dim: true, children: [viewModel.recovery.command] }) : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      ]
    : []
}

export function InspectionView(props: InspectionViewProps) {
  const { viewModel } = props
  const activePane = viewModel.activePane ?? 'summary'
  const selectedPane = viewModel.focusedSection ?? activePane
  const recoveryBody = renderRecovery(viewModel)
  const summaryTitle = viewModel.focusedSection === 'summary' ? 'Summary [active]' : 'Summary'
  const actionsTitle = viewModel.focusedSection === 'actions' ? 'Actions [active]' : 'Actions'
  const artifactsTitle = viewModel.focusedSection === 'artifacts' ? 'Artifacts [active]' : 'Artifacts'
  const diffsTitle = viewModel.focusedSection === 'diffs' ? 'Diff output [active]' : 'Diff output'

  const summaryBody =
    viewModel.sections.length > 0
      ? viewModel.sections.map((entry) =>
          card(
            entry.title,
            [
              stateRow(
                'section',
                {
                  focused: entry.focused || (selectedPane === 'summary' && entry.title === 'Summary'),
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

  return panel(viewModel.title, [
    kvRow('run', viewModel.runId),
    kvRow('status', viewModel.status),
    kvRow('active pane', activePane),
    viewModel.summary ? Text({ children: [viewModel.summary] }) : null,
    viewModel.focusedSection ? Text({ dim: true, children: [`focus: ${viewModel.focusedSection}`] }) : null,
    Text({ children: ['Tab cycles: Actions -> Recent runs -> Artifacts -> Diffs -> Summary'] }),
    Text({ dim: true, children: ['Use ←/→ to switch pane content. Use ↑/↓ to move inside the active region. Press Enter to activate.'] }),
    split(
      [
        section(summaryTitle, summaryBody, undefined, { active: viewModel.focusedSection === 'summary' }),
        section('Recovery', recoveryBody.length > 0 ? recoveryBody : [emptyState('Recovery is empty', 'No blocked-run recovery summary was provided.')]),
        section(
          actionsTitle,
          viewModel.actions.length > 0
            ? viewModel.actions.map((action) =>
                Box(
                  { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
                  actionLabel(action),
                  action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
                  ...stateBadges(action, 'accent')
                )
              )
            : [emptyState('Actions are empty', 'Resume and cancel controls will appear here.')],
          undefined,
          { active: viewModel.focusedSection === 'actions' }
        )
      ],
      [
        section(artifactsTitle, renderArtifacts(viewModel), undefined, { active: viewModel.focusedSection === 'artifacts' }),
        section(
          'Content',
          viewModel.artifactContent
            ? [
                card(
                  viewModel.artifactContent.title,
                  [
                    kvRow('kind', viewModel.artifactContent.kind),
                    viewModel.artifactContent.path ? kvRow('path', viewModel.artifactContent.path) : null,
                    viewModel.artifactContent.summary ? Text({ children: [viewModel.artifactContent.summary] }) : null,
                    ...renderTextLines(viewModel.artifactContent.lines, 'Artifact content is empty', 'The controller has not supplied file content yet.')
                  ].filter((item): item is NonNullable<typeof item> => item !== null)
                )
              ]
            : [emptyState('Content is empty', 'Select an artifact to inspect its body and rendered content.')]
        ),
        section(diffsTitle, renderDiffs(viewModel), undefined, { active: viewModel.focusedSection === 'diffs' }),
        section('Logs', renderLogs(viewModel)),
        section('Replay', renderReplay(viewModel)),
        section('History', renderHistory(viewModel))
      ]
    )
  ])
}
