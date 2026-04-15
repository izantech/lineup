import type { PendingGate } from "./gate-store.js";
import {
  buildCommandPaletteItems,
  buildHomeViewModel,
  buildInspectionViewModel,
  buildLiveRunViewModel,
  buildRunComposerViewModel,
  loadTuiPreferences,
  type TuiAction as StateAction,
  type TuiHomeViewModel as StateHomeViewModel,
  type TuiInspectionViewModel as StateInspectionViewModel,
  type TuiLiveRunViewModel as StateLiveRunViewModel,
  type TuiLogEvent as StateLogEvent
} from "./tui-models.js";
import {
  listTacticEntries,
  listWorkflowEntries,
  readArtifactContent,
  readBridgeRecovery,
  readRunHistory,
  readRunLogs,
  readRunReplay
} from "./tui-services.js";
import { COMPOSER_FIELD_COUNT, type TuiComposerState, type TuiRuntimeRoute, type TuiSessionState } from "../tui/controller.js";
import {
  createTuiAction,
  createTuiAppViewModel,
  type TuiAction,
  type TuiAppViewModel,
  type TuiArtifactCard,
  type TuiGateChoice,
  type TuiPaletteCommand,
  type TuiReadinessItem,
  type TuiRunCard,
  type TuiStageStatus,
  type TuiTheme
} from "../tui/types.js";

export type TuiAppStateInput = {
  cwd: string;
  session: TuiSessionState;
  liveEventsByRunId: Record<string, StateLogEvent[]>;
};

const INSPECTABLE_ARTIFACT_KINDS = new Set(["plan", "tasks", "review", "protocol", "pipeline-state"]);

function summarizeTextContent(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

function mapAction(
  action: StateAction,
  selection: Partial<Pick<TuiAction, "focused" | "selected" | "index" | "total">> = {}
): TuiAction {
  return createTuiAction({
    id: action.id,
    label: action.label,
    description: action.command,
    kind:
      action.intent === "danger"
        ? "destructive"
        : action.intent === "primary"
          ? "primary"
          : "secondary",
    shortcut: undefined,
    disabled: action.disabled ?? false,
    ...selection
  });
}

function mapReadinessItem(item: StateHomeViewModel["readiness"]["cards"][number]): TuiReadinessItem {
  return {
    id: item.id,
    label: item.label,
    status: item.tone === "danger" ? "blocked" : item.tone === "warning" ? "warning" : "ready",
    detail: item.detail
  };
}

function mapRunCard(
  run: StateHomeViewModel["recentRuns"][number],
  selection: Partial<Pick<TuiRunCard, "focused" | "selected" | "index" | "total">> = {}
): TuiRunCard {
  return {
    runId: run.runId,
    status: run.status as TuiRunCard["status"],
    workflow: run.workflow,
    stage: run.currentStage,
    summary: run.taskSummary ?? run.nextAction,
    updatedAt: run.updatedAt,
    ...selection
  };
}

function mapStageStatus(status: string): TuiStageStatus {
  switch (status) {
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "succeeded":
    case "complete":
      return "done";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function mapLogLevel(kind: StateLogEvent["kind"]): "status" | "info" | "warning" | "error" {
  switch (kind) {
    case "complete":
      return "info";
    case "question":
      return "warning";
    default:
      return "status";
  }
}

function buildVerificationSummary(status: StateLiveRunViewModel["status"]) {
  if (status === "failed") {
    return {
      label: "Review",
      status: "fail" as const,
      detail: "Run failed. Inspect logs or retry the failed stage."
    };
  }

  if (status === "blocked") {
    return {
      label: "Review",
      status: "blocked" as const,
      detail: "Run is waiting on a gate or resume action."
    };
  }

  if (status === "succeeded") {
    return {
      label: "Review",
      status: "pass" as const,
      detail: "Run completed successfully."
    };
  }

  return null;
}

function mapArtifactLine(line: string): TuiArtifactCard {
  const [label, rest] = line.split(":", 2);
  return {
    kind: label.trim(),
    label: label.trim(),
    summary: rest?.trim()
  };
}

function mapInspectionArtifacts(model: StateInspectionViewModel["run"]["artifacts"]): TuiArtifactCard[] {
  return model.map((line) => mapArtifactLine(line));
}

function buildTheme(compact: boolean): TuiTheme {
  return {
    name: compact ? "lineup-compact" : "lineup",
    compact,
    palette: {
      background: "#0b0f17",
      surface: "#121826",
      border: "#2a3346",
      text: "#edf2ff",
      muted: "#8b95ad",
      accent: "#7dd3fc",
      success: "#86efac",
      warning: "#fbbf24",
      danger: "#fca5a5"
    }
  };
}

function buildGateChoices(gate: PendingGate | null | undefined): TuiGateChoice[] {
  if (!gate) {
    return [];
  }

  return gate.choices.map((choice, index) => ({
    value: choice,
    label: `${index + 1}. ${choice}`,
    isDefault: choice === gate.defaultChoice,
    tone: choice === "abort" || choice === "reject" ? "danger" : choice === "accept" ? "warning" : "accent"
  }));
}

function buildPaletteCommands(query: string | undefined, recentCommandIds: string[] = []): TuiPaletteCommand[] {
  const preferences = loadTuiPreferences();
  const items = buildCommandPaletteItems(preferences);
  const filtered = query
    ? items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()) || item.description.toLowerCase().includes(query.toLowerCase()))
    : items;
  const recent = new Set(recentCommandIds)
  const ordered = [...filtered].sort((left, right) => {
    const recentDelta = Number(recent.has(right.id)) - Number(recent.has(left.id))
    if (recentDelta !== 0) {
      return recentDelta
    }
    return left.label.localeCompare(right.label)
  })

  return ordered.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    shortcut: item.shortcut,
    category: item.group
  }));
}

