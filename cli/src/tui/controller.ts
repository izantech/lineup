import type { PendingGate } from '../lib/gate-store.js'
import type { TuiRoute } from './types.js'

export const COMPOSER_FIELD_COUNT = 13

export type TuiRuntimeRoute = TuiRoute

export type TuiComposerState = {
  prompt: string
  host: 'claude' | 'codex' | 'opencode'
  workflow?: string
  tactic?: string
  isolation: 'index' | 'full' | 'sparse'
  implementMethod: 'phase' | 'task' | 'single-session'
  fromStage?: string
  timeout?: number
  gateTimeout?: number
  dryRun: boolean
  forceRerun: boolean
  approvePlan: boolean
  maxParallel: number
}

export type TuiHomeFocus = 'recentRuns' | 'quickActions'
export type TuiComposerFocus = 'prompt' | 'fields' | 'actions'
export type TuiLiveFocus = 'timeline' | 'logs' | 'nextActions' | 'artifacts'
export type TuiInspectFocus = 'sections' | 'actions' | 'artifacts' | 'diffs' | 'recentRuns'
export type TuiInspectPane = 'summary' | 'artifacts' | 'content' | 'diff' | 'logs' | 'replay' | 'history' | 'actions'

export type TuiSessionState = {
  route: TuiRuntimeRoute
  selectedRunId?: string
  attachedRunId?: string
  homeFocus: TuiHomeFocus
  homeRunIndex: number
  homeActionIndex: number
  composer: TuiComposerState
  composerFocus: TuiComposerFocus
  composerFieldIndex: number
  composerActionIndex: number
  liveFocus: TuiLiveFocus
  liveTimelineIndex: number
  liveLogIndex: number
  liveActionIndex: number
  liveArtifactIndex: number
  inspectFocus: TuiInspectFocus
  inspectPane: TuiInspectPane
  inspectSectionIndex: number
  inspectActionIndex: number
  inspectArtifactIndex: number
  inspectDiffIndex: number
  inspectRecentRunIndex: number
  helpQuery: string
  helpSelectedIndex: number
  recentCommandIds: string[]
  showLogs: boolean
  pendingGate: PendingGate | null
  gateSelectionIndex: number
  gateInput: string
  busy: boolean
  statusLine?: string
}

export type TuiControllerAction =
  | { type: 'open-screen'; screen: TuiRuntimeRoute['screen'] }
  | { type: 'open-modal'; modal: NonNullable<TuiRuntimeRoute['modal']> }
  | { type: 'close-modal' }
  | { type: 'select-run'; runId?: string; attach?: boolean }
  | { type: 'set-home-focus'; focus: TuiHomeFocus }
  | { type: 'set-composer-focus'; focus: TuiComposerFocus }
  | { type: 'set-live-focus'; focus: TuiLiveFocus }
  | { type: 'set-inspect-focus'; focus: TuiInspectFocus }
  | { type: 'set-inspect-pane'; pane: TuiInspectPane }
  | { type: 'move-home-selection'; delta: 1 | -1; runCount: number; actionCount: number }
  | { type: 'focus-next' }
  | { type: 'focus-prev' }
  | { type: 'move-list'; delta: 1 | -1; count: number }
  | { type: 'set-composer-prompt'; prompt: string }
  | { type: 'set-composer'; composer: TuiComposerState }
  | { type: 'append-composer-prompt'; value: string }
  | { type: 'backspace-composer-prompt' }
  | { type: 'cycle-composer-field'; delta: 1 | -1 }
  | { type: 'cycle-composer-action'; delta: 1 | -1; count: number }
  | { type: 'set-help-query'; query: string }
  | { type: 'append-help-query'; value: string }
  | { type: 'backspace-help-query' }
  | { type: 'select-help-index'; index: number }
  | { type: 'move-help-selection'; delta: 1 | -1; count: number }
  | { type: 'record-command'; commandId: string }
  | { type: 'toggle-logs' }
  | { type: 'set-pending-gate'; gate: PendingGate | null }
  | { type: 'select-gate-index'; index: number }
  | { type: 'move-gate-selection'; delta: 1 | -1; count: number }
  | { type: 'set-gate-input'; value: string }
  | { type: 'append-gate-input'; value: string }
  | { type: 'backspace-gate-input' }
  | { type: 'set-busy'; busy: boolean; statusLine?: string }
  | { type: 'set-status-line'; statusLine?: string }
  | { type: 'hydrate'; selectedRunId?: string }

