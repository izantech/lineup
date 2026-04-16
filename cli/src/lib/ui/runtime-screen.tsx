import process from "node:process";

import { Box, Text, render, useWindowSize } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import { describeBlockedRunNextStep } from "../inspection.js";
import { loadPipelineState, type PipelineStateRecord } from "../state.js";
import type { WorkflowDefinition } from "../types.js";
import {
  buildRuntimeDashboardData,
  buildRuntimeDashboardSummary,
  formatStageLabel,
  formatDuration,
  pendingGateRecoveryCommand,
  stageHeader,
  titleCaseStatus,
  truncate,
  type RuntimeDashboardData,
  type RuntimeStageRow
} from "./runtime.js";
import { detectTerminalCapabilities, supportsDynamicTui, terminalSymbols, type TerminalCapabilities } from "./terminal.js";

type RuntimeSurface = "human" | "watch";
type LayoutMode = "wide" | "stacked" | "compact";

type RuntimeDashboardAppProps = {
  surface: RuntimeSurface;
  state: PipelineStateRecord;
  summary: ReturnType<typeof buildRuntimeDashboardSummary>;
  workflow?: WorkflowDefinition;
  footerLines?: string[];
  viewportSize?: {
    columns: number;
    rows?: number;
  };
  capabilities?: TerminalCapabilities;
};

type RuntimeScreenFrame = {
  surface: RuntimeSurface;
  state: PipelineStateRecord;
  summary: ReturnType<typeof buildRuntimeDashboardSummary>;
  workflow?: WorkflowDefinition;
};

function getLayoutMode(columns: number): LayoutMode {
  if (columns < 88) {
    return "compact";
  }

  if (columns < 126) {
    return "stacked";
  }

  return "wide";
}

function statusGlyph(row: RuntimeStageRow, capabilities: TerminalCapabilities): string {
  const symbols = terminalSymbols(capabilities);

  if (row.status === "succeeded") {
    return symbols.success;
  }
  if (row.status === "failed") {
    return symbols.failure;
  }
  if (row.status === "blocked") {
    return symbols.warning;
  }
  if (row.status === "running") {
    return symbols.running;
  }
  return symbols.pending;
}

function formatPendingChoices(choices: string[], defaultChoice?: string): string {
  return choices.map((choice, index) => `${index + 1}) ${choice}${defaultChoice === choice ? " (default)" : ""}`).join("  ");
}

function Section(props: {
  title: string;
  layoutMode: LayoutMode;
  children: React.ReactNode;
}): React.ReactNode {
  if (props.layoutMode === "compact") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{props.title}</Text>
        {props.children}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
      <Text bold>{props.title}</Text>
      {props.children}
    </Box>
  );
}

function LineList(props: { lines: string[]; bullet?: string }): React.ReactNode {
  const bullet = props.bullet ?? "-";

  return (
    <>
      {props.lines.map((line) => (
        <Text key={`${bullet}:${line}`}>{bullet.length > 0 ? `${bullet} ${line}` : line}</Text>
      ))}
    </>
  );
}

function StageTable(props: {
  rows: RuntimeStageRow[];
  columns: number;
  layoutMode: LayoutMode;
  capabilities: TerminalCapabilities;
}): React.ReactNode {
  if (props.rows.length === 0) {
    return <Text>No structured stage state recorded yet.</Text>;
  }

  if (props.layoutMode === "compact") {
    return (
      <>
        {props.rows.map((row) => (
          <Box key={row.stageId} flexDirection="column" marginBottom={1}>
            <Text>{`${statusGlyph(row, props.capabilities)} ${row.label}${row.isCurrent ? " [current]" : ""}`}</Text>
            <Text>{`status ${titleCaseStatus(row.status)} | attempt ${row.attemptLabel} | ${formatDuration(row.durationMs)}`}</Text>
            <Text>{truncate(row.lastMessage, Math.max(24, props.columns - 2))}</Text>
          </Box>
        ))}
      </>
    );
  }

  const stageWidth = props.layoutMode === "wide" ? 18 : 16;
  const statusWidth = 9;
  const attemptWidth = 7;
  const timeWidth = 8;
  const messageWidth = Math.max(18, props.columns - (stageWidth + statusWidth + attemptWidth + timeWidth + 14));

  return (
    <>
      <Text>{`  ${"Stage".padEnd(stageWidth)} ${"Status".padEnd(statusWidth)} ${"Try".padEnd(attemptWidth)} ${"Time".padEnd(timeWidth)} Message`}</Text>
      {props.rows.map((row) => (
        <Text key={row.stageId}>
          {`${statusGlyph(row, props.capabilities)} ${truncate(row.label, stageWidth).padEnd(stageWidth)} ${titleCaseStatus(row.status).padEnd(statusWidth)} ${row.attemptLabel.padEnd(attemptWidth)} ${formatDuration(row.durationMs).padEnd(timeWidth)} ${truncate(row.lastMessage, messageWidth)}`}
        </Text>
      ))}
    </>
  );
}

