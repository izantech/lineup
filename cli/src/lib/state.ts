import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { HostName } from "./constants";
import { CliError } from "./errors";
import { lineupRunStateFile, lineupStateFile } from "./paths";
import type { HostState, InstallerState } from "./types";
import { validateInstallerState, validatePipelineStateJson } from "./validation";

export const STATE_SCHEMA_VERSION = 1;
export const PIPELINE_STATE_SCHEMA_VERSION = "lineup/v3" as const;

export type PipelineRunStatus = "pending" | "running" | "blocked" | "succeeded" | "failed" | "canceled";
export type PipelineArtifactKey = "constitution" | "spec" | "plan" | "tasks" | "review" | "config" | "protocol";

export type PipelineArtifactHashes = Partial<Record<PipelineArtifactKey, string>>;

export type PipelineStateRecord = {
  apiVersion: typeof PIPELINE_STATE_SCHEMA_VERSION;
  kind: "PipelineState";
  run_id: string;
  status: PipelineRunStatus;
  workflow?: string;
  git_tree_sha?: string;
  current_stage?: string;
  completed_stages?: string[];
  artifact_hashes: PipelineArtifactHashes;
  updated_at: string;
  errors?: Array<{
    code: string;
    message: string;
    details?: unknown;
  }>;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultState(): InstallerState {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    updated_at: null,
    hosts: {}
  };
}

export function loadState(filePath = lineupStateFile()): InstallerState {
  if (!existsSync(filePath)) {
    return defaultState();
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return validateInstallerState(parsed, filePath);
  } catch {
    return defaultState();
  }
}

export function saveState(state: InstallerState, filePath = lineupStateFile()): InstallerState {
  const payload: InstallerState = {
    schema_version: STATE_SCHEMA_VERSION,
    updated_at: nowIso(),
    hosts: state.hosts
  };

  const valid = validateInstallerState(payload, filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  return valid;
}

export function updateHostState(
  state: InstallerState,
  host: HostName,
  patch: Partial<Omit<HostState, "last_updated_at">>
): InstallerState {
  const previous: HostState = state.hosts[host] ?? {
    installed: false,
    last_action: null,
    last_updated_at: null
  };

  state.hosts[host] = {
    ...previous,
    ...patch,
    last_updated_at: new Date().toISOString()
  };

  return state;
}

export function defaultPipelineState(input: {
  runId: string;
  workflow: string;
  gitTreeSha?: string | null;
  status?: PipelineRunStatus;
  currentStage?: string;
  completedStages?: string[];
}): PipelineStateRecord {
  const state: PipelineStateRecord = {
    apiVersion: PIPELINE_STATE_SCHEMA_VERSION,
    kind: "PipelineState",
    run_id: input.runId,
    status: input.status ?? "pending",
    workflow: input.workflow,
    artifact_hashes: {},
    updated_at: nowIso()
  };

  if (input.gitTreeSha) {
    state.git_tree_sha = input.gitTreeSha;
  }

  if (input.currentStage) {
    state.current_stage = input.currentStage;
  }

  if (input.completedStages && input.completedStages.length > 0) {
    state.completed_stages = [...input.completedStages];
  }

  return state;
}

export function pipelineStateFile(runId: string, cwd = process.cwd()): string {
  return lineupRunStateFile(runId, cwd);
}

export function loadPipelineState(runId: string, cwd = process.cwd()): PipelineStateRecord | null {
  const filePath = pipelineStateFile(runId, cwd);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    validatePipelineStateJson(parsed, filePath);
    return parsed as PipelineStateRecord;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    throw new CliError(`Pipeline state ${filePath} is corrupted or unreadable.`, {
      code: "data_corruption"
    });
  }
}

export function savePipelineState(state: PipelineStateRecord, cwd = process.cwd()): PipelineStateRecord {
  const payload: PipelineStateRecord = {
    ...state,
    updated_at: nowIso()
  };

  const filePath = pipelineStateFile(state.run_id, cwd);
  validatePipelineStateJson(payload, filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function updatePipelineArtifactHashes(
  state: PipelineStateRecord,
  patch: Partial<Record<PipelineArtifactKey, string>>
): PipelineStateRecord {
  return {
    ...state,
    artifact_hashes: {
      ...state.artifact_hashes,
      ...patch
    },
    updated_at: nowIso()
  };
}

export function markPipelineCurrentStage(state: PipelineStateRecord, stage: string | null): PipelineStateRecord {
  const { current_stage: _currentStage, ...rest } = state;

  return {
    ...rest,
    ...(stage ? { current_stage: stage } : {}),
    updated_at: nowIso()
  };
}

export function appendPipelineCompletedStage(state: PipelineStateRecord, stage: string): PipelineStateRecord {
  const completed = new Set(state.completed_stages ?? []);
  completed.add(stage);

  return {
    ...state,
    completed_stages: [...completed],
    updated_at: nowIso()
  };
}

export function isPipelineStateStale(state: PipelineStateRecord, gitTreeSha: string | null | undefined): boolean {
  if (!state.git_tree_sha || !gitTreeSha) {
    return false;
  }

  return state.git_tree_sha !== gitTreeSha;
}

export function assertPipelineStateFresh(
  state: PipelineStateRecord,
  gitTreeSha: string | null | undefined
): PipelineStateRecord {
  if (isPipelineStateStale(state, gitTreeSha)) {
    throw new CliError(
      `Pipeline state was created for git tree ${state.git_tree_sha}, but the current tree is ${gitTreeSha}.`,
      {
        code: "state_mismatch"
      }
    );
  }

  return state;
}
