import { describe, expect, it } from "vitest";

import { LINEUP_CODEX_OLLAMA_PROFILE, LINEUP_CODEX_OLLAMA_PROVIDER, buildLineupCodexConfig, codexConfigPath, mergeLineupCodexConfig } from "../src/lib/codex-config.js";

describe("codex config merge", () => {
  it("adds lineup-owned ollama provider and profile blocks when missing", () => {
    const result = mergeLineupCodexConfig("", {
      providerName: LINEUP_CODEX_OLLAMA_PROVIDER,
      profileName: LINEUP_CODEX_OLLAMA_PROFILE,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "gpt-oss:120b"
    });

    expect(result.changed).toBe(true);
    expect(result.content).toContain(`[model_providers.${LINEUP_CODEX_OLLAMA_PROVIDER}]`);
    expect(result.content).toContain('name = "Ollama"');
    expect(result.content).toContain('base_url = "http://127.0.0.1:11434/v1"');
    expect(result.content).toContain(`[profiles.${LINEUP_CODEX_OLLAMA_PROFILE}]`);
    expect(result.content).toContain('model = "gpt-oss:120b"');
    expect(result.content).toContain(`model_provider = "${LINEUP_CODEX_OLLAMA_PROVIDER}"`);
  });

  it("preserves unrelated config while updating only the lineup-owned blocks", () => {
    const original = `# user comment
[general]
theme = "dark"

[model_providers.external]
name = "OpenAI"
base_url = "https://api.openai.com/v1"

[model_providers.lineup-ollama]
name = "Ollama"
base_url = "http://old.example/v1"

[profiles.lineup-ollama]
model = "old-model"
model_provider = "old-provider"
`;

    const result = mergeLineupCodexConfig(original, {
      providerName: LINEUP_CODEX_OLLAMA_PROVIDER,
      profileName: LINEUP_CODEX_OLLAMA_PROFILE,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "gpt-oss:120b"
    });

    expect(result.changed).toBe(true);
    expect(result.content).toContain('# user comment');
    expect(result.content).toContain('[general]');
    expect(result.content).toContain('theme = "dark"');
    expect(result.content).toContain('[model_providers.external]');
    expect(result.content).toContain('base_url = "https://api.openai.com/v1"');
    expect(result.content).toContain('[model_providers.lineup-ollama]');
    expect(result.content).toContain('base_url = "http://127.0.0.1:11434/v1"');
    expect(result.content).toContain('[profiles.lineup-ollama]');
    expect(result.content).toContain('model = "gpt-oss:120b"');
    expect(result.content).toContain('model_provider = "lineup-ollama"');
    expect(result.content).not.toContain('old.example');
    expect(result.content).not.toContain('old-model');
    expect(result.content).not.toContain('old-provider');
  });

  it("builds the managed config path and content", () => {
    expect(codexConfigPath("/Users/example")).toBe("/Users/example/.codex/config.toml");
    expect(buildLineupCodexConfig({
      providerName: LINEUP_CODEX_OLLAMA_PROVIDER,
      profileName: LINEUP_CODEX_OLLAMA_PROFILE,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "gpt-oss:120b"
    })).toContain("[model_providers.lineup-ollama]");
  });
});
