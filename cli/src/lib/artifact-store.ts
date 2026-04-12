import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { CliError } from "./errors.js";
import { lineupArtifactStoreDir } from "./paths.js";

export type StoredArtifactFormat = "yaml" | "json" | "markdown";

export type StoredArtifactRecord = {
  kind: string;
  format: StoredArtifactFormat;
  sha256: string;
  path: string;
  bytes: number;
  created_at: string;
  existed: boolean;
};

export type ArtifactStore = {
  rootDir: string;
  persistText(kind: string, content: string, format?: Exclude<StoredArtifactFormat, "json">): StoredArtifactRecord;
  persistJson(kind: string, payload: unknown): StoredArtifactRecord;
  resolvePath(kind: string, sha256: string, format: StoredArtifactFormat): string;
  readText(record: Pick<StoredArtifactRecord, "kind" | "format" | "sha256">): string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\uFEFF/g, "").replace(/\r\n?/g, "\n");
}

function sanitizeSegment(segment: string): string {
  const normalized = segment.trim();
  if (normalized.length === 0) {
    throw new CliError("Artifact kind must not be empty.", {
      code: "invalid_path"
    });
  }

  return normalized.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function extensionForFormat(format: StoredArtifactFormat): string {
  if (format === "json") {
    return "json";
  }

  if (format === "markdown") {
    return "md";
  }

  return "yaml";
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }

  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    canonical[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
  }

  return canonical;
}

export function serializeCanonicalJson(payload: unknown): string {
  return `${JSON.stringify(canonicalizeJson(payload), null, 2)}\n`;
}

export function hashArtifactContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function artifactFilePath(rootDir: string, kind: string, sha256: string, format: StoredArtifactFormat): string {
  const safeKind = sanitizeSegment(kind);
  const ext = extensionForFormat(format);
  return path.join(rootDir, safeKind, `${sha256}.${ext}`);
}

function writeImmutableTextFile(filePath: string, content: string): boolean {
  mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code !== "EEXIST") {
      throw error;
    }

    const existing = readFileSync(filePath, "utf8");
    if (existing !== content) {
      throw new CliError(`Artifact store collision detected for ${filePath}.`, {
        code: "data_corruption"
      });
    }

    return false;
  }
}

export function createArtifactStore(rootDir = lineupArtifactStoreDir()): ArtifactStore {
  return {
    rootDir,
    persistText(kind: string, content: string, format: Exclude<StoredArtifactFormat, "json"> = "yaml") {
      const normalized = normalizeLineEndings(content);
      const sha256 = hashArtifactContent(normalized);
      const path = artifactFilePath(rootDir, kind, sha256, format);
      const existed = !writeImmutableTextFile(path, normalized);

      return {
        kind,
        format,
        sha256,
        path,
        bytes: Buffer.byteLength(normalized, "utf8"),
        created_at: nowIso(),
        existed
      };
    },
    persistJson(kind: string, payload: unknown) {
      const serialized = serializeCanonicalJson(payload);
      const sha256 = hashArtifactContent(serialized);
      const path = artifactFilePath(rootDir, kind, sha256, "json");
      const existed = !writeImmutableTextFile(path, serialized);

      return {
        kind,
        format: "json",
        sha256,
        path,
        bytes: Buffer.byteLength(serialized, "utf8"),
        created_at: nowIso(),
        existed
      };
    },
    resolvePath(kind: string, sha256: string, format: StoredArtifactFormat) {
      return artifactFilePath(rootDir, kind, sha256, format);
    },
    readText(record: Pick<StoredArtifactRecord, "kind" | "format" | "sha256">) {
      return readFileSync(artifactFilePath(rootDir, record.kind, record.sha256, record.format), "utf8");
    }
  };
}

export function defaultArtifactStore(): ArtifactStore {
  return createArtifactStore();
}
