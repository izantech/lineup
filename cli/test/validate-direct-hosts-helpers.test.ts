import { describe, expect, it } from 'vitest'

import {
  classifyHumanTranscriptPrompt,
  classifyValidationFailure,
  laneSelection,
  parseValidateDirectHostArgs
} from '../src/scripts/validate-direct-hosts-helpers.js'

describe('validate-direct-hosts helpers', () => {
  it('parses lane and scenario options', () => {
    const parsed = parseValidateDirectHostArgs(
      ['--host', 'codex', '--lane', 'human', '--scenario', 'explain', '--keep-temp', '--report', '/tmp/report.json'],
      ['claude', 'codex', 'opencode']
    )

    expect(parsed).toEqual({
      host: 'codex',
      lane: 'human',
      scenario: 'explain',
      keepTemp: true,
      skipPreflight: false,
      skipCertification: false,
      skipRecovery: false,
      reportPath: '/tmp/report.json'
    })
  })

  it('respects legacy skip flags when selecting all lanes', () => {
    expect(
      laneSelection({
        host: 'all',
        lane: 'all',
        keepTemp: false,
        skipPreflight: false,
        skipCertification: true,
        skipRecovery: false
      })
    ).toEqual({
      bridge: false,
      recovery: true,
      human: true,
      realRepo: true
    })
  })

  it('classifies failures into report blocker classes', () => {
    expect(classifyValidationFailure('invalid schema for structured output')).toBe('contract_breakage')
    expect(classifyValidationFailure('authentication token missing for host')).toBe('auth/config')
    expect(classifyValidationFailure('bridge run stalled waiting for output')).toBe('host_runtime')
    expect(classifyValidationFailure('style variance only')).toBe('expected_variance')
  })

  it('detects approval prompts in human transcripts', () => {
    expect(classifyHumanTranscriptPrompt('Approve this plan? [Y/n]: ')).toEqual({
      kind: 'approval',
      response: '\n'
    })
  })

  it('detects verify decision prompts in human transcripts', () => {
    expect(
      classifyHumanTranscriptPrompt('Review failed. How to proceed?\n  1) Retry\n  2) Accept with warnings\n  3) Abort\nChoice [1/2/3]: ')
    ).toEqual({
      kind: 'verify-decision',
      response: '3\n'
    })
  })

  it('detects classify prompts in human transcripts', () => {
    expect(
      classifyHumanTranscriptPrompt("Classify this task's complexity and identify affected areas.\n> ")
    ).toEqual({
      kind: 'free-text',
      response: 'simple\n'
    })
  })
})
