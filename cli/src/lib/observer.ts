import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { createArtifactStore } from "./artifact-store.js";
import { lineupArtifactStoreDir, lineupRunsDir } from "./paths.js";
import { loadPipelineState } from "./state.js";
import type { ArtifactKind, ArtifactFormat, ObservedArtifact, ObservedPipelineRun, RuntimeStatus } from "./types.js";

const ARTIFACT_FORMAT_BY_KIND: Record<ArtifactKind, ArtifactFormat> = {
  constitution: "yaml",
  spec: "yaml",
  plan: "yaml",
  tasks: "json",
  review: "yaml",
  config: "yaml",
  protocol: "json",
  "pipeline-state": "json"
};

function compareRuns(left: ObservedPipelineRun, right: ObservedPipelineRun): number {
  return right.updated_at.localeCompare(left.updated_at) || right.run_id.localeCompare(left.run_id);
}

export function observePipelineRuns(cwd = process.cwd()): ObservedPipelineRun[] {
  const runsDir = lineupRunsDir(cwd);
  if (!existsSync(runsDir)) {
    return [];
  }

  const artifactStore = createArtifactStore(lineupArtifactStoreDir(cwd));
  const runs: ObservedPipelineRun[] = [];

  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const state = loadPipelineState(entry.name, cwd);
    if (!state) {
      continue;
    }

    const artifacts: ObservedArtifact[] = Object.entries(state.artifact_hashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, sha256]) => {
        const artifactKind = kind as ArtifactKind;
        const format = ARTIFACT_FORMAT_BY_KIND[artifactKind];
        const artifactPath = artifactStore.resolvePath(artifactKind, sha256, format);
        return {
          kind: artifactKind,
          format,
          sha256,
          path: artifactPath,
          exists: existsSync(artifactPath)
        };
      });

    runs.push({
      run_id: state.run_id,
      status: state.status,
      workflow: state.workflow ?? null,
      current_stage: state.current_stage ?? null,
      updated_at: state.updated_at,
      completed_stages: [...(state.completed_stages ?? [])],
      artifacts
    });
  }

  return runs.sort(compareRuns);
}

export function observeRuntimeStatus(cwd = process.cwd()): RuntimeStatus {
  const runs = observePipelineRuns(cwd);

  return {
    runs_dir: lineupRunsDir(cwd),
    artifact_store_dir: lineupArtifactStoreDir(cwd),
    run_count: runs.length,
    latest_run: runs[0] ?? null
  };
}
