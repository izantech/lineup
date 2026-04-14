import { describe, expect, it, vi } from "vitest";

import { createOllamaClient, probeOllamaAvailability } from "../src/lib/ollama.js";
import type { OllamaConfig } from "../src/lib/config.js";

describe("ollama bridge", () => {
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
        return new Response(JSON.stringify({ data: [{ name: "llama3.1:8b" }, { name: "mistral-small" }] }), {
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
});
