import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

function ollamaManifestRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".ollama", "models", "manifests");
}

function listManifestFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const entries = readdirSync(root, {
    recursive: true,
    withFileTypes: true
  });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function parseManifestModelName(manifestPath: string, root: string): string | null {
  const relativePath = path.relative(root, manifestPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return null;
  }

  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length < 4) {
    return null;
  }

  const [, namespace, ...remainder] = parts;
  if (remainder.length < 2) {
    return null;
  }

  const tag = remainder[remainder.length - 1];
  const repo = remainder.slice(0, -1).join("/");
  if (!repo || !tag) {
    return null;
  }

  return namespace === "library" ? `${repo}:${tag}` : `${namespace}/${repo}:${tag}`;
}

export function detectOllamaModelsFromManifestDir(homeDir = os.homedir()): string[] {
  const root = ollamaManifestRoot(homeDir);
  const models = listManifestFiles(root)
    .map((manifestPath) => parseManifestModelName(manifestPath, root))
    .filter((model): model is string => Boolean(model));

  return Array.from(new Set(models)).sort((left, right) => left.localeCompare(right));
}

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

function normalizeModelNames(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function createOllamaClient(config: OllamaConfig, options?: OllamaClientOptions): OllamaClient {
  return {
    async listModels(): Promise<string[]> {
      try {
        const payload = await requestJson<{ data?: Array<{ id?: string; name?: string; model?: string }> }>(
          config.baseUrl,
          "/models",
          { method: "GET" },
          options
        );
        const models = normalizeModelNames((payload.data ?? []).map((entry) => entry.id ?? entry.name ?? entry.model));
        if (models.length > 0) {
          return models;
        }
      } catch (error) {
        if (!(error instanceof CliError) || error.code !== "ollama_request_failed") {
          throw error;
        }
      }

      const legacyPayload = await requestJson<{ models?: Array<{ name?: string; model?: string }> }>(
        config.baseUrl.replace(/\/v1$/, ""),
        "/api/tags",
        { method: "GET" },
        options
      );
      return normalizeModelNames((legacyPayload.models ?? []).map((entry) => entry.name ?? entry.model));
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

export async function detectOllamaModels(options?: ResolveConfigOptions & OllamaClientOptions): Promise<string[]> {
  const config = readOllamaConfig(options);
  if (!config) {
    return [];
  }

  const discoveredModels = new Set<string>(detectOllamaModelsFromManifestDir(options?.homeDir));

  try {
    const client = createOllamaClient(config, options);
    const remoteModels = await client.listModels();
    for (const model of remoteModels) {
      if (model) {
        discoveredModels.add(model);
      }
    }
  } catch {
    // Local manifest detection is good enough for the config picker.
  }

  return Array.from(discoveredModels).sort((left, right) => left.localeCompare(right));
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
