import { execSync } from "node:child_process"
import os from "node:os"

import { type HostName } from "./constants.js"
import { readOllamaConfig, resolveAgentModelTarget, type OllamaConfig, type OllamaHostIntegrationStrategy } from "./config.js"
import { LINEUP_CODEX_OLLAMA_PROFILE, LINEUP_CODEX_OLLAMA_PROVIDER, codexConfigPath, upsertLineupCodexConfig } from "./codex-config.js"
import { LINEUP_OPENCODE_OLLAMA_PROVIDER, opencodeConfigPath, upsertLineupOpencodeConfig } from "./opencode-config.js"
import type { AgentRole } from "./types.js"

export type HostLaunchStrategy = "launch" | "managed"

export type HostLaunchPlanInput = {
  host: HostName
  projectRoot: string
  workingDirectory: string
  agent: AgentRole
  prompt: string
  timeoutMs?: number
  addDirs?: string[]
  outputPath?: string
  schemaContent?: string | null
  schemaPath?: string | null
  claudeDraftJsonOutput?: boolean
  claudeForceEnvFallback?: boolean
  env?: NodeJS.ProcessEnv
  homeDir?: string
  ollama?: OllamaConfig | null
}

export type HostLaunchPlan = {
  host: HostName
  strategy: HostLaunchStrategy
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  effectiveModel: string
  ollama: OllamaConfig | null
  integration: "direct" | "ollama-launch" | "ollama-managed" | "ollama-env"
}

function uniqueDirs(input: string[]): string[] {
  return [...new Set(input.filter((value) => value.trim().length > 0))]
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  try {
    execSync(`which ${command}`, {
      env,
      stdio: "ignore"
    })
    return true
  } catch {
    return false
  }
}

function stripApiSuffix(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "").replace(/\/v1$/, "")
}

function normalizeWrapperEnv(env: NodeJS.ProcessEnv, baseUrl: string): NodeJS.ProcessEnv {
  return {
    ...env,
    OLLAMA_HOST: stripApiSuffix(baseUrl)
  }
}

function insertOptionBeforePrompt(args: string[], option: string, value: string): string[] {
  if (args.length === 0) {
    return [option, value]
  }

  return [...args.slice(0, -1), option, value, args[args.length - 1]]
}

function prependArgs(args: string[], prefix: string[]): string[] {
  return [...prefix, ...args]
}

function shouldPassLegacyModel(host: HostName, model: string): boolean {
  if (host === "claude") {
    return model.trim().length > 0
  }

  return model.trim().length > 0 && !["haiku", "sonnet", "opus"].includes(model)
}

function resolveConfiguredStrategy(host: HostName, configured: OllamaHostIntegrationStrategy): HostLaunchStrategy {
  if (configured !== "auto") {
    return configured
  }

  return "launch"
}

function shouldForceClaudeEnvFallback(env: NodeJS.ProcessEnv, explicitFallback = false): boolean {
  if (explicitFallback) {
    return true
  }

  const raw = env.LINEUP_FORCE_CLAUDE_OLLAMA_ENV
  if (!raw) {
    return false
  }

  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
}

function shouldPreferClaudeEnvByDefault(configured: OllamaHostIntegrationStrategy): boolean {
  return configured === "auto"
}

export function resolveHostLaunchStrategy(host: HostName, ollama: OllamaConfig | null): HostLaunchStrategy {
  const configuredStrategy = ollama?.hostIntegration?.enabled ? ollama.hostIntegration.strategy : undefined

  if (!configuredStrategy) {
    return "launch"
  }

  return resolveConfiguredStrategy(host, configuredStrategy)
}

function buildClaudeDirectArgs(input: HostLaunchPlanInput, model: string): string[] {
  const args = [
    "-p",
    "--bare",
    "--output-format",
    input.schemaContent || input.claudeDraftJsonOutput ? "json" : "text",
    "--permission-mode",
    "bypassPermissions",
    ...(input.ollama?.hostIntegration?.enabled && input.agent === "reviewer" ? ["--tools", ""] : []),
    ...uniqueDirs([input.projectRoot, input.workingDirectory, ...(input.addDirs ?? [])]).flatMap((dir) => ["--add-dir", dir]),
    ...(input.schemaContent ? ["--json-schema", input.schemaContent] : []),
    input.prompt
  ]

  return shouldPassLegacyModel("claude", model)
    ? insertOptionBeforePrompt(args, "--model", model)
    : args
}

function buildCodexDirectArgs(input: HostLaunchPlanInput, model: string): string[] {
  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    input.workingDirectory,
    ...uniqueDirs([input.projectRoot, ...(input.addDirs ?? [])]).flatMap((dir) => ["--add-dir", dir]),
    ...(input.schemaPath ? ["--output-schema", input.schemaPath] : []),
    ...(input.outputPath ? ["-o", input.outputPath] : []),
    input.prompt
  ]

  return shouldPassLegacyModel("codex", model)
    ? insertOptionBeforePrompt(args, "-m", model)
    : args
}

function buildOpencodeDirectArgs(input: HostLaunchPlanInput, model: string): string[] {
  const args = [
    "run",
    "--dir",
    input.workingDirectory,
    "--pure",
    "--format",
    "json",
    "--title",
    buildOpencodeTitle(input),
    "--dangerously-skip-permissions",
    input.prompt
  ]

  return shouldPassLegacyModel("opencode", model)
    ? insertOptionBeforePrompt(args, "--model", model)
    : args
}

function buildCodexOllamaLaunchArgs(input: HostLaunchPlanInput, model: string): string[] {
  const directArgs = buildCodexDirectArgs(input, model)

  return [
    directArgs[0] ?? "exec",
    "--oss",
    "--local-provider",
    "ollama",
    ...directArgs.slice(1)
  ]
}

