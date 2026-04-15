import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { normalizeCodexOutputSchema } from '../src/lib/agent-runner.js'

const schemaPath = fileURLToPath(new URL('../schemas/yaml/v3/plan.schema.json', import.meta.url))

describe('normalizeCodexOutputSchema', () => {
  it('prunes optional object properties from the plan schema for codex strict mode', () => {
    const normalized = normalizeCodexOutputSchema(readFileSync(schemaPath, 'utf8'))

    expect(normalized).not.toBeNull()

    const parsed = JSON.parse(normalized ?? '{}') as {
      required: string[];
      properties: Record<string, unknown>;
    }

    expect(parsed.required).toEqual([
      'apiVersion',
      'kind',
      'status',
      'summary',
      'approaches',
      'recommendation',
      'changes',
      'acceptance_criteria',
      'risks'
    ])
    expect(parsed.properties.type).toBeUndefined()
    expect(parsed.properties.parallelization_strategy).toBeUndefined()
    expect(parsed.properties.dependencies).toBeUndefined()
  })

  it('keeps only required nested fields for approach items', () => {
    const normalized = normalizeCodexOutputSchema(readFileSync(schemaPath, 'utf8'))
    const parsed = JSON.parse(normalized ?? '{}') as {
      properties: {
        approaches: {
          items: {
            required: string[];
            properties: Record<string, unknown>;
          };
        };
      };
    }

    expect(parsed.properties.approaches.items.required).toEqual(['name', 'strategy'])
    expect(Object.keys(parsed.properties.approaches.items.properties)).toEqual(['name', 'strategy'])
  })
})