function buildComposerHelp(composer: TuiComposerState): string[] {
  return [
    "Type to edit the prompt.",
    "Enter starts a run.",
    "Tab cycles configuration values.",
    "Left and right arrows adjust the focused composer field.",
    "Workflow and tactic are mutually exclusive.",
    `Current host: ${composer.host}`,
    composer.workflow ? `Workflow: ${composer.workflow}` : "Workflow: default",
    composer.tactic ? `Tactic: ${composer.tactic}` : "Tactic: none"
  ];
}

function buildInputLabel(session: TuiSessionState): string {
  return session.pendingGate ? "Gate response" : "Task prompt"
}

function buildInputValue(session: TuiSessionState): string {
  return session.pendingGate ? session.gateInput : session.composer.prompt
}

function buildInputHint(session: TuiSessionState): string {
  if (session.pendingGate) {
    if (session.pendingGate.choices.length > 0 && !session.pendingGate.allowFreeText) {
      return "Use the arrow keys to select a choice. Press Enter to submit it."
    }

    return session.pendingGate.allowFreeText
      ? "Type a response for the pending gate. Enter submits it."
      : "Type a gate choice and press Enter to submit it."
  }

  return "Type the task you want Lineup to run. Enter starts the pipeline."
}

function showInputPanel(session: TuiSessionState, runStatus?: string): boolean {
  if (session.pendingGate) {
    return session.pendingGate.allowFreeText || session.pendingGate.choices.length === 0
  }

  if (runStatus === "running" || runStatus === "blocked" || runStatus === "pending") {
    return false
  }

  return !session.busy
}

function mapHomeView(home: StateHomeViewModel) {
  return {
    title: "Home",
    subtitle: home.readiness.summary,
    repoPath: home.cwd,
    readiness: home.readiness.cards.map(mapReadinessItem),
    latestRun: home.latestRun ? mapRunCard(home.latestRun) : null,
    recentRuns: home.recentRuns.map((run) => mapRunCard(run)),
    quickActions: home.quickActions.map((action) => mapAction(action)),
    notes: [
      ...home.hosts.map((host) => `${host.label}: ${host.detail}`),
      ...home.readiness.actions.map((action) => `${action.label}: ${action.command ?? "interactive action"}`)
    ]
  };
}

