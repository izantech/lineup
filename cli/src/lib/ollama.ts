import { CliError } from "./errors.js";
import { readOllamaConfig, type OllamaConfig, type ResolveConfigOptions } from "./config.js";

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OllamaClient = {
  listModels(): Promise<string[]>;
  chat(messages: OllamaMessage[], options?: { temperature?: number; maxTokens?: number }): Promise<string>;
};

export type OllamaClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") + "/v1";
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof fetch !== "function") {
    throw new CliError("Global fetch is not available.", {
      code: "fetch_unavailable"
    });
  }

  return fetch;
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  options?: OllamaClientOptions
): Promise<T> {
  const fetchFn = getFetch(options?.fetchImpl);
  const controller = options?.timeoutMs ? new AbortController() : undefined;
  const timeout = options?.timeoutMs
    ? setTimeout(() => controller?.abort(), options.timeoutMs)
    : null;

  try {
    const response = await fetchFn(`${normalizeBaseUrl(baseUrl)}${path}`, {
      ...init,
      signal: controller?.signal ?? init.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new CliError(`Ollama request failed with HTTP ${response.status}: ${text}`, {
        code: "ollama_request_failed"
      });
    }

    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    throw new CliError(`Ollama request failed: ${error instanceof Error ? error.message : String(error)}`, {
      code: "ollama_request_failed"
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function createOllamaClient(config: OllamaConfig, options?: OllamaClientOptions): OllamaClient {
  return {
    async listModels(): Promise<string[]> {
      const payload = await requestJson<{ data?: Array<{ name?: string }> }>(config.baseUrl, "/models", { method: "GET" }, options);
      return (payload.data ?? [])
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0);
    },

    async chat(messages: OllamaMessage[], chatOptions?: { temperature?: number; maxTokens?: number }): Promise<string> {
      const payload = await requestJson<{
        choices?: Array<{ message?: { content?: string } }>;
      }>(
        config.baseUrl,
        "/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: false,
            temperature: chatOptions?.temperature,
            max_tokens: chatOptions?.maxTokens
          })
        },
        options
      );

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        return content;
      }

      throw new CliError("Ollama response did not include assistant content.", {
        code: "ollama_invalid_response"
      });
    }
  };
}

export async function probeOllamaAvailability(options?: ResolveConfigOptions & OllamaClientOptions): Promise<boolean> {
  const config = readOllamaConfig(options);
  if (!config) {
    return false;
  }

  try {
    const client = createOllamaClient(config, options);
    await client.listModels();
    return true;
  } catch {
    return false;
  }
}
