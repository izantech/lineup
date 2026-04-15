import { Box, Text } from './ink-shim'
import { badge, panel, split } from './layout'
import { GateModal } from './views/gate-modal'
import { HelpPaletteView } from './views/help-palette-view'
import { HomeView } from './views/home-view'
import { InspectionView } from './views/inspection-view'
import { LiveRunView } from './views/live-run-view'
import { RunComposerView } from './views/run-composer-view'
import type { TuiAppViewModel, TuiCallbacks } from './types'

export type TuiAppShellProps = {
  viewModel: TuiAppViewModel
  callbacks?: TuiCallbacks
}

function routeTitle(viewModel: TuiAppViewModel): string {
  const modal = viewModel.route.modal ? ` + ${viewModel.route.modal}` : ''
  return `${viewModel.route.screen}${modal}`
}

function footerHints(viewModel: TuiAppViewModel): readonly string[] {
  const hints = [...viewModel.chrome.hints]

  switch (viewModel.route.screen) {
    case 'compose':
      return ['Tab move', 'Enter start', 'Esc back', ...hints]
    case 'live':
      return ['Enter action', 'r resume', 'a artifacts', 'l logs', ...hints]
    case 'inspect':
      return ['Enter open', 'r resume', 'a artifacts', 'Esc back', ...hints]
    case 'help':
      return ['Type to search', 'Enter run command', 'Esc close', ...hints]
    case 'home':
    default:
      return ['Enter open', 'r resume', 'a artifacts', 'Tab move', ...hints]
  }
}

function renderScreen(viewModel: TuiAppViewModel): ReturnType<typeof Box> {
  switch (viewModel.route.screen) {
    case 'compose':
      return RunComposerView({ viewModel: viewModel.composer })
    case 'live':
      return LiveRunView({ viewModel: viewModel.liveRun })
    case 'inspect':
      return InspectionView({ viewModel: viewModel.inspection })
    case 'help':
      return HelpPaletteView({ viewModel: viewModel.help })
    case 'home':
    default:
      return HomeView({ viewModel: viewModel.home })
  }
}

function renderModal(viewModel: TuiAppViewModel): ReturnType<typeof Box> | null {
  switch (viewModel.route.modal) {
    case 'gate':
      return GateModal({ viewModel: viewModel.gate })
    case 'help':
      return HelpPaletteView({ viewModel: viewModel.help })
    default:
      return null
  }
}

export function TuiAppShell(props: TuiAppShellProps): ReturnType<typeof Box> {
  const { viewModel } = props
  const screen = renderScreen(viewModel)
  const modal = renderModal(viewModel)

  return Box(
    {
      direction: 'column',
      appShell: true,
      theme: viewModel.theme.name
    },
    panel(viewModel.chrome.title, [
      Text({ bold: true, children: [viewModel.chrome.title] }),
      viewModel.chrome.subtitle ? Text({ dim: true, children: [viewModel.chrome.subtitle] }) : null,
      viewModel.chrome.modeSummary ? Text({ children: [viewModel.chrome.modeSummary] }) : null,
      viewModel.chrome.focusSummary ? Text({ dim: true, children: [viewModel.chrome.focusSummary] }) : null,
      viewModel.chrome.selectionSummary ? Text({ dim: true, children: [viewModel.chrome.selectionSummary] }) : null,
      viewModel.chrome.runId ? Text({ children: [`run: ${viewModel.chrome.runId}`] }) : null,
      viewModel.chrome.routeLabel ? badge(viewModel.chrome.routeLabel, 'accent') : null,
      viewModel.chrome.status ? badge(String(viewModel.chrome.status), 'neutral') : null,
      footerHints(viewModel).length > 0 ? Text({ dim: true, children: [footerHints(viewModel).join('   ')] }) : null,
      Text({ dim: true, children: [`route: ${routeTitle(viewModel)}`] })
    ].filter((item): item is NonNullable<typeof item> => item !== null)),
    split([screen], modal ? [modal] : [Text({ dim: true, children: ['Modal closed · Enter activate · / palette · q quit'] })]),
    panel('Footer', [
      Text({ dim: true, children: ['Tab cycle focus   Enter activate   Esc close/back   / palette   q quit'] })
    ])
  )
}
