import { CliError } from '../lib/errors.js'
import type { HostName } from '../lib/constants.js'

export type ValidationLane = 'bridge' | 'recovery' | 'human' | 'real-repo' | 'all'
export type BlockerClassification = 'contract_breakage' | 'host_runtime' | 'auth/config' | 'expected_variance'

export type ValidationScenario =
  | 'implementation'
  | 'explain'
  | 'gate-timeout'
  | 'late-answer'
  | 'cancel'
  | 'lock-conflict'
  | 'retry-failed'
  | 'analysis-only'
  | 'docs-only'
  | 'multi-file'
  | 'plan-approval'
  | 'resume-recovery'

export type ValidationOptions = {
  host: HostName | 'all';
  lane: ValidationLane;
  scenario?: ValidationScenario;
  keepTemp: boolean;
  skipPreflight: boolean;
  skipCertification: boolean;
  skipRecovery: boolean;
  reportPath?: string;
};

export function parseValidateDirectHostArgs(argv: string[], supportedHosts: readonly HostName[]): ValidationOptions {
  const result: ValidationOptions = {
    host: 'all',
    lane: 'all',
    keepTemp: false,
    skipPreflight: false,
    skipCertification: false,
    skipRecovery: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--host') {
      const value = argv[index + 1]
      index += 1
      if (!value) {
        throw new CliError('--host requires a value', { code: 'validate_direct_missing_host' })
      }

      if (value !== 'all' && !supportedHosts.includes(value as HostName)) {
        throw new CliError(`Unsupported host '${value}'. Expected claude|codex|opencode|all.`, {
          code: 'validate_direct_invalid_host'
        })
      }

      result.host = value as ValidationOptions['host']
      continue
    }

    if (arg === '--lane') {
      const value = argv[index + 1]
      index += 1
      if (!value) {
        throw new CliError('--lane requires a value', { code: 'validate_direct_missing_lane' })
      }
      if (!['bridge', 'recovery', 'human', 'real-repo', 'all'].includes(value)) {
        throw new CliError(`Unsupported lane '${value}'. Expected bridge|recovery|human|real-repo|all.`, {
          code: 'validate_direct_invalid_lane'
        })
      }
      result.lane = value as ValidationLane
      continue
    }

    if (arg === '--scenario') {
      const value = argv[index + 1]
      index += 1
      if (!value) {
        throw new CliError('--scenario requires a value', { code: 'validate_direct_missing_scenario' })
      }
      result.scenario = value as ValidationScenario
      continue
    }

    if (arg === '--report') {
      const value = argv[index + 1]
      index += 1
      if (!value?.trim()) {
        throw new CliError('--report requires a file path', { code: 'validate_direct_missing_report' })
      }
      result.reportPath = value
      continue
    }

    if (arg === '--keep-temp') {
      result.keepTemp = true
      continue
    }

    if (arg === '--skip-preflight') {
      result.skipPreflight = true
      continue
    }

    if (arg === '--skip-certification') {
      result.skipCertification = true
      continue
    }

    if (arg === '--skip-recovery') {
      result.skipRecovery = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      continue
    }

    throw new CliError(`Unknown option: ${arg}`, { code: 'validate_direct_unknown_option' })
  }

  return result
}

export function laneSelection(options: ValidationOptions): {
  bridge: boolean;
  recovery: boolean;
  human: boolean;
  realRepo: boolean;
} {
  if (options.lane === 'all') {
    return {
      bridge: !options.skipCertification,
      recovery: !options.skipRecovery,
      human: true,
      realRepo: true
    }
  }

  return {
    bridge: options.lane === 'bridge',
    recovery: options.lane === 'recovery',
    human: options.lane === 'human',
    realRepo: options.lane === 'real-repo'
  }
}

export function classifyValidationFailure(detail: string): BlockerClassification {
  const normalized = detail.toLowerCase()

  if (
    normalized.includes('auth') ||
    normalized.includes('login') ||
    normalized.includes('token') ||
    normalized.includes('api key') ||
    normalized.includes('not ready') ||
    normalized.includes('not installed') ||
    normalized.includes('command not found')
  ) {
    return 'auth/config'
  }

  if (
    normalized.includes('invalid') ||
    normalized.includes('schema') ||
    normalized.includes('unexpected') ||
    normalized.includes('missing artifact') ||
    normalized.includes('did not reference') ||
    normalized.includes('did not surface') ||
    normalized.includes('mismatch')
  ) {
    return 'contract_breakage'
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('stalled') ||
    normalized.includes('failed with exit code') ||
    normalized.includes('agent invocation failed') ||
    normalized.includes('another mutating lineup run is already active')
  ) {
    return 'host_runtime'
  }

  return 'expected_variance'
}

export function classifyHumanTranscriptPrompt(transcript: string): {
  kind: 'approval' | 'verify-decision' | 'free-text' | 'none';
  response?: string;
} {
  if (/\[Y\/n\]:\s*$/m.test(transcript)) {
    return { kind: 'approval', response: '\n' }
  }

  if (/Choice \[1\/2\/3\]:\s*$/m.test(transcript)) {
    return { kind: 'verify-decision', response: '3\n' }
  }

  if (/\n>\s*$/m.test(transcript)) {
    const classifyPrompt = /Classify this task's complexity/i.test(transcript)
    return {
      kind: 'free-text',
      response: classifyPrompt ? 'simple\n' : 'Proceed with the bounded validation task only.\n'
    }
  }

  return { kind: 'none' }
}
