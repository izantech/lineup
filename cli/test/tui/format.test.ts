import { describe, expect, it } from 'vitest'

import { formatDurationMs, formatIsoTimestamp, formatKeyChord, formatListSummary, formatShortHash } from '../../src/tui/format'

describe('tui formatters', () => {
  it('formats durations using stable coarse units', () => {
    expect(formatDurationMs(45_000)).toBe('45s')
    expect(formatDurationMs(125_000)).toBe('2m 5s')
    expect(formatDurationMs(3_661_000)).toBe('1h 1m')
  })

  it('formats ISO timestamps in UTC', () => {
    expect(formatIsoTimestamp('2026-04-12T12:34:56.000Z')).toBe('2026-04-12 12:34 UTC')
  })

  it('summarizes lists and key chords', () => {
    expect(formatListSummary(['alpha'])).toBe('alpha')
    expect(formatListSummary(['alpha', 'beta', 'gamma', 'delta'], 2)).toBe('alpha, beta +2 more')
    expect(formatKeyChord(['shift', 'tab'])).toBe('shift + tab')
  })

  it('formats short hashes safely', () => {
    expect(formatShortHash('abcdef1234567890')).toBe('abcdef123456')
    expect(formatShortHash(undefined)).toBe('unknown')
  })
})

