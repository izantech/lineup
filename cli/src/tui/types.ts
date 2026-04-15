import type { HostName } from '../lib/constants.js'
import type { ArtifactKind } from '../lib/types.js'
import type { PipelineRunStatus } from '../lib/state.js'

export type TuiTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

export type TuiScreen = 'home' | 'compose' | 'live' | 'inspect' | 'help'
export type TuiModal = 'gate' | 'help'

export type TuiRoute = {
  screen: TuiScreen
  modal?: TuiModal | null
}

export type TuiTheme = {
  name: string
  compact: boolean
  palette: {
    background: string
    surface: string
    border: string
    text: string
    muted: string
    accent: string
    success: string
    warning: string
    danger: string
  }
}

export type TuiActionKind = 'primary' | 'secondary' | 'destructive' | 'ghost'

export type TuiSelectionState = {
  focused?: boolean
  selected?: boolean
  index?: number
  total?: number
}

export type TuiAction = {
  id: string
  label: string
  description?: string
  shortcut?: string
  kind?: TuiActionKind
  tone?: TuiTone
  disabled?: boolean
} & TuiSelectionState

export type TuiKeyBinding = {
  keys: readonly string[]
  label: string
  description?: string
}

export type TuiReadinessStatus = 'ready' | 'warning' | 'blocked'

export type TuiReadinessItem = {
  id: string
  label: string
  status: TuiReadinessStatus
  detail?: string
  action?: TuiAction
} & TuiSelectionState

export type TuiRunCard = {
  runId: string
  status: PipelineRunStatus | 'idle' | 'unknown'
  workflow?: string
  stage?: string
  summary?: string
  updatedAt?: string
  recoveryHint?: string
  recoveryAction?: 'answer' | 'resume' | 'inspect'
  recoveryCommand?: string
  expiresAt?: string
  artifactLabel?: string
  artifactSummary?: string
  relatedArtifactLabel?: string
  relatedArtifactSummary?: string
  actions?: readonly TuiAction[]
} & TuiSelectionState

export type TuiHomeViewModel = {
  title: string
  subtitle?: string
  repoPath?: string
  focusedSection?: 'readiness' | 'latestRun' | 'recentRuns' | 'quickActions' | 'notes'
  selectedReadinessId?: string
  selectedRunId?: string
  selectedActionId?: string
  readiness: readonly TuiReadinessItem[]
  latestRun: TuiRunCard | null
  recentRuns: readonly TuiRunCard[]
  quickActions: readonly TuiAction[]
  notes: readonly string[]
}

export type TuiComposerField = {
  id?: string
  label: string
  value: string
  hint?: string
  editable?: boolean
} & TuiSelectionState

export type TuiComposerViewModel = {
  title: string
  prompt: string
  focusedFieldId?: string
  selectedActionId?: string
  modeSummary?: string
  workflowOptions?: readonly string[]
  tacticOptions?: readonly string[]
  fields: readonly TuiComposerField[]
  validation: readonly string[]
  suggestedActions: readonly TuiAction[]
  help: readonly string[]
}

export type TuiStageStatus = 'pending' | 'running' | 'blocked' | 'done' | 'failed' | 'skipped'

export type TuiStageTimelineItem = {
  id: string
  label: string
  status: TuiStageStatus
  detail?: string
  startedAt?: string
  completedAt?: string
} & TuiSelectionState

export type TuiLogEntry = {
  id: string
  level: 'status' | 'info' | 'warning' | 'error'
  text: string
  timestamp?: string
} & TuiSelectionState

export type TuiTaskWaveItem = {
  id: string
  title: string
  status?: string
} & TuiSelectionState

export type TuiTaskWave = {
  id: string
  label: string
  detail?: string
  tasks: readonly TuiTaskWaveItem[]
} & TuiSelectionState

export type TuiVerificationSummary = {
  label: string
  status: 'pass' | 'fail' | 'pending' | 'skipped' | 'blocked'
  detail?: string
  actions?: readonly TuiAction[]
}

export type TuiArtifactCard = {
  kind: ArtifactKind | string
  label: string
  path?: string
  summary?: string
  hash?: string
  status?: 'present' | 'missing' | 'stale'
  relatedArtifactLabel?: string
  relatedArtifactSummary?: string
  contentLabel?: string
  contentSummary?: string
} & TuiSelectionState

