import { Box, Text } from '../ink-shim'
import { actionLabel, badge, bulletList, card, emptyState, kvRow, panel, section, split } from '../layout'
import { formatIsoTimestamp, formatShortHash } from '../format'
import type { TuiLiveRunViewModel, TuiStageTimelineItem, TuiTaskWave } from '../types'
import { stateBadges, stateRow } from './state'

export type LiveRunViewProps = {
  viewModel: TuiLiveRunViewModel
}

function stageLine(stage: TuiStageTimelineItem, selected?: boolean, focused?: boolean): ReturnType<typeof Text> {
  const parts = [`${stage.label} · ${stage.status}`]
  if (stage.detail) {
    parts.push(stage.detail)
  }
  return Box(
    { direction: 'row', stage: stage.id, tone: stage.status, focused, selected },
    Text({ bold: focused || selected || stage.focused || stage.selected, children: [parts.join(' · ')] }),
    ...stateBadges({ ...stage, focused: focused || stage.focused, selected: selected || stage.selected }, 'accent')
  )
}

function waveCard(wave: TuiTaskWave, selected?: boolean, focused?: boolean): ReturnType<typeof card> {
  return card(
    wave.label,
    [
      Box(
        { direction: 'row', wave: wave.id, focused, selected },
        ...stateBadges({ ...wave, focused: focused || wave.focused, selected: selected || wave.selected }, 'accent')
      ),
      wave.detail ? Text({ dim: true, children: [wave.detail] }) : null,
      wave.tasks.length > 0
        ? bulletList(
            wave.tasks.map((task) => `${task.title}${task.status ? ` · ${task.status}` : ''}`),
            'Tasks'
          )
        : Text({ dim: true, children: ['No tasks in this wave'] })
    ].filter((item): item is NonNullable<typeof item> => item !== null)
  )
}

