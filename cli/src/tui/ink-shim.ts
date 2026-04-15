import { createElement, type TuiElement, type TuiProps, type TuiRenderable } from './react-shim'

function takeChildren(props: TuiProps): TuiRenderable[] {
  const { children } = props
  if (children === undefined) {
    return []
  }

  return Array.isArray(children) ? [...children] : [children]
}

export type TuiBoxProps = TuiProps & {
  direction?: 'row' | 'column'
  gap?: number
  border?: boolean
  title?: string
}

export function Box(props: TuiBoxProps, ...restChildren: TuiRenderable[]): TuiElement {
  const { children, ...rest } = props
  return createElement('Box', rest, ...takeChildren({ children }), ...restChildren)
}

export type TuiTextProps = TuiProps & {
  color?: string
  bold?: boolean
  dim?: boolean
}

export function Text(props: TuiTextProps, ...restChildren: TuiRenderable[]): TuiElement {
  const { children, ...rest } = props
  return createElement('Text', rest, ...takeChildren({ children }), ...restChildren)
}

export function Divider(props: { label?: string } = {}): TuiElement {
  return createElement('Divider', props)
}

export function Spacer(props: { size?: number } = {}): TuiElement {
  return createElement('Spacer', props)
}

export function Newline(): TuiElement {
  return createElement('Newline', {})
}