export type TuiLiveRunViewModel = {
  title: string
  runId: string
  host?: HostName
  workflow?: string
  tactic?: string
  status: PipelineRunStatus | 'idle' | 'unknown'
  currentStage?: string
  modeSummary?: string
  approvalMode?: string
  focusedSection?: 'timeline' | 'statusStream' | 'taskWaves' | 'verification' | 'artifacts' | 'changes' | 'actions'
  selectedStageId?: string
  selectedLogId?: string
  selectedTaskWaveId?: string
  selectedArtifactKind?: string
  selectedActionId?: string
  stageTimeline: readonly TuiStageTimelineItem[]
  statusStream: readonly TuiLogEntry[]
  taskWaves: readonly TuiTaskWave[]
  verification: TuiVerificationSummary | null
  artifacts: readonly TuiArtifactCard[]
  nextActions: readonly TuiAction[]
  changedItems: readonly string[]
  lastUpdatedAt?: string
}

export type TuiGateChoice = {
  value: string
  label: string
  description?: string
  tone?: TuiTone
  isDefault?: boolean
} & TuiSelectionState

export type TuiGateViewModel = {
  title: string
  requestId: string | number
  gateType: string
  question: string
  context?: string
  statusLine?: string
  expiresAt?: string
  recoveryAction?: 'answer' | 'resume' | 'inspect'
  recoveryCommand?: string
  focusedChoiceIndex?: number
  selectedChoiceValue?: string
  freeTextValue?: string
  choices: readonly TuiGateChoice[]
  allowFreeText?: boolean
  freeTextLabel?: string
  artifactPreview: TuiArtifactCard | null
  help: readonly string[]
}

export type TuiInspectionPane =
  | 'summary'
  | 'artifacts'
  | 'content'
  | 'diff'
  | 'logs'
  | 'replay'
  | 'history'
  | 'actions'

export type TuiArtifactContent = {
  title: string
  kind: string
  language?: string
  path?: string
  lines: readonly string[]
  summary?: string
}

export type TuiLogDetail = {
  id: string
  label: string
  lines: readonly string[]
  tone?: TuiTone
  focused?: boolean
  selected?: boolean
}

export type TuiReplayEntry = {
  id: string
  timestamp?: string
  label: string
  detail?: string
  focused?: boolean
  selected?: boolean
}

export type TuiHistoryEntry = {
  runId: string
  status: PipelineRunStatus | 'idle' | 'unknown'
  workflow?: string
  currentStage?: string
  startedAt?: string
  finishedAt?: string
  duration?: string
  retryCount?: number
  focused?: boolean
  selected?: boolean
}

export type TuiRecoverySummary = {
  action: 'answer' | 'resume' | 'inspect'
  message: string
  command?: string
}

export type TuiInspectionSection = {
  title: string
  tone?: TuiTone
  body: readonly string[]
  actions?: readonly TuiAction[]
  focused?: boolean
  selected?: boolean
}

export type TuiDiffEntry = {
  kind: string
  fromRunId?: string
  toRunId?: string
  summary: string
  status?: TuiTone
  action?: TuiAction
  focused?: boolean
  selected?: boolean
}

export type TuiInspectionViewModel = {
  title: string
  runId: string
  status: PipelineRunStatus | 'idle' | 'unknown'
  summary?: string
  activePane?: TuiInspectionPane
  focusedSection?: 'summary' | 'actions' | 'artifacts' | 'diffs' | 'recentRuns'
  selectedRunId?: string
  selectedArtifactKind?: string
  selectedDiffKind?: string
  selectedActionId?: string
  sections: readonly TuiInspectionSection[]
  artifacts: readonly TuiArtifactCard[]
  artifactContent?: TuiArtifactContent | null
  diffs: readonly TuiDiffEntry[]
  logs?: readonly TuiLogDetail[]
  replay?: readonly TuiReplayEntry[]
  history?: readonly TuiHistoryEntry[]
  recovery?: TuiRecoverySummary | null
  recentRuns: readonly TuiRunCard[]
  actions: readonly TuiAction[]
}

export type TuiPaletteCommand = {
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
  slashCommand?: string
  tone?: TuiTone
  disabled?: boolean
  focused?: boolean
  selected?: boolean
  index?: number
  total?: number
}

export type TuiPaletteSection = {
  title: string
  commands: readonly TuiPaletteCommand[]
}

export type TuiHelpPaletteViewModel = {
  title: string
  query: string
  placeholder?: string
  focusedSection?: 'query' | 'sections' | 'commands' | 'keyBindings' | 'slashCommands' | 'recentCommands'
  selectedCommandId?: string
  selectedSectionTitle?: string
  selectedKeyBindingIndex?: number
  sections: readonly TuiPaletteSection[]
  commands: readonly TuiPaletteCommand[]
  keyBindings: readonly TuiKeyBinding[]
  slashCommands: readonly TuiPaletteCommand[]
  recentCommands: readonly TuiPaletteCommand[]
}

export type TuiInputViewModel = {
  title: string
  label: string
  value: string
  placeholder: string
  context?: string
  hint?: string
  visible?: boolean
}