function mapHomeViewWithState(home: StateHomeViewModel, session: TuiSessionState) {
  const selectedRunId = home.recentRuns[session.homeRunIndex]?.runId ?? home.latestRun?.runId
  const selectedActionId = home.quickActions[session.homeActionIndex]?.id
  return {
    title: "Home",
    subtitle: home.readiness.summary,
    repoPath: home.cwd,
    focusedSection: session.homeFocus === "recentRuns" ? "recentRuns" as const : "quickActions" as const,
    selectedRunId,
    selectedActionId: session.homeFocus === "quickActions" ? selectedActionId : undefined,
    readiness: home.readiness.cards.map(mapReadinessItem),
    latestRun: home.latestRun
      ? mapRunCard(home.latestRun, {
          selected: home.latestRun.runId === selectedRunId,
          focused: session.homeFocus === "recentRuns" && home.latestRun.runId === selectedRunId
        })
      : null,
    recentRuns: home.recentRuns.map((run, index) =>
      mapRunCard(run, {
        selected: run.runId === selectedRunId,
        focused: session.homeFocus === "recentRuns" && index === session.homeRunIndex,
        index,
        total: home.recentRuns.length
      })
    ),
    quickActions: home.quickActions.map((action, index) =>
      mapAction(action, {
        selected: session.homeFocus === "quickActions" && index === session.homeActionIndex,
        focused: session.homeFocus === "quickActions" && index === session.homeActionIndex,
        index,
        total: home.quickActions.length
      })
    ),
    notes: [
      ...home.hosts.map((host) => `${host.label}: ${host.detail}`),
      ...home.readiness.actions.map((action) => `${action.label}: ${action.command ?? "interactive action"}`)
    ]
  };
}

function mapLiveRunView(model: StateLiveRunViewModel | null, composer: TuiComposerState, liveEvents: StateLogEvent[]) {
  if (!model) {
    return {
      title: "Live run",
      runId: "pending",
      host: composer.host,
      workflow: undefined,
      tactic: undefined,
      status: "idle" as const,
      currentStage: undefined,
      modeSummary: `host ${composer.host} · isolation ${composer.isolation} · implement ${composer.implementMethod}`,
      approvalMode: composer.approvePlan ? "auto-approve plan" : "manual plan approval",
      stageTimeline: [],
      statusStream: [],
      taskWaves: [],
      verification: null,
      artifacts: [],
      nextActions: [],
      changedItems: [],
      lastUpdatedAt: undefined
    };
  }

  return {
    title: "Live run",
    runId: model.runId,
    host: composer.host,
    workflow: model.workflow,
    tactic: undefined,
    status: model.status as "pending" | "running" | "blocked" | "succeeded" | "failed" | "canceled" | "idle" | "unknown",
    currentStage: model.currentStage,
    modeSummary: `host ${composer.host} · isolation ${composer.isolation} · implement ${composer.implementMethod}`,
    approvalMode: composer.approvePlan ? "auto-approve plan" : "manual plan approval",
    stageTimeline: model.timelineStages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      status: mapStageStatus(stage.status)
    })),
    statusStream: liveEvents.map((event) => ({
      id: event.id,
      level: mapLogLevel(event.kind),
      text: event.text
    })),
    taskWaves: model.taskSummary.map((line, index) => ({
      id: `wave-${index}`,
      label: `Wave ${index + 1}`,
      detail: line,
      tasks: [{ id: `task-${index}`, title: line }]
    })),
    verification: model.verificationSummary
      ? {
          label: "Verification",
          status: (
            model.status === "failed"
              ? "fail"
              : model.status === "blocked"
                ? "blocked"
                : model.status === "succeeded"
                  ? "pass"
                  : "pending"
          ) as "fail" | "blocked" | "pass" | "pending",
          detail: model.verificationSummary
        }
      : buildVerificationSummary(model.status),
    artifacts: model.artifacts.map(mapArtifactLine),
    nextActions: model.nextActions.map((action) => mapAction(action)),
    changedItems: model.whatChanged,
    lastUpdatedAt: model.lastUpdatedAt
  };
}

