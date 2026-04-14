import { describe, expect, it } from "vitest";

import { LINEUP_OPENCODE_OLLAMA_PROVIDER, buildLineupOpencodeConfig, mergeLineupOpencodeConfig, opencodeConfigPath } from "../src/lib/opencode-config.js";

describe("opencode config helper", () => {
  it("adds the Lineup-owned Ollama provider without changing unrelated config", () => {
    const input = JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        theme: "midnight",
        provider: {
          anthropic: {
            options: {
              baseURL: "https://api.anthropic.com/v1"
            }
          }
        }
      },
      null,
      2
    );

    const result = mergeLineupOpencodeConfig(input, {
      providerName: LINEUP_OPENCODE_OLLAMA_PROVIDER,
      model: "qwen3-coder",
      baseUrl: "http://127.0.0.1:11434"
    });

    expect(result.changed).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      $schema: "https://opencode.ai/config.json",
      theme: "midnight",
      provider: {
        anthropic: {
          options: {
            baseURL: "https://api.anthropic.com/v1"
          }
        },
        "lineup-ollama": {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama",
          options: {
            baseURL: "http://127.0.0.1:11434/v1"
          },
          models: {
            "qwen3-coder": {
              name: "qwen3-coder"
            }
          }
        }
      }
    });
  });

  it("preserves unrelated OpenCode config while updating the Lineup-owned Ollama block", () => {
    const input = JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        provider: {
          ollama: {
            npm: "@ai-sdk/openai-compatible",
            name: "Ollama",
            options: {
              baseURL: "http://old-host:11434/v1",
              timeout: 30
            },
            models: {
              "llama3.1": {
                name: "llama3.1",
                temperature: 0.2
              }
            }
          },
          openai: {
            options: {
              baseURL: "https://api.openai.com/v1"
            }
          }
        },
        editor: "vim"
      },
      null,
      2
    );

    const result = mergeLineupOpencodeConfig(input, {
      providerName: LINEUP_OPENCODE_OLLAMA_PROVIDER,
      model: "qwen3-coder",
      baseUrl: "http://localhost:11434/v1"
    });

    expect(JSON.parse(result.content)).toEqual({
      $schema: "https://opencode.ai/config.json",
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama",
          options: {
            baseURL: "http://old-host:11434/v1",
            timeout: 30
          },
          models: {
            "llama3.1": {
              name: "llama3.1",
              temperature: 0.2
            }
          }
        },
        openai: {
          options: {
            baseURL: "https://api.openai.com/v1"
          }
        },
        "lineup-ollama": {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama",
          options: {
            baseURL: "http://localhost:11434/v1"
          },
          models: {
            "qwen3-coder": {
              name: "qwen3-coder"
            }
          }
        }
      },
      editor: "vim"
    });
  });

  it("builds a valid managed config path and config payload from scratch", () => {
    expect(opencodeConfigPath("/Users/example")).toBe("/Users/example/.config/opencode/opencode.json");
    expect(JSON.parse(buildLineupOpencodeConfig({
      providerName: LINEUP_OPENCODE_OLLAMA_PROVIDER,
      model: "qwen3-coder",
      baseUrl: "http://localhost:11434"
    }))).toEqual({
      $schema: "https://opencode.ai/config.json",
      provider: {
        "lineup-ollama": {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama",
          options: {
            baseURL: "http://localhost:11434/v1"
          },
          models: {
            "qwen3-coder": {
              name: "qwen3-coder"
            }
          }
        }
      }
    });
  });
});