export type TuiChromeViewModel = {
  title: string
  subtitle?: string
  modeSummary?: string
  focusSummary?: string
  selectionSummary?: string
  inputLabel?: string
  inputValue?: string
  inputHint?: string
  inputPlaceholder?: string
  runId?: string
  status?: PipelineRunStatus | 'idle' | 'unknown'
  routeLabel?: string
  hints: readonly string[]
}

export type TuiAppViewModel = {
  route: TuiRoute
  theme: TuiTheme
  chrome: TuiChromeViewModel
  home: TuiHomeViewModel
  composer: TuiComposerViewModel
  liveRun: TuiLiveRunViewModel
  gate: TuiGateViewModel
  inspection: TuiInspectionViewModel
  help: TuiHelpPaletteViewModel
  input: TuiInputViewModel
}

export type TuiCallbacks = {
  onAction?: (action: TuiAction) => void | Promise<void>
  onSelectRun?: (runId: string) => void | Promise<void>
  onSubmitPrompt?: (prompt: string) => void | Promise<void>
  onChooseGate?: (choice: TuiGateChoice | { value: string; reason?: string }) => void | Promise<void>
  onCommand?: (command: TuiPaletteCommand) => void | Promise<void>
  onDismiss?: () => void | Promise<void>
}

const defaultTheme: TuiTheme = {
  name: 'default',
  compact: false,
  palette: {
    background: '#0b0f17',
    surface: '#121826',
    border: '#2a3346',
    text: '#edf2ff',
    muted: '#8b95ad',
    accent: '#7dd3fc',
    success: '#86efac',
    warning: '#fbbf24',
    danger: '#fca5a5'
  }
}

const defaultChrome: TuiChromeViewModel = {
  title: 'Lineup',
  hints: ['Enter submit', 'Esc clear'],
  routeLabel: 'Home'
}

export function createTuiAction(input: Partial<TuiAction> & Pick<TuiAction, 'id' | 'label'>): TuiAction {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    shortcut: input.shortcut,
    kind: input.kind ?? 'secondary',
    tone: input.tone ?? 'neutral',
    disabled: input.disabled ?? false
  }
}

export function createTuiHomeViewModel(input: Partial<TuiHomeViewModel> = {}): TuiHomeViewModel {
  return {
    title: input.title ?? 'Home',
    subtitle: input.subtitle,
    repoPath: input.repoPath,
    focusedSection: input.focusedSection,
    selectedReadinessId: input.selectedReadinessId,
    selectedRunId: input.selectedRunId,
    selectedActionId: input.selectedActionId,
    readiness: input.readiness ?? [],
    latestRun: input.latestRun ?? null,
    recentRuns: input.recentRuns ?? [],
    quickActions: input.quickActions ?? [],
    notes: input.notes ?? []
  }
}

export function createTuiComposerViewModel(input: Partial<TuiComposerViewModel> = {}): TuiComposerViewModel {
  return {
    title: input.title ?? 'Compose run',
    prompt: input.prompt ?? '',
    focusedFieldId: input.focusedFieldId,
    selectedActionId: input.selectedActionId,
    modeSummary: input.modeSummary,
    workflowOptions: input.workflowOptions ?? [],
    tacticOptions: input.tacticOptions ?? [],
    fields: input.fields ?? [],
    validation: input.validation ?? [],
    suggestedActions: input.suggestedActions ?? [],
    help: input.help ?? []
  }
}

export function createTuiLiveRunViewModel(input: Partial<TuiLiveRunViewModel> & Pick<TuiLiveRunViewModel, 'runId'>): TuiLiveRunViewModel {
  return {
    title: input.title ?? 'Live run',
    runId: input.runId,
    host: input.host,
    workflow: input.workflow,
    tactic: input.tactic,
    status: input.status ?? 'idle',
    currentStage: input.currentStage,
    modeSummary: input.modeSummary,
    approvalMode: input.approvalMode,
    focusedSection: input.focusedSection,
    selectedStageId: input.selectedStageId,
    selectedLogId: input.selectedLogId,
    selectedTaskWaveId: input.selectedTaskWaveId,
    selectedArtifactKind: input.selectedArtifactKind,
    selectedActionId: input.selectedActionId,
    stageTimeline: input.stageTimeline ?? [],
    statusStream: input.statusStream ?? [],
    taskWaves: input.taskWaves ?? [],
    verification: input.verification ?? null,
    artifacts: input.artifacts ?? [],
    nextActions: input.nextActions ?? [],
    changedItems: input.changedItems ?? [],
    lastUpdatedAt: input.lastUpdatedAt
  }
}

