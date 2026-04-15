import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOllamaClient, detectOllamaModels, detectOllamaModelsFromManifestDir, probeOllamaAvailability } from "../src/lib/ollama.js";
import type { OllamaConfig } from "../src/lib/config.js";

describe("ollama bridge", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("probes availability without depending on network access", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    await expect(
      probeOllamaAvailability({
        cli: {
          ollama: {
            enabled: true,
            model: "llama3.1:8b"
          }
        },
        fetchImpl
      })
    ).resolves.toBe(false);
  });

  it("lists models and performs OpenAI-compatible chat completions", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "llama3.1:8b" }, { id: "mistral-small" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (url.endsWith("/chat/completions")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ "content-type": "application/json" });
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("llama3.1:8b");
        expect(body.messages).toEqual([{ role: "user", content: "summarize" }]);
        return new Response(JSON.stringify({ choices: [{ message: { content: "summary" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const config: OllamaConfig = {
      enabled: true,
      model: "llama3.1:8b",
      scope: "research",
      baseUrl: "http://127.0.0.1:11434/v1",
      hostIntegration: null
    };

    const client = createOllamaClient(config, { fetchImpl });
    await expect(client.listModels()).resolves.toEqual(["llama3.1:8b", "mistral-small"]);
    await expect(client.chat([{ role: "user", content: "summarize" }])).resolves.toBe("summary");
  });

  it("falls back to /api/tags and local manifests for model detection", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "lineup-ollama-home-"));
    tempDirs.push(tempHome);

    mkdirSync(join(tempHome, ".ollama", "models", "manifests", "registry.ollama.ai", "library", "qwen3-coder-next"), { recursive: true });
    writeFileSync(
      join(tempHome, ".ollama", "models", "manifests", "registry.ollama.ai", "library", "qwen3-coder-next", "q4_K_M"),
      "{}",
      "utf8"
    );

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await expect(
      detectOllamaModels({
        homeDir: tempHome,
        cli: {
          ollama: {
            enabled: true,
            model: "llama3.1:8b"
          }
        },
        fetchImpl
      })
    ).resolves.toEqual(["llama3.1:8b", "qwen3-coder-next:q4_K_M"]);

    expect(detectOllamaModelsFromManifestDir(tempHome)).toEqual(["qwen3-coder-next:q4_K_M"]);
  });
});
