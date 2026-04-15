import process from 'node:process'

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box as InkBox, Text as InkText, render, useApp, useInput } from 'ink'

import { createLocalAgentRunner } from '../lib/agent-runner.js'
import type { GateResponse } from '../lib/gate-store.js'
import { readBridgeEvents } from '../lib/bridge.js'
import { observePipelineRuns } from '../lib/observer.js'
import { cancelPipelineRun, resumePipelineRun } from '../lib/run-control.js'
import { loadTuiPreferences, protocolMessageToTuiEvent, type TuiLogEvent } from '../lib/tui-models.js'
import { buildTuiAppViewModel } from '../lib/tui-app-state.js'
import { runPipeline } from '../lib/run-pipeline.js'
import { TuiAppShell } from './app-shell'
import {
  COMPOSER_FIELD_COUNT,
  clampTuiSelection,
  createDefaultTuiSessionState,
  reduceTuiSessionState,
  type TuiComposerState,
  type TuiSessionState
} from './controller'
import { collectTuiText, serializeTuiNode } from './snapshot'
import { createTuiAppViewModel, type TuiAppViewModel, type TuiCallbacks } from './types'
import type { TuiNode, TuiPrimitive } from './react-shim'

const ENTER_ALT_SCREEN = '\u001b[?1049h'
const EXIT_ALT_SCREEN = '\u001b[?1049l'

export type TuiAppSession = {
  viewModel: TuiAppViewModel
  tree: TuiNode
  snapshot: string
  text: string
  update: (nextViewModel: Partial<TuiAppViewModel>) => TuiAppSession
  dispose: () => void
  waitUntilExit?: () => Promise<void>
}

export type RunTuiAppOptions = {
  viewModel?: Partial<TuiAppViewModel>
  callbacks?: TuiCallbacks
  cwd?: string
}

const HOSTS: TuiComposerState['host'][] = ['codex', 'claude', 'opencode']
const ISOLATIONS: TuiComposerState['isolation'][] = ['index', 'full', 'sparse']
const IMPLEMENT_METHODS: TuiComposerState['implementMethod'][] = ['phase', 'task', 'single-session']

function defaultComposerState(): TuiComposerState {
  return {
    prompt: '',
    host: 'codex',
    isolation: 'index',
    implementMethod: 'phase',
    approvePlan: false,
    maxParallel: 3
  }
}

function buildTree(viewModel: TuiAppViewModel, callbacks?: TuiCallbacks): TuiNode {
  return TuiAppShell({ viewModel, callbacks })
}

function createSession(viewModel: TuiAppViewModel, callbacks?: TuiCallbacks): TuiAppSession {
  const state = {
    viewModel: createTuiAppViewModel(viewModel)
  }

  const session: TuiAppSession = {
    viewModel: state.viewModel,
    tree: buildTree(state.viewModel, callbacks),
    snapshot: '',
    text: '',
    update(nextViewModel: Partial<TuiAppViewModel>): TuiAppSession {
      state.viewModel = {
        ...createTuiAppViewModel(state.viewModel),
        ...nextViewModel
      }
      session.viewModel = state.viewModel
      session.tree = buildTree(session.viewModel, callbacks)
      session.snapshot = serializeTuiNode(session.tree)
      session.text = collectTuiText(session.tree)
      return session
    },
    dispose() {
      return
    }
  }

  session.snapshot = serializeTuiNode(session.tree)
  session.text = collectTuiText(session.tree)
  return session
}

function resolveToneColor(tone: unknown): string | undefined {
  switch (tone) {
    case 'accent':
      return 'cyan'
    case 'success':
      return 'green'
    case 'warning':
      return 'yellow'
    case 'danger':
      return 'red'
    case 'muted':
      return 'gray'
    default:
      return undefined
  }
}

function primitiveToReactNode(value: TuiPrimitive, key: string, withinText: boolean): React.ReactNode {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null
  }

  const text = String(value)
  if (withinText) {
    return text
  }

  return React.createElement(InkText, { key }, text)
}

