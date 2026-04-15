import { describe, expect, it } from 'vitest'

import { createDefaultTuiSessionState, reduceTuiSessionState } from '../../src/tui/controller'

describe('tui controller input routing', () => {
  it('routes typed input into the task prompt by default', () => {
    const initial = createDefaultTuiSessionState({
      prompt: '',
      host: 'codex',
      isolation: 'index',
      implementMethod: 'phase',
      dryRun: false,
      forceRerun: false,
      approvePlan: false,
      maxParallel: 3
    })

    const prompted = reduceTuiSessionState(initial, { type: 'append-composer-prompt', value: 'a' })
    const updated = reduceTuiSessionState(prompted, { type: 'append-composer-prompt', value: 'b' })

    expect(updated.composer.prompt).toBe('ab')
    expect(updated.gateInput).toBe('')
    expect(updated.route).toEqual({ screen: 'home' })
  })

  it('keeps gate input separate and resets it when a gate is set', () => {
    const initial = createDefaultTuiSessionState({
      prompt: 'describe the task',
      host: 'codex',
      isolation: 'index',
      implementMethod: 'phase',
      dryRun: false,
      forceRerun: false,
      approvePlan: false,
      maxParallel: 3
    })

    const gateState = reduceTuiSessionState(initial, {
      type: 'set-pending-gate',
      gate: {
        requestId: 'gate-1',
        gateType: 'approval',
        question: 'Approve the plan?',
        choices: ['approve', 'revise'],
        defaultChoice: 'approve',
        allowFreeText: true,
        createdAt: new Date().toISOString()
      }
    })

    const gateInput = reduceTuiSessionState(gateState, { type: 'append-gate-input', value: 'r' })

    expect(gateInput.pendingGate?.requestId).toBe('gate-1')
    expect(gateInput.gateInput).toBe('r')
    expect(gateInput.route).toEqual({ screen: 'live', modal: 'gate' })
    expect(gateInput.composer.prompt).toBe('describe the task')
  })
})