function mapLiveRunViewWithState(
  model: StateLiveRunViewModel | null,
  composer: TuiComposerState,
  liveEvents: StateLogEvent[],
  session: TuiSessionState
) {
  const base = mapLiveRunView(model, composer, liveEvents)
  return {
    ...base,
    focusedSection:
      session.liveFocus === "nextActions"
        ? "actions" as const
        : session.liveFocus === "logs"
          ? "statusStream" as const
          : session.liveFocus === "timeline"
            ? "timeline" as const
            : session.liveFocus === "artifacts"
              ? "artifacts" as const
              : "taskWaves" as const,
    selectedStageId: base.stageTimeline[session.liveTimelineIndex]?.id,
    selectedLogId: session.showLogs ? base.statusStream[session.liveLogIndex]?.id : undefined,
    selectedArtifactKind: base.artifacts[session.liveArtifactIndex]?.kind,
    selectedActionId: base.nextActions[session.liveActionIndex]?.id,
    stageTimeline: base.stageTimeline.map((stage, index) => ({
      ...stage,
      focused: session.liveFocus === "timeline" && index === session.liveTimelineIndex,
      selected: index === session.liveTimelineIndex,
      index,
      total: base.stageTimeline.length
    })),
    statusStream: (session.showLogs
      ? base.statusStream
      : [{ id: "logs-hidden", level: "info" as const, text: "Logs hidden. Press the logs key to show details." }]).map((entry, index, all) => ({
      ...entry,
      focused: session.liveFocus === "logs" && index === session.liveLogIndex,
      selected: index === session.liveLogIndex,
      index,
      total: all.length
    })),
    artifacts: base.artifacts.map((artifact, index) => ({
      ...artifact,
      focused: session.liveFocus === "artifacts" && index === session.liveArtifactIndex,
      selected: index === session.liveArtifactIndex,
      index,
      total: base.artifacts.length
    })),
    nextActions: base.nextActions.map((action, index) => ({
      ...action,
      focused: session.liveFocus === "nextActions" && index === session.liveActionIndex,
      selected: index === session.liveActionIndex,
      index,
      total: base.nextActions.length
    }))
  }
}

function mapInspectionView(model: StateInspectionViewModel | null) {
  if (!model) {
    return {
      title: "Inspect run",
      runId: "unknown",
      status: "idle" as const,
      summary: "No run selected.",
      sections: [],
      artifacts: [],
      diffs: [],
      recentRuns: [],
      actions: []
    };
  }

  return {
    title: "Inspect run",
    runId: model.run.runId,
    status: model.run.status as "pending" | "running" | "blocked" | "succeeded" | "failed" | "canceled" | "idle" | "unknown",
    summary: `${model.run.workflow} · ${model.run.currentStage}`,
    sections: [
      { title: "Timing", body: model.run.timing },
      { title: "What changed", body: model.run.whatChanged },
      { title: "Next", body: model.run.nextActions.map((action) => action.command ?? action.label) },
      ...(model.bridge
        ? [{
            title: "Bridge recovery",
            body: [
              `executor: ${model.bridge.executorHost}`,
              `status: ${model.bridge.status}`,
              `recover with: ${model.bridge.recoveryCommand}`
            ]
          }]
        : [])
    ],
    artifacts: mapInspectionArtifacts(model.run.artifacts),
    diffs: model.diffs.map((diff) => ({
      kind: diff.kind,
      fromRunId: diff.fromRunId,
      toRunId: diff.toRunId,
      summary: diff.summary,
      action: createTuiAction({
        id: `diff-${diff.kind}`,
        label: "Diff artifact",
        description: diff.command,
        kind: "secondary"
      })
    })),
    recentRuns: model.recentRuns.map((run) => mapRunCard(run)),
    actions: model.run.nextActions.map((action) => mapAction(action))
  };
}

