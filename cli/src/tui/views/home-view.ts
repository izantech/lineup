import { Box, Text } from '../ink-shim'
import { actionLabel, badge, bulletList, card, emptyState, kvRow, panel, section } from '../layout'
import { formatIsoTimestamp } from '../format'
import type { TuiHomeViewModel } from '../types'
import { stateBadges, stateRow } from './state'

export type HomeViewProps = {
  viewModel: TuiHomeViewModel
}

function renderRunLine(
  runId: string,
  status: string,
  stage?: string,
  updatedAt?: string,
  summary?: string,
  selected?: boolean,
  focused?: boolean
): ReturnType<typeof Box> {
  const label = `${runId} · ${status}${stage ? ` · ${stage}` : ''}${summary ? ` · ${summary}` : ''}`

  return Box(
    { direction: 'column', runId, selected, focused },
    Text({ bold: selected || focused, children: [label] }),
    ...stateBadges({ selected, focused }, 'accent'),
    updatedAt ? Text({ dim: true, children: [`updated ${formatIsoTimestamp(updatedAt)}`] }) : null
  )
}

function renderOptionalKvRows(rows: readonly (ReturnType<typeof kvRow> | ReturnType<typeof Text> | null)[]) {
  return rows.filter((item): item is NonNullable<typeof item> => item !== null)
}

