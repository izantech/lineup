import { Box, Text } from '../ink-shim'
import { badge } from '../layout'
import type { TuiNode } from '../react-shim'
import type { TuiSelectionState, TuiTone } from '../types'

export function stateBadges(state?: TuiSelectionState, indexTone: TuiTone = 'neutral'): readonly TuiNode[] {
  const chips: TuiNode[] = []

  if (state?.focused) {
    chips.push(badge('focused', 'accent'))
  }

  if (state?.selected) {
    chips.push(badge('selected', 'success'))
  }

  if (typeof state?.index === 'number') {
    const indexLabel = typeof state.total === 'number' ? `${state.index + 1}/${state.total}` : `${state.index + 1}`
    chips.push(badge(indexLabel, indexTone))
  }

  return chips
}

export function stateRow(label: string, state?: TuiSelectionState, detail?: string, tone: TuiTone = 'neutral'): TuiNode {
  return Box(
    { direction: 'row' },
    Text({ bold: true, children: [label] }),
    ...stateBadges(state, tone),
    detail ? Text({ dim: true, children: [` ${detail}`] }) : null
  )
}

export function stateSummary(state?: TuiSelectionState): string | undefined {
  const parts: string[] = []

  if (state?.focused) {
    parts.push('focused')
  }

  if (state?.selected) {
    parts.push('selected')
  }

  if (typeof state?.index === 'number') {
    parts.push(`item ${state.index + 1}`)
  }

  return parts.length > 0 ? parts.join(' · ') : undefined
}