function mapInspectionViewWithState(model: StateInspectionViewModel | null, session: TuiSessionState) {
  const base = mapInspectionView(model)
  return {
    ...base,
    activePane: session.inspectPane,
    focusedSection:
      session.inspectFocus === "sections"
        ? "summary" as const
        : session.inspectFocus === "actions"
          ? "actions" as const
          : session.inspectFocus === "artifacts"
            ? "artifacts" as const
            : session.inspectFocus === "diffs"
              ? "diffs" as const
              : "recentRuns" as const,
    selectedRunId: base.recentRuns[session.inspectRecentRunIndex]?.runId,
    selectedArtifactKind: String(base.artifacts[session.inspectArtifactIndex]?.kind ?? ""),
    selectedDiffKind: base.diffs[session.inspectDiffIndex]?.kind,
    selectedActionId: base.actions[session.inspectActionIndex]?.id,
    sections: base.sections.map((section, index) => ({
      ...section,
      focused: session.inspectFocus === "sections" && index === session.inspectSectionIndex,
      selected: index === session.inspectSectionIndex
    })),
    artifacts: base.artifacts.map((artifact, index) => ({
      ...artifact,
      focused: session.inspectFocus === "artifacts" && index === session.inspectArtifactIndex,
      selected: index === session.inspectArtifactIndex,
      index,
      total: base.artifacts.length
    })),
    diffs: base.diffs.map((diff, index) => ({
      ...diff,
      focused: session.inspectFocus === "diffs" && index === session.inspectDiffIndex,
      selected: index === session.inspectDiffIndex
    })),
    recentRuns: base.recentRuns.map((run, index) => ({
      ...run,
      focused: session.inspectFocus === "recentRuns" && index === session.inspectRecentRunIndex,
      selected: index === session.inspectRecentRunIndex,
      index,
      total: base.recentRuns.length
    })),
    actions: base.actions.map((action, index) => ({
      ...action,
      focused: session.inspectFocus === "actions" && index === session.inspectActionIndex,
      selected: index === session.inspectActionIndex,
      index,
      total: base.actions.length
    }))
  }
}