export function HomeView(props: HomeViewProps): ReturnType<typeof Box> {
  const { viewModel } = props
  const recentRunsTitle = viewModel.focusedSection === 'recentRuns' ? 'Recent runs [active]' : 'Recent runs'
  const quickActionsTitle = viewModel.focusedSection === 'quickActions' ? 'Quick actions [active]' : 'Quick actions'
  const latestRun = viewModel.latestRun as TuiHomeViewModel['latestRun'] & {
    recoveryAction?: string
    recoveryCommand?: string
    expiresAt?: string
    artifactLabel?: string
    artifactSummary?: string
    relatedArtifactLabel?: string
    relatedArtifactSummary?: string
  }
  const selectedReadiness = viewModel.readiness.find((item) => item.id === viewModel.selectedReadinessId)
  const readinessBody = viewModel.readiness.length > 0
    ? viewModel.readiness.map((item, index) =>
        card(
          item.label,
          [
            item.id === viewModel.selectedReadinessId || (viewModel.focusedSection === 'readiness' && index === 0)
              ? badge('selected', 'success')
              : null,
            Box(
              { direction: 'row', readiness: item.id, tone: item.status },
              badge(item.status.toUpperCase(), item.status === 'ready' ? 'success' : item.status === 'warning' ? 'warning' : 'danger'),
              ...stateBadges(item, 'accent')
            ),
            item.detail ? Text({ dim: true, children: [item.detail] }) : null,
            item.action ? actionLabel(item.action) : null
          ].filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        )
      )
    : [emptyState('Readiness is empty', 'Repo, host, and runtime checks will appear here when the controller provides them.')]

  const latestRunBody = viewModel.latestRun
    ? [
        stateRow('selection', viewModel.latestRun, viewModel.latestRun.runId === viewModel.selectedRunId ? 'current run' : undefined, 'accent'),
        kvRow('run', viewModel.latestRun.runId),
        kvRow('status', viewModel.latestRun.status),
        viewModel.latestRun.workflow ? kvRow('workflow', viewModel.latestRun.workflow) : null,
        viewModel.latestRun.stage ? kvRow('stage', viewModel.latestRun.stage) : null,
        viewModel.latestRun.updatedAt ? kvRow('updated', formatIsoTimestamp(viewModel.latestRun.updatedAt)) : null,
        viewModel.latestRun.summary ? Text({ children: [viewModel.latestRun.summary] }) : null,
        viewModel.latestRun.recoveryHint ? Text({ dim: true, children: [viewModel.latestRun.recoveryHint] }) : null,
        selectedReadiness
          ? card(
              'Selected readiness',
              [
                stateRow(
                  selectedReadiness.label,
                  selectedReadiness,
                  selectedReadiness.detail,
                  selectedReadiness.status === 'ready' ? 'success' : selectedReadiness.status === 'warning' ? 'warning' : 'danger'
                ),
                selectedReadiness.action ? actionLabel(selectedReadiness.action) : null
              ].filter((item): item is NonNullable<typeof item> => item !== null)
            )
          : null,
        latestRun
          ? section(
              'Recovery and artifact context',
              renderOptionalKvRows([
                latestRun.recoveryAction ? kvRow('recovery', latestRun.recoveryAction) : null,
                latestRun.recoveryCommand ? kvRow('command', latestRun.recoveryCommand) : null,
                latestRun.expiresAt ? kvRow('expires', formatIsoTimestamp(latestRun.expiresAt)) : null,
                latestRun.artifactLabel ? kvRow('artifact', latestRun.artifactLabel) : null,
                latestRun.artifactSummary ? Text({ children: [latestRun.artifactSummary] }) : null,
                latestRun.relatedArtifactLabel ? kvRow('related artifact', latestRun.relatedArtifactLabel) : null,
                latestRun.relatedArtifactSummary ? Text({ dim: true, children: [latestRun.relatedArtifactSummary] }) : null
              ])
            )
          : null,
        viewModel.latestRun.actions && viewModel.latestRun.actions.length > 0
          ? section(
              'Actions',
              viewModel.latestRun.actions.map((action) =>
                Box(
                  { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
                  actionLabel(action),
                  action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
                  ...stateBadges(action, 'accent')
                )
              )
            )
          : null
      ]
    : [emptyState('No run selected', 'Start a run or pick one from recent history to inspect its state and recovery actions.')]

  return panel(viewModel.title, [
    viewModel.subtitle ? Text({ dim: true, children: [viewModel.subtitle] }) : null,
    viewModel.repoPath ? kvRow('repo', viewModel.repoPath) : null,
    viewModel.focusedSection ? Text({ dim: true, children: [`focus: ${viewModel.focusedSection}`] }) : null,
    Text({ children: ['Tab cycles: Quick actions -> Recent runs'] }),
    Text({ dim: true, children: ['Use ↑/↓ to move within the active section. Press Enter to open the focused action or run.'] }),
    section('Readiness', readinessBody),
    section('Latest run', latestRunBody),
    section(
      recentRunsTitle,
      viewModel.recentRuns.length > 0
        ? viewModel.recentRuns.map((run) =>
            card(
              run.runId,
              [
                renderRunLine(
                  run.runId,
                  run.status,
                  run.stage,
                  run.updatedAt,
                  run.summary,
                  run.runId === viewModel.selectedRunId,
                  viewModel.focusedSection === 'recentRuns' && run.runId === viewModel.selectedRunId
                ),
                ...stateBadges(run, 'accent'),
                run.recoveryHint ? Text({ dim: true, children: [run.recoveryHint] }) : null,
                run.actions && run.actions.length > 0
                  ? bulletList(run.actions.map((action) => action.label), 'Available actions')
                  : null
              ].filter((entry): entry is NonNullable<typeof entry> => entry !== null)
            )
          )
        : [emptyState('Recent runs are empty', 'Completed and in-flight runs will appear here as they are created.')],
      undefined,
      { active: viewModel.focusedSection === 'recentRuns' }
    ),
    section(
      quickActionsTitle,
      viewModel.quickActions.length > 0
        ? viewModel.quickActions.map((action) =>
            Box(
              { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
              actionLabel(action),
              action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
              ...stateBadges(action, 'accent')
            )
          )
        : [emptyState('Quick actions are waiting', 'Run, resume, inspect, and setup commands will appear here once they are available.')],
      undefined,
      { active: viewModel.focusedSection === 'quickActions' }
    ),
    viewModel.notes.length > 0
      ? section('Notes', viewModel.notes.map((note) => Text({ children: [note] })))
      : null,
    viewModel.latestRun
      ? Text({
          dim: true,
          children: [
            `Latest run reference: ${viewModel.latestRun.runId}${
              viewModel.latestRun.workflow ? ` · workflow ${viewModel.latestRun.workflow}` : ''
            }${viewModel.latestRun.stage ? ` · stage ${viewModel.latestRun.stage}` : ''}`
          ]
        })
      : null
  ].filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined))
}