function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0
  }

  return Math.max(0, Math.min(index, count - 1))
}

function cycleIndex(index: number, count: number, delta: 1 | -1): number {
  if (count <= 0) {
    return 0
  }

  return (index + delta + count) % count
}

export function createDefaultTuiSessionState(composer: TuiComposerState): TuiSessionState {
  return {
    route: { screen: 'home' },
    homeFocus: 'quickActions',
    homeRunIndex: 0,
    homeActionIndex: 0,
    composer,
    composerFocus: 'prompt',
    composerFieldIndex: 0,
    composerActionIndex: 0,
    liveFocus: 'nextActions',
    liveTimelineIndex: 0,
    liveLogIndex: 0,
    liveActionIndex: 0,
    liveArtifactIndex: 0,
    inspectFocus: 'actions',
    inspectPane: 'summary',
    inspectSectionIndex: 0,
    inspectActionIndex: 0,
    inspectArtifactIndex: 0,
    inspectDiffIndex: 0,
    inspectRecentRunIndex: 0,
    helpQuery: '',
    helpSelectedIndex: 0,
    recentCommandIds: [],
    showLogs: true,
    pendingGate: null,
    gateSelectionIndex: 0,
    gateInput: '',
    busy: false
  }
}

function moveScreenFocus(state: TuiSessionState, delta: 1 | -1): TuiSessionState {
  switch (state.route.screen) {
    case 'home': {
      const order: TuiHomeFocus[] = ['quickActions', 'recentRuns']
      const index = order.indexOf(state.homeFocus)
      return {
        ...state,
        homeFocus: order[(index + delta + order.length) % order.length] ?? state.homeFocus
      }
    }

    case 'compose': {
      const order: TuiComposerFocus[] = ['prompt', 'fields', 'actions']
      const index = order.indexOf(state.composerFocus)
      return {
        ...state,
        composerFocus: order[(index + delta + order.length) % order.length] ?? state.composerFocus
      }
    }

    case 'live': {
      const order: TuiLiveFocus[] = ['timeline', 'logs', 'nextActions', 'artifacts']
      const index = order.indexOf(state.liveFocus)
      return {
        ...state,
        liveFocus: order[(index + delta + order.length) % order.length] ?? state.liveFocus
      }
    }

    case 'inspect': {
      const order: TuiInspectFocus[] = ['actions', 'recentRuns', 'artifacts', 'diffs', 'sections']
      const index = order.indexOf(state.inspectFocus)
      return {
        ...state,
        inspectFocus: order[(index + delta + order.length) % order.length] ?? state.inspectFocus
      }
    }

    default:
      return state
  }
}

