import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LINEUP_CODEX_OLLAMA_PROFILE, codexConfigPath } from "../src/lib/codex-config.js"
import { planHostLaunch, resolveHostLaunchStrategy } from "../src/lib/launch-planner.js"
import { LINEUP_OPENCODE_OLLAMA_PROVIDER, opencodeConfigPath } from "../src/lib/opencode-config.js"

function writeProjectConfig(root: string, content: string): void {
  const dir = join(root, ".lineup")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.yaml"), content, "utf8")
}

describe("launch planner", () => {
  let root = ""
  let home = ""
  const originalPath = process.env.PATH

  afterEach(() => {
    process.env.PATH = originalPath
    if (root) {
      rmSync(root, { recursive: true, force: true })
      root = ""
    }
    if (home) {
      rmSync(home, { recursive: true, force: true })
      home = ""
    }
  })

  it("preserves legacy full routing when host integration is disabled", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: full\n`
    )

    const plan = planHostLaunch({
      host: "codex",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect"
    })

    expect(plan.command).toBe("codex")
    expect(plan.integration).toBe("direct")
    expect(plan.args).toContain("-m")
    expect(plan.args).toContain("local-qwen")
  })

  it("writes the managed Codex profile and launches with it", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: gpt-oss:120b\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: managed\n`
    )

    const plan = planHostLaunch({
      host: "codex",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "developer",
      prompt: "inspect"
    })

    expect(plan.command).toBe("codex")
    expect(plan.integration).toBe("ollama-managed")
    expect(plan.args.slice(0, 2)).toEqual(["--profile", LINEUP_CODEX_OLLAMA_PROFILE])
    expect(plan.effectiveModel).toBe("gpt-oss:120b")
    expect(plan.args).not.toContain("-m")
    expect(plan.args[plan.args.length - 1]).toBe("inspect")
    const codexConfig = codexConfigPath(home)
    expect(codexConfig).toBe(join(home, ".codex", "config.toml"))
    expect(readFileSync(codexConfig, "utf8")).toContain("[profiles.lineup-ollama]")
  })

  it("writes the managed OpenCode provider and selects the Ollama model", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: managed\n`
    )

    const plan = planHostLaunch({
      host: "opencode",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "developer",
      prompt: "inspect"
    })

    expect(plan.command).toBe("opencode")
    expect(plan.integration).toBe("ollama-managed")
    expect(plan.args).toContain("--model")
    expect(plan.args).toContain(`${LINEUP_OPENCODE_OLLAMA_PROVIDER}/qwen3-coder`)
    expect(plan.effectiveModel).toBe(`${LINEUP_OPENCODE_OLLAMA_PROVIDER}/qwen3-coder`)
    expect(plan.env.OPENCODE_CONFIG_CONTENT).toBeTruthy()
    expect(plan.args[plan.args.length - 1]).toBe("inspect")

    const config = opencodeConfigPath(home)
    expect(config).toBe(join(home, ".config", "opencode", "opencode.json"))
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual(expect.objectContaining({
      model: `${LINEUP_OPENCODE_OLLAMA_PROVIDER}/qwen3-coder`,
      provider: expect.objectContaining({
        [LINEUP_OPENCODE_OLLAMA_PROVIDER]: expect.objectContaining({
          models: expect.objectContaining({
            "qwen3-coder": expect.objectContaining({
              _launch: true
            })
          })
        })
      })
    }))
  })

  it("adds a non-interactive title in OpenCode direct mode", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder\n  scope: research\n`
    )

    const plan = planHostLaunch({
      host: "opencode",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "Inspect the repository and report findings"
    })

    expect(plan.command).toBe("opencode")
    expect(plan.integration).toBe("direct")
    expect(plan.args).toContain("--title")
    expect(plan.args).toContain("Lineup researcher: Inspect the repository and report findings")
    expect(plan.args[plan.args.length - 1]).toBe("Inspect the repository and report findings")
  })

  it("adds a non-interactive title in OpenCode managed mode", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: managed\n`
    )

    const plan = planHostLaunch({
      host: "opencode",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "developer",
      prompt: "Build the feature"
    })

    expect(plan.command).toBe("opencode")
    expect(plan.integration).toBe("ollama-managed")
    expect(plan.args).toContain("--title")
    expect(plan.args).toContain("Lineup developer: Build the feature")
    expect(plan.args).toContain("--model")
    expect(plan.args).toContain(`${LINEUP_OPENCODE_OLLAMA_PROVIDER}/qwen3-coder`)
    expect(plan.env.OPENCODE_CONFIG_CONTENT).toBeTruthy()
  })

  it("launches Codex with the OSS local-provider contract when strategy resolves to launch", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3.5:9b\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: auto\n`
    )

    const plan = planHostLaunch({
      host: "codex",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "developer",
      prompt: "inspect"
    })

    expect(plan.command).toBe("codex")
    expect(plan.integration).toBe("ollama-launch")
    expect(plan.args.slice(0, 4)).toEqual(["exec", "--oss", "--local-provider", "ollama"])
    expect(plan.args).toContain("-m")
    expect(plan.args).toContain("qwen3.5:9b")
    expect(plan.env.OLLAMA_HOST).toBe("http://127.0.0.1:11434")
  })

  it("does not force Claude bare mode for direct launches", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect"
    })

    expect(plan.command).toBe("claude")
    expect(plan.integration).toBe("direct")
    expect(plan.args).not.toContain("--bare")
    expect(plan.args).toContain("-p")
    expect(plan.args).toContain("--permission-mode")
    expect(plan.args).toContain("bypassPermissions")
  })

  it("wraps Claude with ollama launch when the wrapper is available", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    const binDir = join(root, "bin")
    mkdirSync(binDir, { recursive: true })
    const fakeOllama = join(binDir, "ollama")
    writeFileSync(fakeOllama, "#!/bin/sh\nexit 0\n", "utf8")
    chmodSync(fakeOllama, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ""}`
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3.5\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`
    )

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect"
    })

    expect(plan.command).toBe("ollama")
    expect(plan.integration).toBe("ollama-launch")
    expect(plan.args.slice(0, 6)).toEqual(["launch", "claude", "--model", "qwen3.5", "--yes", "--"])
    expect(plan.env.OLLAMA_HOST).toBe("http://127.0.0.1:11434")
  })

  it("switches Claude draft transport to JSON output mode for Ollama-backed draft runs", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    const binDir = join(root, "bin")
    mkdirSync(binDir, { recursive: true })
    const fakeOllama = join(binDir, "ollama")
    writeFileSync(fakeOllama, "#!/bin/sh\nexit 0\n", "utf8")
    chmodSync(fakeOllama, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ""}`
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3.5\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`
    )

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect",
      claudeDraftJsonOutput: true
    })

    expect(plan.command).toBe("ollama")
    expect(plan.integration).toBe("ollama-launch")
    expect(plan.args).toContain("--output-format")
    expect(plan.args).toContain("json")
    expect(plan.args).not.toContain("--json-schema")
  })

  it("prefers Claude Anthropic-compatible env transport when strategy is auto", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    const binDir = join(root, "bin")
    mkdirSync(binDir, { recursive: true })
    const fakeOllama = join(binDir, "ollama")
    writeFileSync(fakeOllama, "#!/bin/sh\nexit 0\n", "utf8")
    chmodSync(fakeOllama, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ""}`
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder:30b\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: auto\n`
    )

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect"
    })

    expect(plan.command).toBe("claude")
    expect(plan.integration).toBe("ollama-env")
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBe("ollama")
    expect(plan.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:11434")
  })

  it("disables Claude tools for Ollama-backed reviewer runs", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    const binDir = join(root, "bin")
    mkdirSync(binDir, { recursive: true })
    const fakeOllama = join(binDir, "ollama")
    writeFileSync(fakeOllama, "#!/bin/sh\nexit 0\n", "utf8")
    chmodSync(fakeOllama, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ""}`
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder:30b\n  scope: full\n  host_integration:\n    enabled: true\n    strategy: auto\n`
    )

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "reviewer",
      prompt: "review"
    })

    expect(plan.command).toBe("claude")
    expect(plan.args).toContain("--tools")
    expect(plan.args).toContain("")
  })

  it("falls back to Claude Anthropic-compatible env launch when ollama is unavailable", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    const binDir = join(root, "empty-bin")
    mkdirSync(binDir, { recursive: true })
    process.env.PATH = binDir
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3.5\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`
    )

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect"
    })

    expect(plan.command).toBe("claude")
    expect(plan.integration).toBe("ollama-env")
    expect(plan.args).toContain("--model")
    expect(plan.args).toContain("qwen3.5")
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBe("ollama")
    expect(plan.env.ANTHROPIC_API_KEY).toBe("")
    expect(plan.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:11434")
  })

  it("can force Claude onto the Anthropic-compatible env path even when the wrapper is available", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    const binDir = join(root, "bin")
    mkdirSync(binDir, { recursive: true })
    const fakeOllama = join(binDir, "ollama")
    writeFileSync(fakeOllama, "#!/bin/sh\nexit 0\n", "utf8")
    chmodSync(fakeOllama, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ""}`
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder:30b\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`
    )

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect",
      claudeForceEnvFallback: true
    })

    expect(plan.command).toBe("claude")
    expect(plan.integration).toBe("ollama-env")
    expect(plan.args).toContain("--model")
    expect(plan.args).toContain("qwen3-coder:30b")
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBe("ollama")
    expect(plan.env.ANTHROPIC_API_KEY).toBe("")
    expect(plan.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:11434")
  })

  it("forces Claude onto the Anthropic-compatible env path via LINEUP_FORCE_CLAUDE_OLLAMA_ENV", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    const binDir = join(root, "bin")
    mkdirSync(binDir, { recursive: true })
    const fakeOllama = join(binDir, "ollama")
    writeFileSync(fakeOllama, "#!/bin/sh\nexit 0\n", "utf8")
    chmodSync(fakeOllama, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ""}`
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder:30b\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`
    )

    const plan = planHostLaunch({
      host: "claude",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "researcher",
      prompt: "inspect",
      env: {
        ...process.env,
        LINEUP_FORCE_CLAUDE_OLLAMA_ENV: "1"
      }
    })

    expect(plan.command).toBe("claude")
    expect(plan.integration).toBe("ollama-env")
    expect(plan.args).toContain("--model")
    expect(plan.args).toContain("qwen3-coder:30b")
  })

  it("gives host integration precedence over legacy full routing", () => {
    root = mkdtempSync(join(tmpdir(), "launch-planner-root-"))
    home = mkdtempSync(join(tmpdir(), "launch-planner-home-"))
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: qwen3-coder\n  scope: full\n  host_integration:\n    enabled: true\n    strategy: auto\n`
    )

    const plan = planHostLaunch({
      host: "codex",
      projectRoot: root,
      homeDir: home,
      workingDirectory: root,
      agent: "developer",
      prompt: "inspect"
    })

    expect(plan.integration).toBe("ollama-launch")
    expect(plan.args).toContain("--oss")
    expect(plan.args).toContain("--local-provider")
    expect(plan.args).toContain("ollama")
    expect(plan.args).toContain("-m")
    expect(plan.args).toContain("qwen3-coder")
  })

  it("resolves auto strategy to launch for Claude, Codex, and OpenCode", () => {
    const ollama = {
      enabled: true as const,
      model: "local-qwen",
      scope: "research" as const,
      baseUrl: "http://127.0.0.1:11434/v1",
      hostIntegration: {
        enabled: true as const,
        strategy: "auto" as const
      }
    }

    expect(resolveHostLaunchStrategy("claude", ollama)).toBe("launch")
    expect(resolveHostLaunchStrategy("codex", ollama)).toBe("launch")
    expect(resolveHostLaunchStrategy("opencode", ollama)).toBe("launch")
  })
})
