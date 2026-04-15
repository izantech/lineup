import process from 'node:process'

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box as InkBox, Text as InkText, render, useApp, useInput } from 'ink'

import { createLocalAgentRunner } from '../lib/agent-runner.js'
import { SUPPORTED_HOSTS } from '../lib/constants.js'
import type { GateResponse } from '../lib/gate-store.js'
import { readBridgeEvents } from '../lib/bridge.js'
import { readStatus } from '../lib/operations.js'
import { loadPipelineState } from '../lib/state.js'
import { detectTuiTerminalCapabilities } from '../lib/tui-terminal.js'
import { listTacticEntries, listWorkflowEntries } from '../lib/tui-services.js'
import { cancelPipelineRun, resumePipelineRun } from '../lib/run-control.js'
import { initializeLineupProject } from '../commands/init.js'
import { protocolMessageToTuiEvent, type TuiLogEvent } from '../lib/tui-models.js'
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
const INSPECT_PANES = ['summary', 'artifacts', 'content', 'diff', 'logs', 'replay', 'history', 'actions'] as const

function defaultComposerState(): TuiComposerState {
  return {
    prompt: '',
    host: 'codex',
    workflow: undefined,
    tactic: undefined,
    isolation: 'index',
    implementMethod: 'phase',
    fromStage: undefined,
    timeout: undefined,
    gateTimeout: undefined,
    dryRun: false,
    forceRerun: false,
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
      {
        const splitRole = node.props.split
        const isSplitContainer = splitRole === true
        const isSplitChild = splitRole === 'left' || splitRole === 'right'
        const explicitWidth = typeof node.props.width === 'string' || typeof node.props.width === 'number' ? node.props.width : undefined

        return React.createElement(
        InkBox,
        {
          key,
          flexDirection: node.props.direction === 'row' ? 'row' : 'column',
          borderStyle: node.props.border ? 'round' : undefined,
          borderColor: resolveToneColor(node.props.tone),
          marginBottom: node.props.border || node.props.section || node.props.modal ? 1 : 0,
          paddingX: node.props.border ? 1 : 0,
          paddingY: node.props.border ? 0 : 0,
          width: explicitWidth ?? (node.props.appShell || isSplitContainer ? '100%' : isSplitChild ? '50%' : undefined),
          flexGrow:
            typeof node.props.flexGrow === 'number'
              ? node.props.flexGrow
              : explicitWidth === undefined && (node.props.appShell || isSplitContainer || isSplitChild)
                ? 1
                : undefined
        },
        ...node.children.map((child, index) => renderInkNode(child, `${key}-box-${index}`))
      )
      }
  }
}

function cycleValue<T>(values: readonly T[], current: T, delta: 1 | -1): T {
  const index = values.indexOf(current)
  const nextIndex = index < 0 ? 0 : (index + delta + values.length) % values.length
  return values[nextIndex] as T
}

function cycleOptionalValue(values: readonly string[], current: string | undefined, delta: 1 | -1): string | undefined {
  const entries = ['', ...values]
  const currentValue = current ?? ''
  const index = entries.indexOf(currentValue)
  const nextIndex = index < 0 ? 0 : (index + delta + entries.length) % entries.length
  return entries[nextIndex] || undefined
}

