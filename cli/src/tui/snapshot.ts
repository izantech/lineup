import { isElement, type TuiNode } from './react-shim'

function pushLine(lines: string[], line: string, indent: number): void {
  lines.push(`${'  '.repeat(indent)}${line}`)
}

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry)).join(', ')
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  return '[object]'
}

export function serializeTuiNode(node: TuiNode, indent = 0): string {
  const lines: string[] = []

  function visit(current: TuiNode, depth: number): void {
    if (current === null || current === undefined || typeof current === 'boolean') {
      return
    }

    if (typeof current === 'string' || typeof current === 'number') {
      pushLine(lines, String(current), depth)
      return
    }

    if (!isElement(current)) {
      pushLine(lines, serializeValue(current), depth)
      return
    }

    const entries = Object.entries(current.props).filter(([key]) => key !== 'children')
    const propSummary = entries.length > 0
      ? ` ${entries.map(([key, value]) => `${key}=${serializeValue(value)}`).join(' ')}`
      : ''
    pushLine(lines, `<${current.type}${propSummary}>`, depth)

    for (const child of current.children) {
      visit(child, depth + 1)
    }

    pushLine(lines, `</${current.type}>`, depth)
  }

  visit(node, indent)
  return lines.join('\n')
}

export function collectTuiText(node: TuiNode): string {
  const lines: string[] = []

  function visit(current: TuiNode): void {
    if (current === null || current === undefined || typeof current === 'boolean') {
      return
    }

    if (typeof current === 'string' || typeof current === 'number') {
      lines.push(String(current))
      return
    }

    if (!isElement(current)) {
      return
    }

    for (const child of current.children) {
      visit(child)
    }
  }

  visit(node)
  return lines.join('\n')
}