export function LiveRunView(props: LiveRunViewProps) {
  const { viewModel } = props

  const verificationBody = viewModel.verification
    ? [
        stateRow('verification', { focused: viewModel.focusedSection === 'verification', selected: Boolean(viewModel.selectedActionId) }, undefined, 'accent'),
        kvRow('label', viewModel.verification.label),
        kvRow('status', viewModel.verification.status),
        viewModel.verification.detail ? Text({ children: [viewModel.verification.detail] }) : null,
        ...(viewModel.verification.actions && viewModel.verification.actions.length > 0
          ? viewModel.verification.actions.map((action) =>
              Box(
                { direction: 'column', action: action.id, kind: action.kind, tone: action.tone, selected: action.id === viewModel.selectedActionId },
                actionLabel(action),
                action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
                ...stateBadges(action, 'accent')
              )
            )
          : [])
      ].filter((item): item is NonNullable<typeof item> => item !== null)
    : [emptyState('Verification summary is pending', 'A verify step or blocked gate will populate this section.')];

  const artifactBody = viewModel.artifacts.length > 0
    ? viewModel.artifacts.map((artifact) =>
        card(
          artifact.label,
          [
            Box(
              {
                direction: 'row',
                artifact: artifact.kind,
                selected: artifact.kind === viewModel.selectedArtifactKind,
                focused: viewModel.focusedSection === 'artifacts' && artifact.kind === viewModel.selectedArtifactKind
              },
              artifact.kind === viewModel.selectedArtifactKind ? badge('selected', 'success') : null,
              ...stateBadges({ ...artifact, selected: artifact.kind === viewModel.selectedArtifactKind, focused: viewModel.focusedSection === 'artifacts' && artifact.kind === viewModel.selectedArtifactKind }, 'accent')
            ),
            kvRow('kind', artifact.kind),
            artifact.path ? kvRow('path', artifact.path) : null,
            artifact.hash ? kvRow('hash', formatShortHash(artifact.hash)) : null,
            artifact.summary ? Text({ children: [artifact.summary] }) : null,
            artifact.status ? Text({ dim: true, children: [`status: ${artifact.status}`] }) : null
          ].filter((item): item is NonNullable<typeof item> => item !== null)
        )
      )
    : [emptyState('Artifacts are pending', 'Plan, tasks, review, and protocol files appear once the run produces them.')];

  return panel(viewModel.title, [
    kvRow('run', viewModel.runId),
    kvRow('status', viewModel.status),
    viewModel.host ? kvRow('host', viewModel.host) : null,
    viewModel.workflow ? kvRow('workflow', viewModel.workflow) : null,
    viewModel.tactic ? kvRow('tactic', viewModel.tactic) : null,
    viewModel.currentStage ? kvRow('current stage', viewModel.currentStage) : null,
    viewModel.modeSummary ? Text({ children: [viewModel.modeSummary] }) : null,
    viewModel.approvalMode ? Text({ dim: true, children: [`approval mode: ${viewModel.approvalMode}`] }) : null,
    viewModel.focusedSection ? Text({ dim: true, children: [`focus: ${viewModel.focusedSection}`] }) : null,
    split(
      [
        section(
          'Stage timeline',
          viewModel.stageTimeline.length > 0
            ? viewModel.stageTimeline.map((stage) =>
                stageLine(
                  stage,
                  stage.id === viewModel.selectedStageId,
                  viewModel.focusedSection === 'timeline' && stage.id === viewModel.selectedStageId
                )
              )
            : [emptyState('No stage timeline', 'Stages will appear once the pipeline begins execution.')]
        ),
        section(
          'Verification',
          verificationBody
        )
      ],
      [
        section(
          'Status stream',
          viewModel.statusStream.length > 0
            ? viewModel.statusStream.map((entry) =>
                Box(
                  {
                    direction: 'column',
                    log: entry.id,
                    tone: entry.level,
                    focused: entry.focused || entry.id === viewModel.selectedLogId,
                    selected: entry.selected || entry.id === viewModel.selectedLogId
                  },
                  Box(
                    { direction: 'row' },
                    badge(entry.level.toUpperCase(), entry.level === 'error' ? 'danger' : entry.level === 'warning' ? 'warning' : entry.level === 'status' ? 'accent' : 'neutral'),
                    ...(entry.id === viewModel.selectedLogId ? [badge('selected', 'success')] : []),
                    ...stateBadges({ ...entry, focused: entry.focused || entry.id === viewModel.selectedLogId, selected: entry.selected || entry.id === viewModel.selectedLogId }, 'accent')
                  ),
                  Text({
                    bold: entry.focused || entry.selected || entry.id === viewModel.selectedLogId,
                    children: [
                      `${entry.timestamp ? `${formatIsoTimestamp(entry.timestamp)} · ` : ''}${entry.text}`
                    ]
                  })
                )
              )
            : [emptyState('Status stream is empty', 'Stage progress and gate updates will appear here.')]
        ),
        section(
          'Next actions',
          viewModel.nextActions.length > 0
            ? viewModel.nextActions.map((action) =>
                Box(
                  { direction: 'column', action: action.id, tone: action.tone, kind: action.kind, selected: action.id === viewModel.selectedActionId },
                  actionLabel(action),
                  action.id === viewModel.selectedActionId ? badge('selected', 'success') : null,
                  ...stateBadges(action, 'accent')
                )
              )
            : [emptyState('Next actions are pending', 'Resume, retry, and cancel actions will appear when the run exposes them.')]
        )
      ]
    ),
    section(
      'Task waves',
      viewModel.taskWaves.length > 0
        ? viewModel.taskWaves.map((wave) =>
            Box(
              {
                direction: 'column',
                wave: wave.id,
                focused: wave.focused || wave.id === viewModel.selectedTaskWaveId,
                selected: wave.selected || wave.id === viewModel.selectedTaskWaveId
              },
              waveCard(wave, wave.id === viewModel.selectedTaskWaveId, viewModel.focusedSection === 'taskWaves' && wave.id === viewModel.selectedTaskWaveId),
              ...stateBadges({ ...wave, focused: wave.focused || wave.id === viewModel.selectedTaskWaveId, selected: wave.selected || wave.id === viewModel.selectedTaskWaveId }, 'accent')
            )
          )
        : [emptyState('Task waves are pending', 'Task summaries appear when the pipeline compiles work into waves.')]
    ),
    section('Artifacts', artifactBody),
    viewModel.changedItems.length > 0
      ? section('What changed', viewModel.changedItems.map((line) => Text({ children: [line] })))
      : null,
    viewModel.lastUpdatedAt ? Text({ dim: true, children: [`updated ${formatIsoTimestamp(viewModel.lastUpdatedAt)}`] }) : null
  ].filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined))
}