function cycleInspectPane(current: typeof INSPECT_PANES[number], delta: 1 | -1): typeof INSPECT_PANES[number] {
  const index = INSPECT_PANES.indexOf(current)
  const nextIndex = index < 0 ? 0 : (index + delta + INSPECT_PANES.length) % INSPECT_PANES.length
  return INSPECT_PANES[nextIndex] ?? 'summary'
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

type InteractiveTuiAppProps = {
  cwd: string
}

function InteractiveTuiApp(props: InteractiveTuiAppProps) {
  const { cwd } = props
  const { exit } = useApp()
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
      dispatch({ type: 'open-modal', modal: 'gate' })
      return new Promise<GateResponse>((resolve) => {
        gateResolverRef.current = resolve
      })
    }
  }), [appendEvent])

  const submitSelectedGate = useCallback(() => {
    if (!session.pendingGate || !gateResolverRef.current) {
      return
    }

    const rawInput = session.gateInput.trim()
    const numericChoice = Number.parseInt(rawInput, 10)
    const matchedChoice =
      Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= session.pendingGate.choices.length
        ? session.pendingGate.choices[numericChoice - 1]
        : session.pendingGate.choices.find((choice) => choice.toLowerCase() === rawInput.toLowerCase())
    const choice =
      matchedChoice ??
      session.pendingGate.defaultChoice ??
      session.pendingGate.choices[session.gateSelectionIndex] ??
      session.pendingGate.choices[0]
    if (!choice) {
      return
    }

    gateResolverRef.current({
      requestId: session.pendingGate.requestId,
      choice,
      reason:
        session.pendingGate.allowFreeText && rawInput.length > 0 && matchedChoice === undefined
          ? rawInput
          : undefined,
      respondedAt: new Date().toISOString()
    })
    gateResolverRef.current = null
    dispatch({ type: 'set-pending-gate', gate: null })
    dispatch({ type: 'set-gate-input', value: '' })
    dispatch({ type: 'close-modal' })
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
          workflow: session.composer.workflow,
          tactic: session.composer.tactic,
          fromStage: session.composer.fromStage,
          dryRun: session.composer.dryRun,
          forceRerun: session.composer.forceRerun,
          timeout: session.composer.timeout,
          gateTimeout: session.composer.gateTimeout,
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
    const workflowOptions = listWorkflowEntries(cwd).map((entry) => entry.file)
    const tacticOptions = listTacticEntries(cwd, true).map((entry) => entry.name)
    const selectedRunState = session.selectedRunId ? loadPipelineState(session.selectedRunId, cwd) : null
    switch (session.composerFieldIndex) {
      case 1:
        dispatch({ type: 'set-composer', composer: { ...current, host: cycleValue(HOSTS, current.host, delta) } })
        return
      case 2:
        {
          const workflow = cycleOptionalValue(workflowOptions, current.workflow, delta)
          dispatch({
            type: 'set-composer',
            composer: { ...current, workflow, tactic: workflow ? undefined : current.tactic }
          })
        }
        return
      case 3:
        {
          const tactic = cycleOptionalValue(tacticOptions, current.tactic, delta)
          dispatch({
            type: 'set-composer',
            composer: { ...current, tactic, workflow: tactic ? undefined : current.workflow }
          })
        }
        return
      case 4:
        dispatch({ type: 'set-composer', composer: { ...current, isolation: cycleValue(ISOLATIONS, current.isolation, delta) } })
        return
      case 5:
        dispatch({ type: 'set-composer', composer: { ...current, implementMethod: cycleValue(IMPLEMENT_METHODS, current.implementMethod, delta) } })
        return
      case 6:
        dispatch({
          type: 'set-composer',
          composer: { ...current, fromStage: current.fromStage ? undefined : selectedRunState?.current_stage ?? undefined }
        })
        return
      case 7:
        dispatch({
          type: 'set-composer',
          composer: { ...current, timeout: Math.max(60, (current.timeout ?? 60) + (delta === 1 ? 60 : -60)) }
        })
        return
      case 8:
        dispatch({
          type: 'set-composer',
          composer: { ...current, gateTimeout: Math.max(60, (current.gateTimeout ?? 60) + (delta === 1 ? 60 : -60)) }
        })
        return
      case 9:
        dispatch({ type: 'set-composer', composer: { ...current, dryRun: !current.dryRun } })
        return
      case 10:
        dispatch({ type: 'set-composer', composer: { ...current, forceRerun: !current.forceRerun } })
        return
      case 11:
        dispatch({ type: 'set-composer', composer: { ...current, approvePlan: !current.approvePlan } })
        return
      case 12:
        dispatch({ type: 'set-composer', composer: { ...current, maxParallel: Math.max(1, current.maxParallel + (delta === 1 ? 1 : -1)) } })
        return
      default:
        return
    }
  }, [cwd, session.composer, session.composerFieldIndex, session.selectedRunId])

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
        dispatch({ type: 'set-inspect-pane', pane: actionId === 'inspect' || actionId === 'inspect-run' || actionId === 'inspect-selected' ? 'summary' : 'artifacts' })
        return
      case 'logs':
        if (session.route.screen === 'inspect') {
          dispatch({ type: 'set-inspect-pane', pane: 'logs' })
        } else {
          dispatch({ type: 'toggle-logs' })
        }
        return
      case 'refresh':
      case 'doctor':
        dispatch({ type: 'set-status-line', statusLine: 'Refreshing readiness…' })
        await refreshViewModel()
        return
      case 'init-project':
        initializeLineupProject({}, cwd)
        dispatch({ type: 'set-status-line', statusLine: 'Initialized Lineup project scaffolding.' })
        await refreshViewModel()
        dispatch({ type: 'open-screen', screen: 'home' })
        return
      case 'show-status': {
        const status = await readStatus([...SUPPORTED_HOSTS])
        const installed = Object.values(status.hosts).filter((item) => item?.installed).length
        dispatch({
          type: 'set-status-line',
          statusLine: `Host status: ${installed}/${SUPPORTED_HOSTS.length} installed · state ${status.state_file}`
        })
        await refreshViewModel()
        dispatch({ type: 'open-screen', screen: 'home' })
        return
      }
      case 'quit':
        exit()
        return
      default:
        return
    }
  }, [cancelSelectedRun, cwd, exit, refreshViewModel, resumeSelectedRun, session.route.screen, startRun])

  useInput((input, key) => {
    if (key.escape) {
      if (session.pendingGate) {
        dispatch({ type: 'set-gate-input', value: '' })
        return
      }

      dispatch({ type: 'set-composer-prompt', prompt: '' })
      return
    }

    if (session.pendingGate) {
      if (!session.pendingGate.allowFreeText && session.pendingGate.choices.length > 0) {
        const numericChoice = Number.parseInt(input, 10)
        if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= session.pendingGate.choices.length) {
          dispatch({ type: 'select-gate-index', index: numericChoice - 1 })
          return
        }
        if (key.upArrow) {
          dispatch({ type: 'move-gate-selection', delta: -1, count: session.pendingGate.choices.length })
          return
        }
        if (key.downArrow) {
          dispatch({ type: 'move-gate-selection', delta: 1, count: session.pendingGate.choices.length })
          return
        }
      }

      if (key.return) {
        submitSelectedGate()
        return
      }

      if (key.backspace || key.delete) {
        dispatch({ type: 'backspace-gate-input' })
        return
      }

      if (!key.ctrl && !key.meta && !session.busy && input.length === 1) {
        dispatch({ type: 'append-gate-input', value: input })
      }
      return
    }

    if (key.return) {
      void startRun()
      return
    }

    if (key.backspace || key.delete) {
      dispatch({ type: 'backspace-composer-prompt' })
      return
    }

    if (!key.ctrl && !key.meta && !session.busy && input.length === 1) {
      dispatch({ type: 'append-composer-prompt', value: input })
    }
  }, { isActive: true })

  const tree = useMemo(() => (viewModel ? buildTree(viewModel) : null), [viewModel])

  if (!tree || !viewModel) {
    return React.createElement(InkBox, { flexDirection: 'column' }, React.createElement(InkText, null, 'Loading Lineup…'))
  }

  return React.createElement(
    InkBox,
    {
      flexDirection: 'column',
      width: '100%',
      height: process.stdout.rows ?? undefined
    },
    renderInkNode(tree, 'root')
  )
}