export function reduceTuiSessionState(state: TuiSessionState, action: TuiControllerAction): TuiSessionState {
  switch (action.type) {
    case 'hydrate':
      return action.selectedRunId
        ? {
            ...state,
            selectedRunId: state.selectedRunId ?? action.selectedRunId,
            attachedRunId: state.attachedRunId ?? action.selectedRunId
          }
        : state

    case 'open-screen':
      return {
        ...state,
        route: { screen: action.screen }
      }

    case 'open-modal':
      return {
        ...state,
        route: { ...state.route, modal: action.modal }
      }

    case 'close-modal':
      return state.route.modal
        ? {
            ...state,
            route: { screen: state.route.screen }
          }
        : state

    case 'select-run':
      return {
        ...state,
        selectedRunId: action.runId,
        attachedRunId: action.attach ? action.runId : state.attachedRunId
      }

    case 'set-home-focus':
      return {
        ...state,
        homeFocus: action.focus
      }

    case 'set-composer-focus':
      return {
        ...state,
        composerFocus: action.focus
      }

    case 'set-live-focus':
      return {
        ...state,
        liveFocus: action.focus
      }

    case 'set-inspect-focus':
      return {
        ...state,
        inspectFocus: action.focus
      }

    case 'set-inspect-pane':
      return {
        ...state,
        inspectPane: action.pane
      }

    case 'move-home-selection':
      if (state.homeFocus === 'recentRuns') {
        return {
          ...state,
          homeRunIndex: cycleIndex(state.homeRunIndex, action.runCount, action.delta)
        }
      }

      return {
        ...state,
        homeActionIndex: cycleIndex(state.homeActionIndex, action.actionCount, action.delta)
      }

    case 'focus-next':
      return moveScreenFocus(state, 1)

    case 'focus-prev':
      return moveScreenFocus(state, -1)

    case 'move-list':
      switch (state.route.modal) {
        case 'help':
          return {
            ...state,
            helpSelectedIndex: cycleIndex(state.helpSelectedIndex, action.count, action.delta)
          }
        case 'gate':
          return {
            ...state,
            gateSelectionIndex: cycleIndex(state.gateSelectionIndex, action.count, action.delta)
          }
        default:
          break
      }

      switch (state.route.screen) {
        case 'compose':
          if (state.composerFocus === 'fields') {
            return {
              ...state,
              composerFieldIndex: cycleIndex(state.composerFieldIndex, COMPOSER_FIELD_COUNT, action.delta)
            }
          }
          if (state.composerFocus === 'actions') {
            return {
              ...state,
              composerActionIndex: cycleIndex(state.composerActionIndex, action.count, action.delta)
            }
          }
          return state

        case 'live':
          if (state.liveFocus === 'timeline') {
            return { ...state, liveTimelineIndex: cycleIndex(state.liveTimelineIndex, action.count, action.delta) }
          }
          if (state.liveFocus === 'logs') {
            return { ...state, liveLogIndex: cycleIndex(state.liveLogIndex, action.count, action.delta) }
          }
          if (state.liveFocus === 'nextActions') {
            return { ...state, liveActionIndex: cycleIndex(state.liveActionIndex, action.count, action.delta) }
          }
          if (state.liveFocus === 'artifacts') {
            return { ...state, liveArtifactIndex: cycleIndex(state.liveArtifactIndex, action.count, action.delta) }
          }
          return state

        case 'inspect':
          if (state.inspectFocus === 'actions') {
            return { ...state, inspectActionIndex: cycleIndex(state.inspectActionIndex, action.count, action.delta) }
          }
          if (state.inspectFocus === 'recentRuns') {
            return { ...state, inspectRecentRunIndex: cycleIndex(state.inspectRecentRunIndex, action.count, action.delta) }
          }
          if (state.inspectFocus === 'artifacts') {
            return { ...state, inspectArtifactIndex: cycleIndex(state.inspectArtifactIndex, action.count, action.delta) }
          }
          if (state.inspectFocus === 'diffs') {
            return { ...state, inspectDiffIndex: cycleIndex(state.inspectDiffIndex, action.count, action.delta) }
          }
          if (state.inspectFocus === 'sections') {
            return { ...state, inspectSectionIndex: cycleIndex(state.inspectSectionIndex, action.count, action.delta) }
          }
          return state

        default:
          return state
      }

    case 'set-composer-prompt':
      return {
        ...state,
        composer: {
          ...state.composer,
          prompt: action.prompt
        }
      }

    case 'set-composer':
      return {
        ...state,
        composer: action.composer
      }

    case 'append-composer-prompt':
      return {
        ...state,
        composer: {
          ...state.composer,
          prompt: `${state.composer.prompt}${action.value}`
        }
      }

    case 'backspace-composer-prompt':
      return {
        ...state,
        composer: {
          ...state.composer,
          prompt: state.composer.prompt.slice(0, -1)
        }
      }

    case 'cycle-composer-field':
      return {
        ...state,
        composerFieldIndex: cycleIndex(state.composerFieldIndex, COMPOSER_FIELD_COUNT, action.delta)
      }

    case 'cycle-composer-action':
      return {
        ...state,
        composerActionIndex: cycleIndex(state.composerActionIndex, action.count, action.delta)
      }

    case 'set-help-query':
      return {
        ...state,
        helpQuery: action.query,
        helpSelectedIndex: 0
      }

    case 'append-help-query':
      return {
        ...state,
        helpQuery: `${state.helpQuery}${action.value}`,
        helpSelectedIndex: 0
      }

    case 'backspace-help-query':
      return {
        ...state,
        helpQuery: state.helpQuery.slice(0, -1),
        helpSelectedIndex: 0
      }

    case 'select-help-index':
      return {
        ...state,
        helpSelectedIndex: Math.max(0, action.index)
      }

    case 'move-help-selection':
      return {
        ...state,
        helpSelectedIndex: cycleIndex(state.helpSelectedIndex, action.count, action.delta)
      }

    case 'record-command':
      return {
        ...state,
        recentCommandIds: [action.commandId, ...state.recentCommandIds.filter((item) => item !== action.commandId)].slice(0, 6)
      }

    case 'toggle-logs':
      return {
        ...state,
        showLogs: !state.showLogs
      }

    case 'set-pending-gate':
      return {
        ...state,
        pendingGate: action.gate,
        gateSelectionIndex: 0,
        gateInput: '',
        route: action.gate ? { screen: 'live', modal: 'gate' } : { screen: 'live' }
      }

    case 'select-gate-index':
      return {
        ...state,
        gateSelectionIndex: Math.max(0, action.index)
      }

    case 'move-gate-selection':
      return {
        ...state,
        gateSelectionIndex: cycleIndex(state.gateSelectionIndex, action.count, action.delta)
      }

    case 'set-gate-input':
      return {
        ...state,
        gateInput: action.value
      }

    case 'append-gate-input':
      return {
        ...state,
        gateInput: `${state.gateInput}${action.value}`
      }

    case 'backspace-gate-input':
      return {
        ...state,
        gateInput: state.gateInput.slice(0, -1)
      }

    case 'set-busy':
      return {
        ...state,
        busy: action.busy,
        ...(action.statusLine !== undefined ? { statusLine: action.statusLine } : {})
      }

    case 'set-status-line':
      return {
        ...state,
        statusLine: action.statusLine
      }

    default:
      return state
  }
}

