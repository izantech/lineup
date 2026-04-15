import { Box, Text } from './ink-shim'
import { badge, bulletList, emptyState, kvRow, panel, section, titleText } from './layout'
import { GateModal } from './views/gate-modal'
import { InspectionView } from './views/inspection-view'
import { LiveRunView } from './views/live-run-view'
import type { TuiAppViewModel, TuiCallbacks } from './types'

export type TuiAppShellProps = {
  viewModel: TuiAppViewModel
  callbacks?: TuiCallbacks
}

function hasConcreteRunSelection(viewModel: TuiAppViewModel): boolean {
  const runId = viewModel.chrome.runId ?? viewModel.liveRun?.runId
  return typeof runId === 'string' && runId.trim().length > 0 && runId !== 'pending' && runId !== 'unknown'
}

function routeTitle(viewModel: TuiAppViewModel): string {
  const modal = viewModel.route.modal ? ` + ${viewModel.route.modal}` : ''
  return `${viewModel.route.screen}${modal}`
}

function renderWorkspaceOverview(viewModel: TuiAppViewModel): ReturnType<typeof Box> {
  const quickCommands = viewModel.home.quickActions.map((action) => `${action.label}${action.description ? ` - ${action.description}` : ''}`)
  const latestRun = viewModel.home.latestRun
  const subtitle = viewModel.chrome.subtitle ?? viewModel.home.subtitle

  return panel('Workspace', [
    titleText('Lineup', 'Type a task in the input panel below and press Enter to start a run.'),
    viewModel.home.repoPath ? kvRow('folder', viewModel.home.repoPath) : null,
    subtitle ? Text({ children: [subtitle] }) : null,
    viewModel.chrome.status ? kvRow('status', String(viewModel.chrome.status)) : null,
    section(
      'Quick commands',
      quickCommands.length > 0
        ? [bulletList(quickCommands, 'Available')]
        : [emptyState('No quick commands available', 'Initialize the repo or create a run to unlock more actions.')]
    ),
    latestRun
      ? section('Latest run', [
          kvRow('run', latestRun.runId),
          kvRow('status', latestRun.status),
          latestRun.workflow ? kvRow('workflow', latestRun.workflow) : null,
          latestRun.stage ? kvRow('stage', latestRun.stage) : null,
          latestRun.summary ? Text({ children: [latestRun.summary] }) : null
        ].filter((item): item is NonNullable<typeof item> => item !== null))
      : section('Latest run', [emptyState('No run selected', 'The pipeline view will appear here after you submit a task.')]),
    viewModel.home.notes.length > 0 ? section('Notes', viewModel.home.notes.map((line) => Text({ children: [line] }))) : null,
    Text({ dim: true, children: [`route: ${routeTitle(viewModel)}`] })
  ].filter((item): item is NonNullable<typeof item> => item !== null))
}

function renderScreen(viewModel: TuiAppViewModel): ReturnType<typeof Box> {
  if (viewModel.route.modal === 'gate') {
    return GateModal({ viewModel: viewModel.gate })
  }

  const hasRun = hasConcreteRunSelection(viewModel)

  switch (viewModel.route.screen) {
    case 'live':
      return hasRun ? LiveRunView({ viewModel: viewModel.liveRun }) : renderWorkspaceOverview(viewModel)
    case 'inspect':
      return hasRun ? InspectionView({ viewModel: viewModel.inspection }) : renderWorkspaceOverview(viewModel)
    case 'home':
    case 'compose':
    default:
      return renderWorkspaceOverview(viewModel)
  }
}

function renderInputPanel(viewModel: TuiAppViewModel): ReturnType<typeof Box> {
  if (!viewModel.input.visible) {
    return panel('Input', [
      titleText('Input unavailable', 'Lineup is executing the pipeline.'),
      Box(
        { direction: 'row' },
        badge('hidden', 'muted'),
        badge('auto-return', 'accent')
      ),
      Text({ dim: true, children: ['The input panel returns automatically when Lineup needs a new task or a free-text answer.'] }),
      viewModel.chrome.runId ? kvRow('run', viewModel.chrome.runId) : null,
      viewModel.chrome.status ? kvRow('status', String(viewModel.chrome.status)) : null
    ].filter((item): item is NonNullable<typeof item> => item !== null))
  }

  const displayValue = viewModel.input.value.length > 0 ? viewModel.input.value : viewModel.input.placeholder

  return panel('Input', [
    titleText(viewModel.input.label, viewModel.input.hint),
    Box(
      { direction: 'row' },
      badge(viewModel.route.modal === 'gate' ? 'gate response' : 'task input', viewModel.route.modal === 'gate' ? 'warning' : 'accent'),
      badge('active', 'success')
    ),
    Text({ bold: viewModel.input.value.length > 0, dim: viewModel.input.value.length === 0, children: [displayValue || ''] }),
    viewModel.input.context ? Text({ dim: true, children: [viewModel.input.context] }) : null,
    viewModel.chrome.runId ? kvRow('run', viewModel.chrome.runId) : null,
    viewModel.chrome.status ? kvRow('status', String(viewModel.chrome.status)) : null
  ].filter((item): item is NonNullable<typeof item> => item !== null))
}

export function TuiAppShell(props: TuiAppShellProps): ReturnType<typeof Box> {
  const { viewModel } = props

  return Box(
    {
      direction: 'column',
      appShell: true,
      theme: viewModel.theme.name
    },
    Box({ direction: 'column', flexGrow: 1 }, renderScreen(viewModel)),
    renderInputPanel(viewModel)
  )
}
