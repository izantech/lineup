import { Text } from '../ink-shim'
import { bulletList, emptyState, kvRow, panel, section, split } from '../layout'
import { formatIsoTimestamp } from '../format'
import type { TuiLiveRunViewModel } from '../types'

export type LiveRunViewProps = {
  viewModel: TuiLiveRunViewModel
}

function renderOverview(viewModel: TuiLiveRunViewModel) {
  return [
    kvRow('run', viewModel.runId),
    kvRow('status', viewModel.status),
    viewModel.host ? kvRow('host', viewModel.host) : null,
    viewModel.workflow ? kvRow('workflow', viewModel.workflow) : null,
    viewModel.currentStage ? kvRow('current stage', viewModel.currentStage) : null,
    viewModel.lastUpdatedAt ? kvRow('updated', formatIsoTimestamp(viewModel.lastUpdatedAt)) : null
  ].filter((item): item is NonNullable<typeof item> => item !== null)
}

function renderStatusStream(viewModel: TuiLiveRunViewModel) {
  return viewModel.statusStream.length > 0
    ? [
        bulletList(
        viewModel.statusStream.slice(-8).map((entry) =>
          `${entry.timestamp ? `${formatIsoTimestamp(entry.timestamp)} · ` : ''}${entry.text}`
        )
        )
      ]
    : [emptyState('No status updates yet', 'Progress updates will appear here once the pipeline emits them.')]
}

function renderNextActions(viewModel: TuiLiveRunViewModel) {
  return viewModel.nextActions.length > 0
    ? [
        bulletList(
        viewModel.nextActions.map((action) =>
          action.description ? `${action.label} - ${action.description}` : action.label
        )
        )
      ]
    : [emptyState('No actions needed right now', 'Lineup is still executing the pipeline.')]
}

function renderArtifacts(viewModel: TuiLiveRunViewModel) {
  return viewModel.artifacts.length > 0
    ? [
        bulletList(
        viewModel.artifacts.map((artifact) =>
          artifact.summary ? `${artifact.label} - ${artifact.summary}` : artifact.label
        )
        )
      ]
    : [emptyState('Artifacts pending', 'Plan, tasks, review, and protocol files appear as stages complete.')]
}

function renderTaskWaves(viewModel: TuiLiveRunViewModel) {
  return viewModel.taskWaves.length > 0
    ? [
        bulletList(
        viewModel.taskWaves.map((wave) =>
          wave.detail ? `${wave.label} - ${wave.detail}` : wave.label
        )
        )
      ]
    : [emptyState('Task waves pending', 'Task breakdowns appear once the pipeline compiles work into waves.')]
}

export function LiveRunView(props: LiveRunViewProps) {
  const { viewModel } = props

  return panel(viewModel.title, [
    ...renderOverview(viewModel),
    viewModel.verification?.detail ? Text({ dim: true, children: [viewModel.verification.detail] }) : null,
    split(
      [
        section('Pipeline', [
          ...renderStatusStream(viewModel),
          ...renderTaskWaves(viewModel)
        ]),
        section('Artifacts', renderArtifacts(viewModel))
      ],
      [
        section('What Lineup is waiting on', renderNextActions(viewModel)),
        section(
          'Verification',
          viewModel.verification
            ? [
                kvRow('label', viewModel.verification.label),
                kvRow('status', viewModel.verification.status),
                viewModel.verification.detail ? Text({ children: [viewModel.verification.detail] }) : null
              ].filter((item): item is NonNullable<typeof item> => item !== null)
            : [emptyState('Verification pending', 'Verification details will appear when the pipeline reaches that stage.')]
        )
      ]
    )
  ].filter((item): item is NonNullable<typeof item> => item !== null))
}
