import { Box, Divider, Spacer, Text } from './ink-shim'
import { createElement, type TuiElement, type TuiNode } from './react-shim'
import type { TuiAction, TuiKeyBinding, TuiTone } from './types'

export type TuiSectionOptions = {
  active?: boolean
  tone?: TuiTone
  grow?: number
}

export function titleText(value: string, subtitle?: string): TuiElement {
  return Box(
    { direction: 'column' },
    Text({ bold: true, children: [value] }),
    subtitle ? Text({ dim: true, children: [subtitle] }) : null
  )
}

export function badge(label: string, tone: TuiTone = 'neutral'): TuiElement {
  return Box({ direction: 'row', tone }, Text({ bold: true, children: [label] }))
}

export function section(title: string, children: readonly TuiNode[], detail?: string, options: TuiSectionOptions = {}): TuiElement {
  const tone = options.active ? options.tone ?? 'accent' : options.tone
  return Box(
    { direction: 'column', section: title, border: Boolean(options.active), tone },
    titleText(title, detail),
    Divider(),
    ...children
  )
}

export function panel(title: string, children: readonly TuiNode[], detail?: string): TuiElement {
  return panelWithOptions(title, children, detail)
}

export type TuiPanelOptions = {
  active?: boolean
  tone?: TuiTone
  grow?: number
}

export function panelWithOptions(title: string, children: readonly TuiNode[], detail?: string, options: TuiPanelOptions = {}): TuiElement {
  const tone = options.active ? options.tone ?? 'accent' : options.tone
  return Box(
    { direction: 'column', border: true, title, tone, flexGrow: options.grow },
    titleText(title, detail),
    ...children
  )
}

export function card(title: string, body: readonly TuiNode[], detail?: string): TuiElement {
  return Box(
    { direction: 'column', border: true, title },
    titleText(title, detail),
    ...body
  )
}

export function keyBindingLabel(binding: TuiKeyBinding): TuiElement {
  return Box(
    { direction: 'row', keyBinding: binding.label },
    Text({ bold: true, children: [binding.keys.join(' + ')] }),
    Spacer({ size: 1 }),
    Text({ children: [binding.label] }),
    binding.description ? Text({ dim: true, children: [` - ${binding.description}`] }) : null
  )
}

export function actionLabel(action: TuiAction): TuiElement {
  const shortcut = action.shortcut ? ` (${action.shortcut})` : ''
  const description = action.description ? ` - ${action.description}` : ''

  return Box(
    { direction: 'row', action: action.id, kind: action.kind, tone: action.tone },
    Text({ bold: true, children: [action.label] }),
    Text({ dim: true, children: [shortcut + description] })
  )
}

export function bulletList(lines: readonly string[], title?: string): TuiElement {
  return Box(
    { direction: 'column', title },
    ...lines.map((line) => Text({ children: [`• ${line}`] }))
  )
}

export function kvRow(label: string, value: string): TuiElement {
  return Box(
    { direction: 'row', key: label },
    Text({ bold: true, children: [`${label}: `] }),
    Text({ children: [value] })
  )
}

export function stack(children: readonly TuiNode[]): TuiElement {
  return Box({ direction: 'column' }, ...children)
}

export function split(left: readonly TuiNode[], right: readonly TuiNode[]): TuiElement {
  return Box(
    { direction: 'row', split: true },
    Box({ direction: 'column', split: 'left' }, ...left),
    Box({ direction: 'column', split: 'right' }, ...right)
  )
}

export function modal(title: string, children: readonly TuiNode[], detail?: string): TuiElement {
  return Box(
    { direction: 'column', border: true, modal: title },
    titleText(title, detail),
    ...children
  )
}

export function emptyState(message: string, hint?: string): TuiElement {
  return Box(
    { direction: 'column', empty: true },
    Text({ bold: true, children: [message] }),
    hint ? Text({ dim: true, children: [hint] }) : null
  )
}
