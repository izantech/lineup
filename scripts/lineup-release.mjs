import { createWriteStream } from 'node:fs';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OWNER = 'izantech';
const REPO = 'lineup';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const CACHE_ROOT = path.join(os.homedir(), '.lineup', 'cache');
const STATE_FILE = path.join(os.homedir(), '.lineup', 'state.json');
const STATE_SCHEMA_VERSION = 1;

const REQUIRED_RELEASE_FILES = [
  'scripts/lineup.mjs',
  'scripts/lineup-host-claude.mjs',
  'scripts/lineup-host-codex.mjs',
  'scripts/lineup-release.mjs',
  'scripts/lineup-prompts.mjs',
  '.agents/skills/lineup-kick-off/SKILL.md',
  '.agents/skills/lineup-kick-off/INIT.md',
  '.agents/skills/lineup-configure/SKILL.md',
  '.agents/skills/lineup-explain/SKILL.md',
  '.agents/skills/lineup-playbook/SKILL.md'
];

function ensureParentDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'lineup-installer',
          Accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            requestJson(res.headers.location).then(resolve, reject);
            return;
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode ?? 'unknown'} for ${url}: ${body}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
  });
}

function downloadFile(url, destination) {
  ensureParentDir(destination);

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'lineup-installer',
          Accept: 'application/octet-stream'
        }
      },
      async (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try {
            await downloadFile(res.headers.location, destination);
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode ?? 'unknown'} while downloading ${url}`));
          return;
        }

        const stream = createWriteStream(destination);
        try {
          await pipeline(res, stream);
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    );

    req.on('error', reject);
  });
}

function extractTarball(tarballPath, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const result = spawnSync('tar', ['-xzf', tarballPath, '-C', outputDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('`tar` command not found. Install tar and retry.');
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Failed to extract ${tarballPath} (exit ${result.status}).`,
        result.stdout ? `stdout:\n${result.stdout}` : null,
        result.stderr ? `stderr:\n${result.stderr}` : null
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
}

function validateReleaseSource(sourceDir) {
  const missing = REQUIRED_RELEASE_FILES.filter((relativePath) => {
    return !existsSync(path.join(sourceDir, ...relativePath.split('/')));
  });

  if (missing.length > 0) {
    throw new Error(
      [
        `Release source at ${sourceDir} is missing required files:`,
        ...missing.map((entry) => `- ${entry}`)
      ].join('\n')
    );
  }
}

function findExtractedRoot(extractDir) {
  const entries = readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length === 0) {
    throw new Error(`No extracted source directory found in ${extractDir}`);
  }

  return path.join(extractDir, entries[0].name);
}

export async function resolveLatestTag() {
  const payload = await requestJson(`${API_BASE}/releases/latest`);
  const tag = payload?.tag_name;
  if (!tag || typeof tag !== 'string') {
    throw new Error('Could not resolve latest release tag from GitHub API.');
  }
  return tag;
}

export async function assertReleaseTagExists(tag) {
  if (!tag || typeof tag !== 'string') {
    throw new Error('Release tag must be a non-empty string.');
  }

  await requestJson(`${API_BASE}/releases/tags/${encodeURIComponent(tag)}`);
}

function releaseCachePaths(tag) {
  const cacheDir = path.join(CACHE_ROOT, tag);
  return {
    cacheDir,
    tarballPath: path.join(cacheDir, 'release.tar.gz'),
    extractDir: path.join(cacheDir, 'extracted'),
    sourceDir: path.join(cacheDir, 'source'),
    metaPath: path.join(cacheDir, 'meta.json')
  };
}

function tarballUrlForTag(tag) {
  return `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/tags/${encodeURIComponent(tag)}`;
}

function writeReleaseMeta(metaPath, metadata) {
  ensureParentDir(metaPath);
  writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

export async function resolveRelease({ version = 'latest', logger } = {}) {
  const tag = version === 'latest' ? await resolveLatestTag() : version;

  if (version !== 'latest') {
    await assertReleaseTagExists(tag);
  }

  const { cacheDir, tarballPath, extractDir, sourceDir, metaPath } = releaseCachePaths(tag);

  if (existsSync(sourceDir)) {
    try {
      validateReleaseSource(sourceDir);
      return {
        tag,
        sourceDir,
        cacheDir,
        metadata: existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null
      };
    } catch (error) {
      logger?.info?.(`Existing cache for ${tag} is invalid. Rebuilding cache...`);
      rmSync(cacheDir, { recursive: true, force: true });
      mkdirSync(cacheDir, { recursive: true });
    }
  }

  mkdirSync(cacheDir, { recursive: true });
  rmSync(extractDir, { recursive: true, force: true });

  const tarballUrl = tarballUrlForTag(tag);
  logger?.info?.(`Downloading ${OWNER}/${REPO} release ${tag}...`);
  await downloadFile(tarballUrl, tarballPath);

  logger?.info?.(`Extracting release ${tag}...`);
  extractTarball(tarballPath, extractDir);

  const extractedRoot = findExtractedRoot(extractDir);
  rmSync(sourceDir, { recursive: true, force: true });
  renameSync(extractedRoot, sourceDir);
  rmSync(extractDir, { recursive: true, force: true });

  validateReleaseSource(sourceDir);

  const metadata = {
    owner: OWNER,
    repo: REPO,
    tag,
    tarball_url: tarballUrl,
    resolved_at: new Date().toISOString()
  };

  writeReleaseMeta(metaPath, metadata);

  return {
    tag,
    sourceDir,
    cacheDir,
    metadata
  };
}

export function getStateFilePath() {
  return STATE_FILE;
}

export function loadState() {
  if (!existsSync(STATE_FILE)) {
    return {
      schema_version: STATE_SCHEMA_VERSION,
      updated_at: null,
      hosts: {}
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return { schema_version: STATE_SCHEMA_VERSION, updated_at: null, hosts: {} };
    }

    if (!parsed.hosts || typeof parsed.hosts !== 'object') {
      parsed.hosts = {};
    }

    parsed.schema_version = STATE_SCHEMA_VERSION;
    return parsed;
  } catch {
    return {
      schema_version: STATE_SCHEMA_VERSION,
      updated_at: null,
      hosts: {}
    };
  }
}

export function saveState(state) {
  const payload = {
    schema_version: STATE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    hosts: state?.hosts && typeof state.hosts === 'object' ? state.hosts : {}
  };

  ensureParentDir(STATE_FILE);
  writeFileSync(STATE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function setHostState(state, host, patch) {
  if (!state.hosts || typeof state.hosts !== 'object') {
    state.hosts = {};
  }

  const current = state.hosts[host] && typeof state.hosts[host] === 'object' ? state.hosts[host] : {};
  state.hosts[host] = {
    ...current,
    ...patch,
    last_updated_at: new Date().toISOString()
  };
}