function qualifyOpencodeModel(providerName: string, model: string): string {
  return `${providerName}/${model}`
}

function buildOpencodeTitle(input: HostLaunchPlanInput): string {
  const titleBase = input.prompt.trim().split(/\s+/).slice(0, 12).join(" ")
  return titleBase.length > 0 ? `Lineup ${input.agent}: ${titleBase}` : `Lineup ${input.agent}`
}

function planDirectLaunch(input: HostLaunchPlanInput, effectiveModel: string, env: NodeJS.ProcessEnv): HostLaunchPlan {
  switch (input.host) {
    case "claude":
      return {
        host: input.host,
        strategy: "launch",
        command: "claude",
        args: buildClaudeDirectArgs(input, effectiveModel),
        env,
        effectiveModel,
        ollama: input.ollama ?? null,
        integration: "direct"
      }
    case "codex":
      return {
        host: input.host,
        strategy: "managed",
        command: "codex",
        args: buildCodexDirectArgs(input, effectiveModel),
        env,
        effectiveModel,
        ollama: input.ollama ?? null,
        integration: "direct"
      }
    case "opencode":
      return {
        host: input.host,
        strategy: "managed",
        command: "opencode",
        args: buildOpencodeDirectArgs(input, effectiveModel),
        env,
        effectiveModel,
        ollama: input.ollama ?? null,
        integration: "direct"
      }
  }
}

export function planHostLaunch(input: HostLaunchPlanInput): HostLaunchPlan {
  const env = { ...process.env, ...(input.env ?? {}) }
  const ollama = input.ollama ?? readOllamaConfig({
    projectRoot: input.projectRoot,
    host: input.host,
    homeDir: input.homeDir ?? os.homedir(),
    env
  })
  const effectiveModel = resolveAgentModelTarget(input.agent, {
    projectRoot: input.projectRoot,
    host: input.host,
    homeDir: input.homeDir ?? os.homedir(),
    env
  })

  if (!ollama?.hostIntegration?.enabled) {
    return planDirectLaunch({ ...input, ollama }, effectiveModel, env)
  }

  const configuredStrategy = ollama.hostIntegration.strategy
  const strategy = resolveConfiguredStrategy(input.host, configuredStrategy)

  if (input.host === "claude") {
    const directArgs = buildClaudeDirectArgs({ ...input, ollama }, "")
    const forceEnvFallback = shouldForceClaudeEnvFallback(env, input.claudeForceEnvFallback)
    const preferEnvByDefault = shouldPreferClaudeEnvByDefault(configuredStrategy)

    if (!forceEnvFallback && !preferEnvByDefault && strategy === "launch" && commandExists("ollama", env)) {
      return {
        host: input.host,
        strategy,
        command: "ollama",
        args: ["launch", "claude", "--model", ollama.model, "--yes", "--", ...directArgs],
        env: normalizeWrapperEnv(env, ollama.baseUrl),
        effectiveModel: ollama.model,
        ollama,
        integration: "ollama-launch"
      }
    }

    return {
      host: input.host,
      strategy,
      command: "claude",
      args: insertOptionBeforePrompt(directArgs, "--model", ollama.model),
      env: {
        ...env,
        ANTHROPIC_AUTH_TOKEN: "ollama",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_BASE_URL: stripApiSuffix(ollama.baseUrl)
      },
      effectiveModel: ollama.model,
      ollama,
      integration: "ollama-env"
    }
  }

  if (input.host === "codex") {
    const directArgs = buildCodexDirectArgs(input, "")

    if (strategy === "launch") {
      return {
        host: input.host,
        strategy,
        command: "codex",
        args: buildCodexOllamaLaunchArgs(input, ollama.model),
        env: normalizeWrapperEnv(env, ollama.baseUrl),
        effectiveModel: ollama.model,
        ollama,
        integration: "ollama-launch"
      }
    }

    upsertLineupCodexConfig(codexConfigPath(input.homeDir ?? os.homedir()), {
      providerName: LINEUP_CODEX_OLLAMA_PROVIDER,
      profileName: LINEUP_CODEX_OLLAMA_PROFILE,
      baseUrl: ollama.baseUrl,
      model: ollama.model
    })

    return {
      host: input.host,
      strategy,
      command: "codex",
      args: prependArgs(directArgs, ["--profile", LINEUP_CODEX_OLLAMA_PROFILE]),
      env,
      effectiveModel: ollama.model,
      ollama,
      integration: "ollama-managed"
    }
  }

  const directArgs = buildOpencodeDirectArgs(input, "")

  if (strategy === "launch") {
    return {
      host: input.host,
      strategy,
      command: "ollama",
      args: ["launch", "opencode", "--model", ollama.model, "--yes", "--", ...directArgs],
      env: normalizeWrapperEnv(env, ollama.baseUrl),
      effectiveModel: ollama.model,
      ollama,
      integration: "ollama-launch"
    }
  }

  const managedConfig = upsertLineupOpencodeConfig(opencodeConfigPath(input.homeDir ?? os.homedir()), {
    providerName: LINEUP_OPENCODE_OLLAMA_PROVIDER,
    model: ollama.model,
    baseUrl: ollama.baseUrl
  })

  const qualifiedModel = qualifyOpencodeModel(LINEUP_OPENCODE_OLLAMA_PROVIDER, ollama.model)

  return {
    host: input.host,
    strategy,
    command: "opencode",
    args: insertOptionBeforePrompt(directArgs, "--model", qualifiedModel),
    env: {
      ...env,
      OPENCODE_CONFIG_CONTENT: managedConfig.content.trim()
    },
    effectiveModel: qualifiedModel,
    ollama,
    integration: "ollama-managed"
  }
}