function openAlternateScreen(enabled: boolean): void {
  if (enabled && process.stdout.isTTY) {
    process.stdout.write(ENTER_ALT_SCREEN)
  }
}

function closeAlternateScreen(enabled: boolean): void {
  if (enabled && process.stdout.isTTY) {
    process.stdout.write(EXIT_ALT_SCREEN)
  }
}

function installAlternateScreenCleanup(enabled: boolean, onClose: () => void): () => void {
  if (!enabled) {
    return () => {}
  }

  const handleExit = () => onClose()
  process.once('SIGINT', handleExit)
  process.once('SIGTERM', handleExit)
  process.once('exit', handleExit)

  return () => {
    process.removeListener('SIGINT', handleExit)
    process.removeListener('SIGTERM', handleExit)
    process.removeListener('exit', handleExit)
  }
}

export async function runTuiApp(options: RunTuiAppOptions = {}): Promise<TuiAppSession> {
  if (options.viewModel) {
    return createSession(createTuiAppViewModel(options.viewModel), options.callbacks)
  }

  const terminal = detectTuiTerminalCapabilities()
  const useAlternateScreen = terminal.alternateScreen
  openAlternateScreen(useAlternateScreen)
  const removeCleanup = installAlternateScreenCleanup(useAlternateScreen, () => closeAlternateScreen(useAlternateScreen))

  let app
  try {
    app = render(React.createElement(InteractiveTuiApp, { cwd: options.cwd ?? process.cwd() }), {
      exitOnCtrlC: true,
      patchConsole: false
    })
  } catch (error) {
    removeCleanup()
    closeAlternateScreen(useAlternateScreen)
    throw error
  }

  const initialViewModel = await buildTuiAppViewModel({
    cwd: options.cwd ?? process.cwd(),
    session: createDefaultTuiSessionState(defaultComposerState()),
    liveEventsByRunId: {}
  })
  const session = createSession(initialViewModel, options.callbacks)

  session.dispose = () => {
    removeCleanup()
    closeAlternateScreen(useAlternateScreen)
    app.unmount()
  }
  session.waitUntilExit = async () => {
    try {
      await app.waitUntilExit()
    } finally {
      removeCleanup()
      closeAlternateScreen(useAlternateScreen)
    }
  }

  return session
}

export function createTuiAppSession(viewModel: TuiAppViewModel, callbacks?: TuiCallbacks): TuiAppSession {
  return createSession(viewModel, callbacks)
}
