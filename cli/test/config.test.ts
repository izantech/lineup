import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { resolveAgentConfig, resolveLineupConfig, type ResolveConfigOptions } from "../src/lib/config.js";

function writeAgent(root: string, agent: string, body: string): void {
  const dir = join(root, "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${agent}.md`),
    `---\nname: ${agent}\ncolor: blue\ndescription: test agent\ntools: Read, Grep, Glob, LS, WebFetch, WebSearch\nmodel: haiku\nmemory: project\n---\n\n${body}\n`,
    "utf8"
  );
}

function writeProjectConfig(root: string, content: string): void {
  const dir = join(root, ".lineup");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.yaml"), content, "utf8");
}

function writeUserOverride(homeDir: string, host: "claude" | "codex" | "opencode", agent: string, content: string): void {
  const dir =
    host === "claude"
      ? join(homeDir, ".claude", "lineup", "agents")
      : host === "codex"
        ? join(homeDir, ".codex", "lineup", "agents")
        : join(homeDir, ".config", "opencode", "lineup", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${agent}.yaml`), content, "utf8");
}

describe("config resolution", () => {
  let root = "";
  let home = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("resolves CLI, env, project, user, and default layers in order", () => {
    root = mkdtempSync(join(tmpdir(), "tmp-config-root-"));
    home = mkdtempSync(join(tmpdir(), "tmp-config-home-"));
    writeAgent(root, "researcher", "You are the researcher.");
    writeUserOverride(
      home,
      "claude",
      "researcher",
      `plugin_version: "1.0.0"\nmodel: opus\ntools: Read, Grep, Glob, LS, WebFetch, WebSearch\nmemory: user\n`
    );
    writeProjectConfig(
      root,
      `models:\n  haiku: project-haiku\n  sonnet: project-sonnet\n  opus: project-opus\nagents:\n  researcher:\n    model: sonnet\n    tools: Read, Grep, Glob, LS, Write\n    memory: project\nollama:\n  enabled: true\n  model: project-ollama\n  scope: research\n  baseUrl: http://project-ollama:11434/v1\n`
    );

    const options: ResolveConfigOptions = {
      projectRoot: root,
      homeDir: home,
      host: "claude",
      env: {
        LINEUP_MODEL: "opus",
        LINEUP_TOOLS: "Read, Grep, Glob",
        LINEUP_MEMORY: "local",
        LINEUP_MODEL_HAIKU: "env-haiku",
        LINEUP_OLLAMA_ENABLED: "true",
        LINEUP_OLLAMA_MODEL: "env-ollama",
        LINEUP_OLLAMA_BASE_URL: "http://env-ollama:11434/v1"
      },
      cli: {
        models: { haiku: "cli-haiku" },
        agents: {
          researcher: {
            model: "haiku",
            memory: "project"
          }
        },
        ollama: {
          enabled: true,
          model: "cli-ollama"
        }
      }
    };

    const resolved = resolveAgentConfig("researcher", options);
    expect(resolved.model).toBe("haiku");
    expect(resolved.modelTarget).toBe("cli-haiku");
    expect(resolved.tools).toBe("Read, Grep, Glob");
    expect(resolved.memory).toBe("project");
    expect(resolved.source).toEqual({ model: "cli", tools: "env", memory: "cli" });

    const lineup = resolveLineupConfig(options);
    expect(lineup.modelRouting).toEqual({
      haiku: "cli-haiku",
      sonnet: "project-sonnet",
      opus: "project-opus"
    });
    expect(lineup.ollama).toEqual({
      enabled: true,
      model: "cli-ollama",
      scope: "research",
      baseUrl: "http://env-ollama:11434/v1"
    });
  });

  it("ignores malformed user overrides and falls back to defaults", () => {
    root = mkdtempSync(join(tmpdir(), "tmp-config-root-"));
    home = mkdtempSync(join(tmpdir(), "tmp-config-home-"));
    writeAgent(root, "researcher", "You are the researcher.");
    writeUserOverride(home, "claude", "researcher", "model: [broken");

    const resolved = resolveAgentConfig("researcher", {
      projectRoot: root,
      homeDir: home,
      host: "claude"
    });

    expect(resolved.model).toBe("haiku");
    expect(resolved.tools).toContain("WebSearch");
    expect(resolved.memory).toBe("project");
    expect(resolved.warnings.some((warning) => warning.includes("malformed"))).toBe(true);
  });

  it("prefers project Ollama config over user config", () => {
    root = mkdtempSync(join(tmpdir(), "tmp-config-root-"));
    home = mkdtempSync(join(tmpdir(), "tmp-config-home-"));
    writeProjectConfig(
      root,
      `ollama:\n  enabled: true\n  model: project-ollama\n  scope: research\n`
    );
    writeUserOverride(home, "claude", "researcher", `enabled: false\nmodel: user-ollama\nscope: research\n`);

    const config = resolveLineupConfig({
      projectRoot: root,
      homeDir: home,
      host: "claude"
    });

    expect(config.ollama).toEqual({
      enabled: true,
      model: "project-ollama",
      scope: "research",
      baseUrl: "http://127.0.0.1:11434/v1"
    });
  });
});