export function createTuiGateViewModel(input: Partial<TuiGateViewModel> & Pick<TuiGateViewModel, 'requestId' | 'gateType' | 'question'>): TuiGateViewModel {
  return {
    title: input.title ?? 'Gate',
    requestId: input.requestId,
    gateType: input.gateType,
    question: input.question,
    context: input.context,
    statusLine: input.statusLine,
    expiresAt: input.expiresAt,
    recoveryAction: input.recoveryAction,
    recoveryCommand: input.recoveryCommand,
    focusedChoiceIndex: input.focusedChoiceIndex,
    selectedChoiceValue: input.selectedChoiceValue,
    freeTextValue: input.freeTextValue,
    choices: input.choices ?? [],
    allowFreeText: input.allowFreeText ?? false,
    freeTextLabel: input.freeTextLabel,
    artifactPreview: input.artifactPreview ?? null,
    help: input.help ?? []
  }
}

export function createTuiInspectionViewModel(input: Partial<TuiInspectionViewModel> & Pick<TuiInspectionViewModel, 'runId'>): TuiInspectionViewModel {
  return {
    title: input.title ?? 'Inspect run',
    runId: input.runId,
    status: input.status ?? 'idle',
    summary: input.summary,
    activePane: input.activePane ?? 'summary',
    focusedSection: input.focusedSection,
    selectedRunId: input.selectedRunId,
    selectedArtifactKind: input.selectedArtifactKind,
    selectedDiffKind: input.selectedDiffKind,
    selectedActionId: input.selectedActionId,
    sections: input.sections ?? [],
    artifacts: input.artifacts ?? [],
    artifactContent: input.artifactContent ?? null,
    diffs: input.diffs ?? [],
    logs: input.logs ?? [],
    replay: input.replay ?? [],
    history: input.history ?? [],
    recovery: input.recovery ?? null,
    recentRuns: input.recentRuns ?? [],
    actions: input.actions ?? []
  }
}

export function createTuiHelpPaletteViewModel(input: Partial<TuiHelpPaletteViewModel> = {}): TuiHelpPaletteViewModel {
  return {
    title: input.title ?? 'Command palette',
    query: input.query ?? '',
    placeholder: input.placeholder ?? 'Search commands or type /run ...',
    focusedSection: input.focusedSection,
    selectedCommandId: input.selectedCommandId,
    selectedSectionTitle: input.selectedSectionTitle,
    selectedKeyBindingIndex: input.selectedKeyBindingIndex,
    sections: input.sections ?? [],
    commands: input.commands ?? [],
    keyBindings: input.keyBindings ?? [],
    slashCommands: input.slashCommands ?? [],
    recentCommands: input.recentCommands ?? []
  }
}

export function createTuiInputViewModel(input: Partial<TuiInputViewModel> = {}): TuiInputViewModel {
  return {
    title: input.title ?? 'Input',
    label: input.label ?? 'Message',
    value: input.value ?? '',
    placeholder: input.placeholder ?? 'Type the task you want Lineup to run.',
    context: input.context,
    hint: input.hint ?? 'The input panel is the only editable area.',
    visible: input.visible ?? true
  }
}

export function createTuiAppViewModel(input: Partial<TuiAppViewModel> = {}): TuiAppViewModel {
  const route = input.route ?? { screen: 'home' }
  const derivedInput = createTuiInputViewModel({
    label: input.input?.label ?? input.chrome?.inputLabel ?? 'Message',
    value: input.input?.value ?? input.chrome?.inputValue ?? input.composer?.prompt ?? '',
    placeholder: input.input?.placeholder ?? input.chrome?.inputPlaceholder ?? 'Type the task you want Lineup to run.',
    context:
      input.input?.context ??
      input.chrome?.subtitle ??
      input.home?.repoPath ??
      input.chrome?.modeSummary ??
      input.chrome?.selectionSummary,
    hint:
      input.input?.hint ??
      input.chrome?.inputHint ??
      (route.screen === 'compose'
        ? 'Type the task here, then press Enter to start.'
        : 'The main panel is read-only; task input lives here.')
  })

  return {
    route,
    theme: input.theme ?? defaultTheme,
    chrome: input.chrome ?? defaultChrome,
    home: input.home ?? createTuiHomeViewModel(),
    composer: input.composer ?? createTuiComposerViewModel(),
    liveRun: input.liveRun ?? createTuiLiveRunViewModel({ runId: 'unknown' }),
    gate: input.gate ?? createTuiGateViewModel({
      requestId: 'pending',
      gateType: 'custom',
      question: 'Awaiting gate request'
    }),
    inspection: input.inspection ?? createTuiInspectionViewModel({ runId: 'unknown' }),
    help: input.help ?? createTuiHelpPaletteViewModel(),
    input: input.input ? { ...derivedInput, ...input.input } : derivedInput
  }
}