function RuntimeDashboard(props: RuntimeDashboardAppProps): React.ReactNode {
  const windowSize = useWindowSize();
  const [now, setNow] = useState(() => Date.now());
  const columns = props.viewportSize?.columns ?? windowSize.columns ?? props.capabilities?.width ?? 80;
  const layoutMode = getLayoutMode(columns);
  const capabilities = props.capabilities ?? {
    isTTY: true,
    supportsColor: false,
    supportsUnicode: true,
    width: columns
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    timer.unref?.();
    return () => {
      clearInterval(timer);
    };
  }, []);

  const dashboard = useMemo<RuntimeDashboardData>(() => buildRuntimeDashboardData(props.state, {
    summary: props.summary,
    workflow: props.workflow,
    now
  }), [now, props.state, props.summary, props.workflow]);

  const runLines = props.surface === "human"
    ? [
        `run_id: ${dashboard.runId}`,
        `status: ${dashboard.statusLabel}`,
        `current_stage: ${dashboard.currentStageHeader}`,
        `elapsed: ${formatDuration(dashboard.elapsedMs)}`
      ]
    : [
        `run_id: ${dashboard.runId}`,
        `status: ${dashboard.statusLabel}`,
        `elapsed: ${formatDuration(dashboard.elapsedMs)}`,
        `workflow: ${dashboard.workflow}`,
        `execution_host: ${dashboard.executionHost}`,
        `runner_host: ${dashboard.runnerHost}`
      ];

  const artifactLines = dashboard.summary.artifactLines.slice(0, layoutMode === "compact" ? 2 : 4);

  return (
    <Box flexDirection="column" paddingX={layoutMode === "compact" ? 0 : 1}>
      <Section title="Run" layoutMode={layoutMode}>
        <LineList lines={runLines} bullet="" />
      </Section>

      <Section title="Stages" layoutMode={layoutMode}>
        <StageTable rows={dashboard.stageRows} columns={columns} layoutMode={layoutMode} capabilities={capabilities} />
      </Section>

      {dashboard.pendingGate ? (
        <Section title="Pending Question" layoutMode={layoutMode}>
          <LineList
            lines={[
              `gate_type: ${dashboard.pendingGate.gate_type}`,
              `stage: ${formatStageLabel(dashboard.pendingGate.stage_id)}`,
              `question: ${dashboard.pendingGate.question}`,
              `choices: ${formatPendingChoices(dashboard.pendingGate.choices, dashboard.pendingGate.default_choice)}`,
              `default: ${dashboard.pendingGate.default_choice ?? "none"}`,
              `expires_at: ${dashboard.pendingGate.expires_at ?? "none"}`,
              `command: ${pendingGateRecoveryCommand(props.state)}`
            ]}
            bullet=""
          />
        </Section>
      ) : null}

      {dashboard.summary.changeLines.length > 0 ? (
        <Section title="Changes" layoutMode={layoutMode}>
          <LineList lines={dashboard.summary.changeLines} />
        </Section>
      ) : null}

      {artifactLines.length > 0 ? (
        <Section title="Artifacts" layoutMode={layoutMode}>
          <LineList lines={artifactLines} />
        </Section>
      ) : null}

      {dashboard.summary.nextLines.length > 0 ? (
        <Section title="Next Actions" layoutMode={layoutMode}>
          <LineList lines={dashboard.summary.nextLines.slice(0, layoutMode === "compact" ? 3 : 5)} />
        </Section>
      ) : null}

      {props.footerLines && props.footerLines.length > 0 ? (
        <Section title="Summary" layoutMode={layoutMode}>
          <LineList lines={props.footerLines} />
        </Section>
      ) : null}
    </Box>
  );
}

class RuntimeTuiSession {
  private frame: RuntimeScreenFrame | null = null;
  private instance: ReturnType<typeof render> | null = null;
  private suspended = false;

  constructor(
    private readonly stream: NodeJS.WriteStream,
    private readonly capabilities: TerminalCapabilities
  ) {}

  update(frame: RuntimeScreenFrame): void {
    this.frame = frame;
    if (this.suspended || !supportsDynamicTui(this.stream)) {
      return;
    }

    this.renderFrame();
  }

  async pause(): Promise<void> {
    this.suspended = true;
    await this.unmount();
  }

  async resume(): Promise<void> {
    this.suspended = false;
    if (!this.frame || !supportsDynamicTui(this.stream)) {
      return;
    }

    this.renderFrame();
    await this.instance?.waitUntilRenderFlush();
  }

