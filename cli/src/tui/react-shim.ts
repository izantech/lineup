export type TuiPrimitive = string | number | boolean | null | undefined

export type TuiRenderable = TuiNode | readonly TuiRenderable[]

export type TuiProps = Record<string, unknown> & {
  children?: TuiRenderable
}

export type TuiElementType = string

export type TuiElement = {
  type: TuiElementType
  props: TuiProps
  children: readonly TuiNode[]
}

export type TuiNode = TuiElement | TuiPrimitive

function flattenChildren(children: readonly TuiRenderable[], output: TuiNode[] = []): TuiNode[] {
  for (const child of children) {
    if (Array.isArray(child)) {
      flattenChildren(child, output)
      continue
    }

    if (child === null || child === undefined || typeof child === 'boolean') {
      continue
    }

    output.push(child as TuiNode)
  }

  return output
}

export function createElement(type: TuiElementType, props: TuiProps | null, ...children: TuiRenderable[]): TuiElement {
  const normalizedChildren = flattenChildren(children)
  const elementProps = props ?? {}

  return {
    type,
    props: {
      ...elementProps,
      ...(normalizedChildren.length > 0 ? { children: normalizedChildren } : {})
    },
    children: normalizedChildren
  }
}

export function isElement(node: TuiNode): node is TuiElement {
  return typeof node === 'object' && node !== null && 'type' in node && 'children' in node
}