function renderInkNode(node: TuiNode, key: string, withinText = false): React.ReactNode {
  if (typeof node !== 'object' || node === null || !('type' in node)) {
    return primitiveToReactNode(node as TuiPrimitive, key, withinText)
  }

  switch (node.type) {
    case 'Text':
      return React.createElement(
        InkText,
        {
          key,
          color: typeof node.props.color === 'string' ? node.props.color : resolveToneColor(node.props.tone),
          bold: Boolean(node.props.bold),
          dimColor: Boolean(node.props.dim)
        },
        ...node.children.map((child, index) => renderInkNode(child, `${key}-text-${index}`, true))
      )

    case 'Divider':
      return React.createElement(InkText, { key, dimColor: true }, '────────────────────────────────────────')

    case 'Spacer':
      return React.createElement(InkText, { key }, ' '.repeat(Number(node.props.size ?? 1)))

    case 'Newline':
      return React.createElement(InkText, { key }, '\n')

    case 'Box':
    default:
      return React.createElement(
        InkBox,
        {
          key,
          flexDirection: node.props.direction === 'row' ? 'row' : 'column',
          borderStyle: node.props.border ? 'round' : undefined,
          borderColor: resolveToneColor(node.props.tone),
          marginBottom: 1,
          paddingX: node.props.border ? 1 : 0,
          paddingY: node.props.border ? 0 : 0,
          width: node.props.split ? '50%' : undefined
        },
        ...node.children.map((child, index) => renderInkNode(child, `${key}-box-${index}`))
      )
  }
}

function cycleValue<T>(values: readonly T[], current: T, delta: 1 | -1): T {
  const index = values.indexOf(current)
  const nextIndex = index < 0 ? 0 : (index + delta + values.length) % values.length
  return values[nextIndex] as T
}

function extractRunIdFromMessage(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || !('params' in message)) {
    return undefined
  }

  const params = (message as { params?: unknown }).params
  if (!params || typeof params !== 'object' || !('runId' in params)) {
    return undefined
  }

  const runId = (params as { runId?: unknown }).runId
  return typeof runId === 'string' ? runId : undefined
}

function bridgeEventToTuiEvent(event: { type: string; seq?: number; stageId?: string; text?: string; question?: string; summary?: string }): TuiLogEvent | null {
  switch (event.type) {
    case 'status':
      return {
        id: `bridge-status-${event.seq ?? 0}`,
        kind: 'status',
        stageId: event.stageId ?? 'pipeline',
        text: event.text ?? ''
      }
    case 'question':
      return {
        id: `bridge-question-${event.seq ?? 0}`,
        kind: 'question',
        stageId: event.stageId ?? 'gate',
        text: event.question ?? ''
      }
    case 'complete':
      return {
        id: `bridge-complete-${event.seq ?? 0}`,
        kind: 'complete',
        stageId: 'pipeline',
        text: event.summary ?? 'Pipeline complete.'
      }
    default:
      return null
  }
}

function preferredInitialRun(cwd: string): { runId: string; screen: 'live' | 'inspect' } | null {
  const latest = observePipelineRuns(cwd)[0]
  if (!latest) {
    return null
  }

  if (latest.status === 'running' || latest.status === 'blocked') {
    return { runId: latest.run_id, screen: 'live' }
  }

  if (latest.status === 'failed' || latest.status === 'canceled') {
    return { runId: latest.run_id, screen: 'inspect' }
  }

  return null
}

type InteractiveTuiAppProps = {
  cwd: string
}

