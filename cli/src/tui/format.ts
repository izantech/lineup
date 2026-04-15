import type { HostName } from '../lib/constants.js'
import type { PipelineRunStatus } from '../lib/state.js'

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatDurationMs(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || Number.isNaN(durationMs)) {
    return 'unknown'
  }

  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) {
    return `${days}d ${hours}h`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

export function formatIsoTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'unknown'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

export function formatHostName(host?: HostName | 'all' | null): string {
  return host ?? 'unknown'
}

export function formatRunStatus(status: PipelineRunStatus | 'idle' | 'unknown'): string {
  return status
}

export function formatListSummary(items: readonly string[], maxItems = 3): string {
  if (items.length === 0) {
    return 'none'
  }

  const visible = items.slice(0, maxItems)
  const hiddenCount = items.length - visible.length

  return hiddenCount > 0
    ? `${visible.join(', ')} +${hiddenCount} more`
    : visible.join(', ')
}

export function formatKeyChord(keys: readonly string[]): string {
  return keys.join(' + ')
}

export function formatStatusBanner(status: string, detail?: string): string {
  return detail ? `${status}: ${detail}` : status
}

export function formatShortHash(hash: string | undefined, length = 12): string {
  if (!hash) {
    return 'unknown'
  }

  return hash.slice(0, length)
}

