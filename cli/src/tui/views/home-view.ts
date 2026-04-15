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

export function HomeView(props: HomeViewProps): ReturnType<typeof Box> {
  const { viewModel } = props
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
    section('Readiness', readinessBody),
    section('Latest run', latestRunBody),
    section(
      'Recent runs',
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
        : [emptyState('Recent runs are empty', 'Completed and in-flight runs will appear here as they are created.')]
    ),
    section(
      'Quick actions',
      viewModel.quickActions.length > 0
        ? viewModel.quickActions.map((action) =>
            Box(
              { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
              actionLabel(action),
              action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
              ...stateBadges(action, 'accent')
            )
          )
        : [emptyState('Quick actions are waiting', 'Run, resume, inspect, and setup commands will appear here once they are available.')]
    ),
    viewModel.notes.length > 0
      ? section('Notes', viewModel.notes.map((note) => Text({ children: [note] })))
      : null,
    viewModel.latestRun
      ? Text({ dim: true, children: [`Latest run reference: ${viewModel.latestRun.runId}`] })
      : null
  ].filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined))
}