function InteractiveTuiApp(props: InteractiveTuiAppProps) {
  const { cwd } = props
  const { exit } = useApp()
  const preferences = loadTuiPreferences()
  const [session, dispatch] = useReducer(reduceTuiSessionState, undefined, () => createDefaultTuiSessionState(defaultComposerState()))
  const [viewModel, setViewModel] = useState<TuiAppViewModel | null>(null)
  const [liveEventsByRunId, setLiveEventsByRunId] = useState<Record<string, TuiLogEvent[]>>({})
  const gateResolverRef = useRef<((response: GateResponse) => void) | null>(null)

  const appendEvent = useCallback((runId: string, event: TuiLogEvent) => {
    setLiveEventsByRunId((current) => ({
      ...current,
      [runId]: [...(current[runId] ?? []).slice(-199), event]
    }))
  }, [])

  const loadRunHistory = useCallback(async (runId: string) => {
    try {
      const result = await readBridgeEvents(runId, {}, cwd)
      const events = result.events
        .map((event) => bridgeEventToTuiEvent(event as { type: string; seq?: number; stageId?: string; text?: string; question?: string; summary?: string }))
        .filter((event): event is TuiLogEvent => event !== null)
      setLiveEventsByRunId((current) => ({ ...current, [runId]: events }))
    } catch {
      return
    }
  }, [cwd])

  const refreshViewModel = useCallback(async () => {
    const next = await buildTuiAppViewModel({
      cwd,
      session,
      liveEventsByRunId
    })
    setViewModel(next)
  }, [cwd, liveEventsByRunId, session])

  useEffect(() => {
    void refreshViewModel()
  }, [refreshViewModel])

  useEffect(() => {
    const preferred = preferredInitialRun(cwd)
    if (!preferred) {
      return
    }

    dispatch({ type: 'hydrate', selectedRunId: preferred.runId })
    dispatch({ type: 'select-run', runId: preferred.runId, attach: true })
    dispatch({ type: 'open-screen', screen: preferred.screen })
    void loadRunHistory(preferred.runId)
  }, [cwd, loadRunHistory])

  const humanHooks = useCallback(() => ({
    emitHumanTextToStderr: false,
    onProtocolMessage(message: unknown) {
      const event = protocolMessageToTuiEvent(message as Parameters<typeof protocolMessageToTuiEvent>[0])
      const runId = extractRunIdFromMessage(message)
      if (event && runId) {
        appendEvent(runId, event)
        dispatch({ type: 'select-run', runId, attach: true })
      }
    },
    handleHumanGate(gate: Parameters<NonNullable<NonNullable<Parameters<typeof runPipeline>[1]>['handleHumanGate']>>[0]) {
      dispatch({ type: 'set-pending-gate', gate })
      return new Promise<GateResponse>((resolve) => {
        gateResolverRef.current = resolve
      })
    }
  }), [appendEvent])

  const submitSelectedGate = useCallback(() => {
    if (!session.pendingGate || !gateResolverRef.current) {
      return
    }

    const choice =
      session.pendingGate.choices[session.gateSelectionIndex] ??
      session.pendingGate.defaultChoice ??
      session.pendingGate.choices[0]
    if (!choice) {
      return
    }

    gateResolverRef.current({
      requestId: session.pendingGate.requestId,
      choice,
      reason: session.pendingGate.allowFreeText ? session.gateInput.trim() || undefined : undefined,
      respondedAt: new Date().toISOString()
    })
    gateResolverRef.current = null
    dispatch({ type: 'set-pending-gate', gate: null })
  }, [session.gateInput, session.gateSelectionIndex, session.pendingGate])

  const startRun = useCallback(async () => {
    if (!session.composer.prompt.trim() || session.busy) {
      return
    }

    dispatch({ type: 'set-busy', busy: true, statusLine: 'Starting run…' })
    dispatch({ type: 'open-screen', screen: 'live' })

    try {
      const result = await runPipeline(
        {
          prompt: session.composer.prompt,
          mode: 'human',
          host: session.composer.host,
          isolation: session.composer.isolation,
          implementMethod: session.composer.implementMethod,
          approvePlan: session.composer.approvePlan,
          maxParallel: session.composer.maxParallel
        },
        {
          localAgentRunner: createLocalAgentRunner(session.composer.host),
          ...humanHooks()
        }
      )

      dispatch({ type: 'select-run', runId: result.runId, attach: true })
      dispatch({ type: 'open-screen', screen: 'inspect' })
      dispatch({ type: 'record-command', commandId: 'new-run' })
      void loadRunHistory(result.runId)
    } finally {
      dispatch({ type: 'set-pending-gate', gate: null })
      dispatch({ type: 'set-busy', busy: false, statusLine: 'Run finished.' })
    }
  }, [humanHooks, loadRunHistory, session.busy, session.composer])

  const resumeSelectedRun = useCallback(async (retryFailed = false) => {
    if (!session.selectedRunId || session.busy) {
      return
    }

    dispatch({ type: 'set-busy', busy: true, statusLine: `Resuming ${session.selectedRunId}…` })
    dispatch({ type: 'open-screen', screen: 'live' })

    try {
      const resumed = await resumePipelineRun({
        runId: session.selectedRunId,
        retryFailed,
        localAgentRunner: createLocalAgentRunner(session.composer.host),
        emitProtocolToStdout: false,
        emitHumanTextToStderr: false,
        onProtocolMessage: humanHooks().onProtocolMessage,
        handleHumanGate: humanHooks().handleHumanGate
      })

      dispatch({ type: 'select-run', runId: resumed.result.runId, attach: true })
      dispatch({ type: 'open-screen', screen: 'inspect' })
      dispatch({ type: 'record-command', commandId: retryFailed ? 'retry' : 'resume' })
      void loadRunHistory(resumed.result.runId)
    } finally {
      dispatch({ type: 'set-pending-gate', gate: null })
      dispatch({ type: 'set-busy', busy: false, statusLine: 'Resume complete.' })
    }
  }, [humanHooks, loadRunHistory, session.busy, session.composer.host, session.selectedRunId])

  const cancelSelectedRun = useCallback(() => {
    if (!session.selectedRunId) {
      return
    }

    const result = cancelPipelineRun({ runId: session.selectedRunId, cwd })
    dispatch({
      type: 'set-status-line',
      statusLine: result.alreadyTerminal ? `Run ${result.runId} is already ${result.status}.` : `Canceled ${result.runId}.`
    })
    void loadRunHistory(session.selectedRunId)
  }, [cwd, loadRunHistory, session.selectedRunId])

  const applyComposerFieldDelta = useCallback((delta: 1 | -1) => {
    const current = session.composer
    switch (session.composerFieldIndex) {
      case 1:
        dispatch({ type: 'set-composer', composer: { ...current, host: cycleValue(HOSTS, current.host, delta) } })
        return
      case 2:
        dispatch({ type: 'set-composer', composer: { ...current, isolation: cycleValue(ISOLATIONS, current.isolation, delta) } })
        return
      case 3:
        dispatch({ type: 'set-composer', composer: { ...current, implementMethod: cycleValue(IMPLEMENT_METHODS, current.implementMethod, delta) } })
        return
      case 4:
        dispatch({ type: 'set-composer', composer: { ...current, approvePlan: !current.approvePlan } })
        return
      case 5:
        dispatch({ type: 'set-composer', composer: { ...current, maxParallel: Math.max(1, current.maxParallel + (delta === 1 ? 1 : -1)) } })
        return
      default:
        return
    }
  }, [session.composer, session.composerFieldIndex])

  const executeAction = useCallback(async (actionId: string) => {
    switch (actionId) {
      case 'new-run':
        dispatch({ type: 'open-screen', screen: 'compose' })
        return
      case 'start-run':
        await startRun()
        return
      case 'back-home':
        dispatch({ type: 'open-screen', screen: 'home' })
        return
      case 'resume':
      case 'resume-selected':
        await resumeSelectedRun(false)
        return
      case 'retry':
        await resumeSelectedRun(true)
        return
      case 'cancel':
        cancelSelectedRun()
        return
      case 'inspect':
      case 'inspect-run':
      case 'inspect-selected':
      case 'artifacts':
      case 'artifacts-plan':
      case 'artifacts-review':
        dispatch({ type: 'open-screen', screen: 'inspect' })
        dispatch({ type: 'set-inspect-focus', focus: 'artifacts' })
        return
      case 'logs':
        dispatch({ type: 'toggle-logs' })
        return
      case 'refresh':
      case 'doctor':
        dispatch({ type: 'set-status-line', statusLine: 'Refreshing readiness…' })
        await refreshViewModel()
        return
      case 'quit':
        exit()
        return
      default:
        return
    }
  }, [cancelSelectedRun, exit, refreshViewModel, resumeSelectedRun, startRun])

  const executeCurrentSelection = useCallback(async () => {
    if (!viewModel) {
      return
    }

    if (session.route.modal === 'help') {
      const command = viewModel.help.commands[session.helpSelectedIndex]
      if (command) {
        await executeAction(command.id)
        dispatch({ type: 'record-command', commandId: command.id })
      }
      dispatch({ type: 'close-modal' })
      return
    }

    if (session.route.modal === 'gate') {
      submitSelectedGate()
      return
    }

    switch (session.route.screen) {
      case 'home':
        if (session.homeFocus === 'quickActions') {
          const action = viewModel.home.quickActions[session.homeActionIndex]
          if (action) {
            await executeAction(action.id)
          }
          return
        }

        if (session.homeFocus === 'recentRuns') {
          const run = viewModel.home.recentRuns[session.homeRunIndex]
          if (run) {
            dispatch({ type: 'select-run', runId: run.runId, attach: true })
            dispatch({ type: 'open-screen', screen: run.status === 'running' || run.status === 'blocked' ? 'live' : 'inspect' })
            void loadRunHistory(run.runId)
          }
        }
        return

      case 'compose':
        if (session.composerFocus === 'actions') {
          const action = viewModel.composer.suggestedActions[session.composerActionIndex]
          if (action) {
            await executeAction(action.id)
          }
          return
        }
        await startRun()
        return

      case 'live':
        if (session.liveFocus === 'nextActions') {
          const action = viewModel.liveRun.nextActions[session.liveActionIndex]
          if (action) {
            await executeAction(action.id)
          }
          return
        }
        if (session.liveFocus === 'artifacts') {
          dispatch({ type: 'open-screen', screen: 'inspect' })
          dispatch({ type: 'set-inspect-focus', focus: 'artifacts' })
        }
        return

      case 'inspect':
        if (session.inspectFocus === 'actions') {
          const action = viewModel.inspection.actions[session.inspectActionIndex]
          if (action) {
            await executeAction(action.id)
          }
          return
        }
        if (session.inspectFocus === 'recentRuns') {
          const run = viewModel.inspection.recentRuns[session.inspectRecentRunIndex]
          if (run) {
            dispatch({ type: 'select-run', runId: run.runId, attach: true })
            void loadRunHistory(run.runId)
          }
        }
        return

      default:
        return
    }
  }, [executeAction, loadRunHistory, session, startRun, submitSelectedGate, viewModel])

  useInput((input, key) => {
    if (key.escape) {
      if (session.route.modal) {
        dispatch({ type: 'close-modal' })
        return
      }
      if (session.route.screen !== 'home') {
        dispatch({ type: 'open-screen', screen: 'home' })
      }
      return
    }

    if (input === preferences.keybindings.quit) {
      exit()
      return
    }

    if (input === preferences.keybindings.commandPalette) {
      dispatch({ type: 'set-help-query', query: '' })
      dispatch({ type: 'open-modal', modal: 'help' })
      return
    }

    if (session.route.modal === 'help') {
      if (key.backspace || key.delete) {
        dispatch({ type: 'backspace-help-query' })
        return
      }
      if (key.upArrow) {
        dispatch({ type: 'move-help-selection', delta: -1, count: viewModel?.help.commands.length ?? 0 })
        return
      }
      if (key.downArrow) {
        dispatch({ type: 'move-help-selection', delta: 1, count: viewModel?.help.commands.length ?? 0 })
        return
      }
      if (key.return) {
        void executeCurrentSelection()
        return
      }
      if (!key.ctrl && !key.meta && input.length === 1) {
        dispatch({ type: 'append-help-query', value: input })
      }
      return
    }

    if (session.route.modal === 'gate') {
      const numericChoice = Number.parseInt(input, 10)
      if (session.pendingGate && Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= session.pendingGate.choices.length) {
        dispatch({ type: 'select-gate-index', index: numericChoice - 1 })
        submitSelectedGate()
        return
      }
      if (key.upArrow) {
        dispatch({ type: 'move-gate-selection', delta: -1, count: session.pendingGate?.choices.length ?? 0 })
        return
      }
      if (key.downArrow) {
        dispatch({ type: 'move-gate-selection', delta: 1, count: session.pendingGate?.choices.length ?? 0 })
        return
      }
      if (key.return) {
        submitSelectedGate()
        return
      }
      if (session.pendingGate?.allowFreeText) {
        if (key.backspace || key.delete) {
          dispatch({ type: 'backspace-gate-input' })
          return
        }
        if (!key.ctrl && !key.meta && input.length === 1 && !/^\d$/.test(input)) {
          dispatch({ type: 'append-gate-input', value: input })
        }
      }
      return
    }

    if (input === preferences.keybindings.resume) {
      void resumeSelectedRun(false)
      return
    }

    if (input === preferences.keybindings.artifacts && session.selectedRunId) {
      dispatch({ type: 'open-screen', screen: 'inspect' })
      dispatch({ type: 'set-inspect-focus', focus: 'artifacts' })
      return
    }

    if (input === preferences.keybindings.logs && session.selectedRunId) {
      dispatch({ type: 'toggle-logs' })
      return
    }

    if (key.tab) {
      dispatch({ type: key.shift ? 'focus-prev' : 'focus-next' })
      return
    }

    if (key.upArrow) {
      if (session.route.screen === 'home') {
        dispatch({
          type: 'move-home-selection',
          delta: -1,
          runCount: viewModel?.home.recentRuns.length ?? 0,
          actionCount: viewModel?.home.quickActions.length ?? 0
        })
      } else {
        dispatch({ type: 'move-list', delta: -1, count: 999 })
      }
      return
    }

    if (key.downArrow) {
      if (session.route.screen === 'home') {
        dispatch({
          type: 'move-home-selection',
          delta: 1,
          runCount: viewModel?.home.recentRuns.length ?? 0,
          actionCount: viewModel?.home.quickActions.length ?? 0
        })
      } else {
        dispatch({ type: 'move-list', delta: 1, count: 999 })
      }
      return
    }

    if (key.return) {
      void executeCurrentSelection()
      return
    }

    if (session.route.screen === 'compose') {
      if (session.composerFocus === 'prompt') {
        if (key.backspace || key.delete) {
          dispatch({ type: 'backspace-composer-prompt' })
          return
        }
        if (!key.ctrl && !key.meta && input.length === 1) {
          dispatch({ type: 'append-composer-prompt', value: input })
          return
        }
      }

      if (session.composerFocus === 'fields') {
        if (key.leftArrow || input === 'k') {
          applyComposerFieldDelta(-1)
          return
        }
        if (key.rightArrow || input === 'j' || input === ' ') {
          applyComposerFieldDelta(1)
          return
        }
      }
    }
  }, { isActive: true })

  const tree = useMemo(() => (viewModel ? buildTree(viewModel) : null), [viewModel])

  if (!tree || !viewModel) {
    return React.createElement(InkBox, { flexDirection: 'column' }, React.createElement(InkText, null, 'Loading Lineup…'))
  }

  return React.createElement(InkBox, { flexDirection: 'column' }, renderInkNode(tree, 'root'))
}

function openAlternateScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(ENTER_ALT_SCREEN)
  }
}

function closeAlternateScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(EXIT_ALT_SCREEN)
  }
}

export async function runTuiApp(options: RunTuiAppOptions = {}): Promise<TuiAppSession> {
  if (options.viewModel) {
    return createSession(createTuiAppViewModel(options.viewModel), options.callbacks)
  }

  openAlternateScreen()
  const app = render(React.createElement(InteractiveTuiApp, { cwd: options.cwd ?? process.cwd() }), {
    exitOnCtrlC: true,
    patchConsole: false
  })

  const initialViewModel = await buildTuiAppViewModel({
    cwd: options.cwd ?? process.cwd(),
    session: createDefaultTuiSessionState(defaultComposerState()),
    liveEventsByRunId: {}
  })
  const session = createSession(initialViewModel, options.callbacks)

  session.dispose = () => {
    closeAlternateScreen()
    app.unmount()
  }
  session.waitUntilExit = async () => {
    try {
      await app.waitUntilExit()
    } finally {
      closeAlternateScreen()
    }
  }

  return session
}

export function createTuiAppSession(viewModel: TuiAppViewModel, callbacks?: TuiCallbacks): TuiAppSession {
  return createSession(viewModel, callbacks)
}
