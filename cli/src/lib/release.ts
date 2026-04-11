import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { CliError } from "./errors";
import { lineupCacheDir } from "./paths";
import { assertSuccess, runCommand } from "./process";
import type { ReleaseManifest } from "./types";
import { validateReleaseManifest } from "./validation";

const OWNER = "izantech";
const REPO = "lineup";
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const MANIFEST_ASSET_NAME = "lineup-manifest.json";

type ResolveReleaseInput = {
  version?: string;
};

type GithubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GithubRelease = {
  tag_name?: string;
  assets?: GithubReleaseAsset[];
};

export type ResolvedRelease = {
  tag: string;
  sourceRoot: string;
  cacheDir: string;
  manifest: ReleaseManifest;
};

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "lineup-cli",
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new CliError(`Failed to fetch ${url}: ${response.status} ${body}`, {
      code: "http_error"
    });
  }

  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "lineup-cli",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new CliError(`Failed to fetch ${url}: ${response.status} ${body}`, {
      code: "http_error"
    });
  }

  return response.text();
}

async function downloadBinary(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "lineup-cli",
      Accept: "application/octet-stream"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new CliError(`Failed to download ${url}: ${response.status} ${body}`, {
      code: "http_error"
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function cachePaths(tag: string): {
  cacheDir: string;
  manifestPath: string;
  tarballPath: string;
  extractDir: string;
  sourceRoot: string;
} {
  const cacheDir = path.join(lineupCacheDir(), tag);
  return {
    cacheDir,
    manifestPath: path.join(cacheDir, "manifest.json"),
    tarballPath: path.join(cacheDir, "release.tar.gz"),
    extractDir: path.join(cacheDir, "extracted"),
    sourceRoot: path.join(cacheDir, "source")
  };
}

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function resolveLatestTag(): Promise<string> {
  const payload = (await fetchJson(`${API_BASE}/releases/latest`)) as GithubRelease;
  if (!payload.tag_name) {
    throw new CliError("Unable to resolve latest release tag.", {
      code: "missing_latest_tag"
    });
  }

  return payload.tag_name;
}

async function resolveReleaseByTag(tag: string): Promise<GithubRelease> {
  const payload = (await fetchJson(`${API_BASE}/releases/tags/${encodeURIComponent(tag)}`)) as GithubRelease;
  if (!payload.tag_name) {
    throw new CliError(`Release tag not found: ${tag}`, {
      code: "release_not_found"
    });
  }

  return payload;
}

async function fetchReleaseManifest(tag: string): Promise<ReleaseManifest> {
  const release = await resolveReleaseByTag(tag);
  const manifestAsset = (release.assets ?? []).find((asset) => asset.name === MANIFEST_ASSET_NAME);

  const candidates: string[] = [];
  if (manifestAsset?.browser_download_url) {
    candidates.push(manifestAsset.browser_download_url);
  }

  candidates.push(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${encodeURIComponent(tag)}/release-manifest.json`);

  for (const url of candidates) {
    try {
      const text = await fetchText(url);
      const parsed = JSON.parse(text);
      const manifest = validateReleaseManifest(parsed, url);
      if (manifest.tag !== tag) {
        throw new CliError(`Manifest tag mismatch. expected=${tag} actual=${manifest.tag}`, {
          code: "manifest_tag_mismatch"
        });
      }
      return manifest;
    } catch {
      continue;
    }
  }

  throw new CliError(`Could not fetch release manifest for ${tag}. Expected asset ${MANIFEST_ASSET_NAME} in release artifacts.`, {
    code: "release_manifest_missing"
  });
}

function validateExtractedSource(sourceRoot: string): void {
  const required = [
    ".lineup-core/skills/kick-off/core.md",
    ".lineup-core/hosts/claude.json",
    ".lineup-core/hosts/codex.json",
    ".lineup-core/hosts/opencode.json",
    "agents/researcher.md",
    "templates/tactic.yaml"
  ];

  const missing = required.filter((item) => !existsSync(path.join(sourceRoot, item)));
  if (missing.length > 0) {
    throw new CliError(`Release source missing required files:\n${missing.map((item) => `- ${item}`).join("\n")}`, {
      code: "release_source_invalid"
    });
  }
}

function chooseExtractedRoot(extractDir: string): string {
  const dirs = readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (dirs.length === 0) {
    throw new CliError(`No extracted source directory found in ${extractDir}.`, {
      code: "extract_failed"
    });
  }

  return path.join(extractDir, dirs[0].name);
}

async function extractTarball(tarballPath: string, extractDir: string): Promise<void> {
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  const result = await runCommand("tar", ["-xzf", tarballPath, "-C", extractDir]);
  assertSuccess(result, `tar -xzf ${tarballPath}`);
}

function loadCachedManifest(manifestPath: string): ReleaseManifest | null {
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    return validateReleaseManifest(parsed, manifestPath);
  } catch {
    return null;
  }
}

export async function resolveRelease(input: ResolveReleaseInput = {}): Promise<ResolvedRelease> {
  const tag = input.version && input.version !== "latest" ? input.version : await resolveLatestTag();

  const { cacheDir, manifestPath, tarballPath, extractDir, sourceRoot } = cachePaths(tag);
  mkdirSync(cacheDir, { recursive: true });

  const cachedManifest = loadCachedManifest(manifestPath);
  if (cachedManifest && existsSync(sourceRoot)) {
    validateExtractedSource(sourceRoot);
    return {
      tag,
      sourceRoot,
      cacheDir,
      manifest: cachedManifest
    };
  }

  const manifest = await fetchReleaseManifest(tag);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const tarball = await downloadBinary(manifest.tarball_url);
  writeFileSync(tarballPath, tarball);

  const digest = sha256File(tarballPath);
  if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
    rmSync(tarballPath, { force: true });
    throw new CliError(`Checksum mismatch for ${tag}. expected=${manifest.sha256} actual=${digest}`, {
      code: "checksum_mismatch"
    });
  }

  await extractTarball(tarballPath, extractDir);

  const extractedRoot = chooseExtractedRoot(extractDir);
  rmSync(sourceRoot, { recursive: true, force: true });
  renameSync(extractedRoot, sourceRoot);
  rmSync(extractDir, { recursive: true, force: true });

  validateExtractedSource(sourceRoot);

  return {
    tag,
    sourceRoot,
    cacheDir,
    manifest
  };
}

export function resolveLocalRelease(dirPath: string): ResolvedRelease {
  const resolvedPath = path.resolve(dirPath);

  if (!existsSync(resolvedPath)) {
    throw new CliError(`Local directory does not exist: ${resolvedPath}`, {
      code: "local_dir_not_found"
    });
  }

  validateExtractedSource(resolvedPath);

  let tag = "local";
  try {
    const pkgPath = path.join(resolvedPath, "cli", "package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    if (parsed.version) {
      tag = parsed.version;
    }
  } catch {
    // Fall back to "local" tag when package.json is unavailable.
  }

  return {
    tag,
    sourceRoot: resolvedPath,
    cacheDir: resolvedPath,
    manifest: {
      tag,
      tarball_url: "local",
      sha256: "local"
    }
  };
}

export async function readManifestFromFile(filePath: string): Promise<ReleaseManifest> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return validateReleaseManifest(parsed, filePath);
}