export function clampTuiSelection(state: TuiSessionState, counts: {
  homeRuns?: number
  homeActions?: number
  composerActions?: number
  liveTimeline?: number
  liveLogs?: number
  liveActions?: number
  liveArtifacts?: number
  inspectSections?: number
  inspectActions?: number
  inspectArtifacts?: number
  inspectDiffs?: number
  inspectRecentRuns?: number
  helpCommands?: number
  gateChoices?: number
}): TuiSessionState {
  return {
    ...state,
    homeRunIndex: clampIndex(state.homeRunIndex, counts.homeRuns ?? 0),
    homeActionIndex: clampIndex(state.homeActionIndex, counts.homeActions ?? 0),
    composerActionIndex: clampIndex(state.composerActionIndex, counts.composerActions ?? 0),
    liveTimelineIndex: clampIndex(state.liveTimelineIndex, counts.liveTimeline ?? 0),
    liveLogIndex: clampIndex(state.liveLogIndex, counts.liveLogs ?? 0),
    liveActionIndex: clampIndex(state.liveActionIndex, counts.liveActions ?? 0),
    liveArtifactIndex: clampIndex(state.liveArtifactIndex, counts.liveArtifacts ?? 0),
    inspectSectionIndex: clampIndex(state.inspectSectionIndex, counts.inspectSections ?? 0),
    inspectActionIndex: clampIndex(state.inspectActionIndex, counts.inspectActions ?? 0),
    inspectArtifactIndex: clampIndex(state.inspectArtifactIndex, counts.inspectArtifacts ?? 0),
    inspectDiffIndex: clampIndex(state.inspectDiffIndex, counts.inspectDiffs ?? 0),
    inspectRecentRunIndex: clampIndex(state.inspectRecentRunIndex, counts.inspectRecentRuns ?? 0),
    helpSelectedIndex: clampIndex(state.helpSelectedIndex, counts.helpCommands ?? 0),
    gateSelectionIndex: clampIndex(state.gateSelectionIndex, counts.gateChoices ?? 0)
  }
}