export async function buildTuiAppViewModel(input: TuiAppStateInput): Promise<TuiAppViewModel> {
  const preferences = loadTuiPreferences();
  const home = await buildHomeViewModel(input.cwd);
  const selectedRunId = input.session.selectedRunId ?? home.latestRun?.runId;
  const inspection = selectedRunId ? await buildInspectionViewModel(selectedRunId, input.cwd) : null;
  const liveEvents = selectedRunId ? input.liveEventsByRunId[selectedRunId] ?? [] : [];
  const liveRun = selectedRunId ? buildLiveRunViewModel(selectedRunId, liveEvents, input.cwd) : null;
  const composerDefaults = buildRunComposerViewModel();
  const workflowOptions = listWorkflowEntries(input.cwd).map((entry) => entry.file)
  const tacticOptions = listTacticEntries(input.cwd, true).map((entry) => entry.name)
  const paletteCommands = buildPaletteCommands(input.session.helpQuery, input.session.recentCommandIds);
  const paletteGroups = [...new Set(paletteCommands.map((command) => command.category ?? "Actions"))];
  const homeView = mapHomeViewWithState(home, input.session)
  const inspectionView = mapInspectionViewWithState(inspection, input.session)
  const selectedArtifactKind = inspectionView.selectedArtifactKind
  const artifactContent =
    selectedRunId && selectedArtifactKind && INSPECTABLE_ARTIFACT_KINDS.has(selectedArtifactKind)
      ? (() => {
          try {
            const artifact = readArtifactContent(selectedArtifactKind, selectedRunId, input.cwd)
            return {
              title: `${artifact.kind} content`,
              kind: artifact.kind,
              path: artifact.path,
              summary: summarizeTextContent(artifact.content),
              lines: artifact.content.split(/\r?\n/)
            }
          } catch {
            return null
          }
        })()
      : null
  const logDetails =
    selectedRunId
      ? (() => {
          try {
            return readRunLogs(selectedRunId, input.cwd).entries.slice(0, 20).map((entry, index) => ({
              id: `log-${index}`,
              label: `Log entry ${index + 1}`,
              lines: JSON.stringify(entry, null, 2).split(/\r?\n/),
              selected: index === 0
            }))
          } catch {
            return []
          }
        })()
      : []
  const replayEntries =
    selectedRunId
      ? (() => {
          try {
            return readRunReplay(selectedRunId, input.cwd).map((entry, index) => ({
              id: `replay-${index}`,
              label: entry.label,
              detail: `offset ${entry.offsetMs}ms`,
              selected: index === 0
            }))
          } catch {
            return []
          }
        })()
      : []
  const historyEntries = readRunHistory({ limit: 10 }, input.cwd).map((entry, index) => ({
    runId: entry.run_id,
    status: entry.status as "pending" | "running" | "blocked" | "succeeded" | "failed" | "canceled" | "idle" | "unknown",
    workflow: entry.workflow ?? undefined,
    currentStage: entry.current_stage ?? undefined,
    startedAt: entry.started_at ?? undefined,
    finishedAt: entry.finished_at ?? undefined,
    duration: entry.duration_human ?? undefined,
    retryCount: entry.retry_count,
    selected: index === 0
  }))
  const bridgeRecovery = selectedRunId ? await readBridgeRecovery(selectedRunId, input.cwd) : { session: null, events: null, recovery: null }
  const recoverySummary = bridgeRecovery.recovery
    ? {
        action: bridgeRecovery.recovery.action,
        message: bridgeRecovery.recovery.message,
        command: bridgeRecovery.recovery.command
      }
    : null
  const latestRunExtras =
    home.latestRun && home.latestRun.runId === selectedRunId
      ? {
          recoveryAction: bridgeRecovery.recovery?.action,
          recoveryCommand: bridgeRecovery.recovery?.command,
          expiresAt: bridgeRecovery.session?.pending_question?.expiresAt,
          artifactLabel: artifactContent?.title,
          artifactSummary: artifactContent?.summary,
          actions: inspectionView.actions
        }
      : {}
  const selectedReadinessId =
    homeView.readiness.find((item) => item.status !== "ready")?.id ?? homeView.readiness[0]?.id

  return createTuiAppViewModel({
    route: input.session.route,
    theme: buildTheme(preferences.compact),
    chrome: {
      title: "Lineup",
      subtitle: input.session.statusLine ?? home.readiness.summary,
      modeSummary: `interactive · ${input.session.composer.host} · ${input.session.busy ? "busy" : "ready"}`,
      focusSummary:
        input.session.route.modal === "help"
          ? `palette · ${input.session.helpQuery || "all commands"}`
          : input.session.route.modal === "gate"
            ? `gate · choice ${input.session.gateSelectionIndex + 1}`
            : input.session.route.screen === "home"
              ? `home · ${input.session.homeFocus}`
              : input.session.route.screen === "compose"
                ? `compose · ${input.session.composerFocus}`
                : input.session.route.screen === "live"
                  ? `live · ${input.session.liveFocus}`
                  : `inspect · ${input.session.inspectFocus}`,
      selectionSummary: selectedRunId ? `selected run ${selectedRunId}` : undefined,
      inputLabel: buildInputLabel(input.session),
      inputValue: buildInputValue(input.session),
      inputHint: buildInputHint(input.session),
      inputPlaceholder: input.session.pendingGate
        ? "Respond to the pending gate"
        : "Describe the task you want Lineup to make progress on",
      runId: input.session.attachedRunId ?? selectedRunId,
      status: liveRun?.status as TuiAppViewModel["chrome"]["status"],
      routeLabel: input.session.route.screen,
      hints: [
        `${preferences.keybindings.commandPalette} palette`,
        `${preferences.keybindings.resume} resume`,
        `${preferences.keybindings.artifacts} inspect`,
        `${preferences.keybindings.logs} logs`,
        `${preferences.keybindings.quit} quit`
      ]
    },
    input: {
      title: "Input",
      label: buildInputLabel(input.session),
      value: buildInputValue(input.session),
      placeholder: input.session.pendingGate
        ? "Respond to the pending gate"
        : "Describe the task you want Lineup to make progress on",
      context: input.session.pendingGate
        ? input.session.pendingGate.question
        : selectedRunId
          ? `Current run ${selectedRunId}`
          : home.cwd,
      hint: buildInputHint(input.session),
      visible: showInputPanel(input.session, liveRun?.status)
    },
    home: {
      ...homeView,
      selectedReadinessId,
      latestRun: homeView.latestRun ? { ...homeView.latestRun, ...latestRunExtras } : null
    },
    composer: {
      title: "Compose run",
      prompt: input.session.composer.prompt,
      focusedFieldId:
        input.session.composerFocus === "actions"
          ? undefined
          : input.session.composerFocus === "prompt"
            ? "prompt"
            : [
                "prompt",
                "host",
                "workflow",
                "tactic",
                "isolation",
                "implementMethod",
                "fromStage",
                "timeout",
                "gateTimeout",
                "dryRun",
                "forceRerun",
                "approvePlan",
                "maxParallel"
              ][input.session.composerFieldIndex],
      selectedActionId: input.session.composerFocus === "actions"
        ? ["start-run", "back-home"][input.session.composerActionIndex]
        : undefined,
      modeSummary: `host ${input.session.composer.host} · isolation ${input.session.composer.isolation} · implement ${input.session.composer.implementMethod}`,
      workflowOptions,
      tacticOptions,
      fields: [
        {
          id: "prompt",
          label: "Prompt",
          value: input.session.composer.prompt || "Describe the change you want Lineup to make.",
          hint: "Type directly to edit the prompt.",
          editable: true,
          focused: input.session.composerFocus === "prompt",
          selected: input.session.composerFocus === "prompt",
          index: 0,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "host",
          label: "Host",
          value: input.session.composer.host,
          hint: `available: ${composerDefaults.hosts.join(", ")}`,
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 1,
          selected: input.session.composerFieldIndex === 1,
          index: 1,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "workflow",
          label: "Workflow",
          value: input.session.composer.workflow ?? "default",
          hint: workflowOptions.length > 0 ? `available: ${workflowOptions.join(", ")}` : "No workflow files discovered.",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 2,
          selected: input.session.composerFieldIndex === 2,
          index: 2,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "tactic",
          label: "Tactic",
          value: input.session.composer.tactic ?? "none",
          hint: tacticOptions.length > 0 ? `available: ${tacticOptions.join(", ")}` : "No tactics discovered.",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 3,
          selected: input.session.composerFieldIndex === 3,
          index: 3,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "isolation",
          label: "Isolation",
          value: input.session.composer.isolation,
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 4,
          selected: input.session.composerFieldIndex === 4,
          index: 4,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "implementMethod",
          label: "Implement method",
          value: input.session.composer.implementMethod,
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 5,
          selected: input.session.composerFieldIndex === 5,
          index: 5,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "fromStage",
          label: "From stage",
          value: input.session.composer.fromStage ?? "start",
          hint: "Used for rerun or resume flows.",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 6,
          selected: input.session.composerFieldIndex === 6,
          index: 6,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "timeout",
          label: "Timeout",
          value: input.session.composer.timeout !== undefined ? String(input.session.composer.timeout) : "default",
          hint: "Stage timeout hint in seconds.",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 7,
          selected: input.session.composerFieldIndex === 7,
          index: 7,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "gateTimeout",
          label: "Gate timeout",
          value: input.session.composer.gateTimeout !== undefined ? String(input.session.composer.gateTimeout) : "default",
          hint: "Gate timeout in seconds.",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 8,
          selected: input.session.composerFieldIndex === 8,
          index: 8,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "dryRun",
          label: "Dry run",
          value: input.session.composer.dryRun ? "yes" : "no",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 9,
          selected: input.session.composerFieldIndex === 9,
          index: 9,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "forceRerun",
          label: "Force rerun",
          value: input.session.composer.forceRerun ? "yes" : "no",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 10,
          selected: input.session.composerFieldIndex === 10,
          index: 10,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "approvePlan",
          label: "Approve plan",
          value: input.session.composer.approvePlan ? "yes" : "no",
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 11,
          selected: input.session.composerFieldIndex === 11,
          index: 11,
          total: COMPOSER_FIELD_COUNT
        },
        {
          id: "maxParallel",
          label: "Max parallel",
          value: String(input.session.composer.maxParallel),
          editable: true,
          focused: input.session.composerFocus === "fields" && input.session.composerFieldIndex === 12,
          selected: input.session.composerFieldIndex === 12,
          index: 12,
          total: COMPOSER_FIELD_COUNT
        }
      ],
      validation: [
        ...(input.session.composer.prompt.trim() ? [] : ["Prompt is required to start a run."]),
        ...(input.session.composer.workflow && input.session.composer.tactic ? ["Workflow and tactic are mutually exclusive."] : [])
      ],
      suggestedActions: [
        createTuiAction({
          id: "start-run",
          label: "Start run",
          kind: "primary",
          focused: input.session.composerFocus === "actions" && input.session.composerActionIndex === 0,
          selected: input.session.composerActionIndex === 0,
          index: 0,
          total: 2
        }),
        createTuiAction({
          id: "back-home",
          label: "Back to home",
          kind: "ghost",
          focused: input.session.composerFocus === "actions" && input.session.composerActionIndex === 1,
          selected: input.session.composerActionIndex === 1,
          index: 1,
          total: 2
        })
      ],
      help: buildComposerHelp(input.session.composer)
    },
    liveRun: mapLiveRunViewWithState(liveRun, input.session.composer, liveEvents, input.session),
    gate: {
      title: "Gate",
      requestId: input.session.pendingGate?.requestId ?? "pending",
      gateType: input.session.pendingGate?.gateType ?? "custom",
      question: input.session.pendingGate?.question ?? "No gate is waiting.",
      context: input.session.pendingGate?.context,
      statusLine: input.session.pendingGate ? "Choose an option or enter a free-text response." : "No pending gate.",
      expiresAt: bridgeRecovery.session?.pending_question?.expiresAt,
      recoveryAction: bridgeRecovery.recovery?.action,
      recoveryCommand: bridgeRecovery.recovery?.command,
      focusedChoiceIndex: input.session.pendingGate ? input.session.gateSelectionIndex : undefined,
      selectedChoiceValue: input.session.pendingGate?.choices[input.session.gateSelectionIndex],
      freeTextValue: input.session.gateInput || undefined,
      choices: buildGateChoices(input.session.pendingGate).map((choice, index, all) => ({
        ...choice,
        focused: index === input.session.gateSelectionIndex,
        selected: index === input.session.gateSelectionIndex,
        index,
        total: all.length
      })),
      allowFreeText: input.session.pendingGate?.allowFreeText ?? false,
      freeTextLabel: "Type your response and press Enter.",
      artifactPreview: artifactContent
        ? {
            kind: artifactContent.kind,
            label: artifactContent.title,
            path: artifactContent.path,
            summary: artifactContent.summary,
            contentLabel: artifactContent.title,
            contentSummary: artifactContent.lines.slice(0, 3).join(" ")
          }
        : liveRun?.artifacts[0]
          ? mapArtifactLine(liveRun.artifacts[0])
          : null,
      help: ["Esc closes the modal.", "Arrow keys move between choices.", "Enter submits the current selection."]
    },
    inspection: {
      ...inspectionView,
      artifactContent,
      logs: logDetails,
      replay: replayEntries,
      history: historyEntries,
      recovery: recoverySummary
    },
    help: {
      title: "Command palette",
      query: input.session.helpQuery ?? "",
      placeholder: "Search commands",
      focusedSection: "commands",
      selectedCommandId: paletteCommands[input.session.helpSelectedIndex]?.id,
      selectedSectionTitle: paletteCommands[input.session.helpSelectedIndex]?.category,
      selectedKeyBindingIndex: 0,
      sections: paletteGroups.map((group) => ({
        title: group,
        commands: paletteCommands
          .filter((command) => (command.category ?? "Actions") === group)
          .map((command, index, all) => ({
            ...command,
            focused: command.id === paletteCommands[input.session.helpSelectedIndex]?.id,
            selected: command.id === paletteCommands[input.session.helpSelectedIndex]?.id,
            index,
            total: all.length
          }))
      })),
      commands: paletteCommands.map((command, index, all) => ({
        ...command,
        focused: index === input.session.helpSelectedIndex,
        selected: index === input.session.helpSelectedIndex,
        index,
        total: all.length
      })),
      keyBindings: [
        { keys: [preferences.keybindings.commandPalette], label: "Open palette" },
        { keys: [preferences.keybindings.resume], label: "Resume selected run" },
        { keys: [preferences.keybindings.artifacts], label: "Inspect selected run" },
        { keys: [preferences.keybindings.logs], label: "Toggle logs" },
        { keys: [preferences.keybindings.quit], label: "Quit" }
      ],
      slashCommands: paletteCommands.map((command, index, all) => ({
        ...command,
        slashCommand: command.id,
        focused: index === input.session.helpSelectedIndex,
        selected: index === input.session.helpSelectedIndex,
        index,
        total: all.length
      })),
      recentCommands: paletteCommands
        .filter((command) => input.session.recentCommandIds.includes(command.id))
        .slice(0, 3)
        .map((command, index, all) => ({
          ...command,
          index,
          total: all.length
        }))
    }
  });
}