  async close(): Promise<void> {
    this.suspended = true;
    await this.unmount();
  }

  private renderFrame(): void {
    if (!this.frame) {
      return;
    }

    const node = (
      <RuntimeDashboard
        surface={this.frame.surface}
        state={this.frame.state}
        summary={this.frame.summary}
        workflow={this.frame.workflow}
        capabilities={this.capabilities}
      />
    );

    if (!this.instance) {
      this.instance = render(node, {
        stdout: this.stream,
        stderr: this.stream,
        stdin: process.stdin,
        interactive: true,
        alternateScreen: true,
        incrementalRendering: true,
        maxFps: 10,
        patchConsole: false
      });
      return;
    }

    this.instance.rerender(node);
  }

  private async unmount(): Promise<void> {
    if (!this.instance) {
      return;
    }

    const instance = this.instance;
    this.instance = null;
    instance.unmount();
    await instance.waitUntilExit();
  }
}

function plainWatchExitLines(state: PipelineStateRecord, cwd: string): string[] {
  if (state.status === "blocked") {
    return [
      `Run ${state.run_id} blocked.`,
      describeBlockedRunNextStep(state.run_id)
    ];
  }

  const lines = [`Run ${state.run_id} finished with status ${titleCaseStatus(state.status)}.`];
  const summary = buildRuntimeDashboardSummary(state, cwd);

  for (const line of summary.nextLines.slice(0, 2)) {
    lines.push(line);
  }

  if (lines.length === 1) {
    lines.push(`Inspect with \`lineup show ${state.run_id}\`.`);
  }

  return lines;
}

export class HumanRunRenderer {
  private readonly stream: NodeJS.WriteStream;
  private readonly capabilities: TerminalCapabilities;
  private readonly session: RuntimeTuiSession | null;
  private readonly dynamic: boolean;
  private lastStageId: string | null = null;
  private latestState: PipelineStateRecord | null = null;

  constructor(
    private readonly workflow: WorkflowDefinition,
    private readonly cwd = process.cwd(),
    stream: NodeJS.WriteStream = process.stderr
  ) {
    this.stream = stream;
    this.capabilities = detectTerminalCapabilities(stream);
    this.dynamic = supportsDynamicTui(stream);
    this.session = this.dynamic ? new RuntimeTuiSession(stream, this.capabilities) : null;
  }

  beginStage(stageId: string, state: PipelineStateRecord): void {
    this.latestState = state;
    if (this.lastStageId !== stageId && !this.dynamic) {
      this.stream.write(`\n${stageHeader(stageId, this.workflow)}\n`);
      this.lastStageId = stageId;
    }

    this.lastStageId = stageId;
    this.session?.update({
      surface: "human",
      state,
      summary: buildRuntimeDashboardSummary(state, this.cwd),
      workflow: this.workflow
    });
  }

  update(stageId: string, message: string, state: PipelineStateRecord, final = false): void {
    this.latestState = state;
    this.beginStage(stageId, state);

    if (!this.dynamic) {
      const symbols = terminalSymbols(this.capabilities);
      const prefix = final ? symbols.success : symbols.bullet;
      this.stream.write(`${prefix} ${message}\n`);
    }
  }

  async finish(state: PipelineStateRecord, summary: string): Promise<void> {
    this.latestState = state;
    await this.session?.close();
    this.stream.write(`${summary}\n`);
  }

  async pause(): Promise<void> {
    await this.session?.pause();
  }

  async resume(state: PipelineStateRecord): Promise<void> {
    this.latestState = state;
    this.session?.update({
      surface: "human",
      state,
      summary: buildRuntimeDashboardSummary(state, this.cwd),
      workflow: this.workflow
    });
    await this.session?.resume();
  }
}

export async function runWatchDashboardTui(options: {
  runId: string;
  cwd?: string;
}): Promise<void> {
  const capabilities = detectTerminalCapabilities(process.stdout);
  const session = new RuntimeTuiSession(process.stdout, capabilities);
  const cwd = options.cwd ?? process.cwd();
  let finalState: PipelineStateRecord | null = null;

  while (true) {
    const state = loadPipelineState(options.runId, cwd);
    if (!state) {
      await session.close();
      process.stdout.write(`Run not found: ${options.runId}\n`);
      return;
    }

    finalState = state;
    session.update({
      surface: "watch",
      state,
      summary: buildRuntimeDashboardSummary(state, cwd)
    });

    if (new Set(["blocked", "succeeded", "failed", "canceled"]).has(state.status)) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await session.close();

  if (!finalState) {
    return;
  }

  for (const line of plainWatchExitLines(finalState, cwd)) {
    process.stdout.write(`${line}\n`);
  }
}

export { RuntimeDashboard, getLayoutMode };
export type { RuntimeDashboardAppProps };
