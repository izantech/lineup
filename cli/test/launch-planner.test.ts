import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LINEUP_CODEX_OLLAMA_PROFILE, codexConfigPath } from "../src/lib/codex-config.js"
import { planHostLaunch } from "../src/lib/launch-planner.js"
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
    expect(plan.args).toContain("qwen3-coder")
    expect(plan.args[plan.args.length - 1]).toBe("inspect")

    const config = opencodeConfigPath(home)
    expect(config).toBe(join(home, ".config", "opencode", "opencode.json"))
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual(expect.objectContaining({
      provider: expect.objectContaining({
        [LINEUP_OPENCODE_OLLAMA_PROVIDER]: expect.any(Object)
      })
    }))
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
})
