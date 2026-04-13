import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { buildTaskWaves, type CompiledTask, type CompiledTasksArtifact } from "../lib/dag.js";
import { createArtifactStore } from "../lib/artifact-store.js";
import { lineupArtifactStoreDir, lineupRunArtifactsDir, lineupRunsDir } from "../lib/paths.js";
import { loadPipelineState } from "../lib/state.js";

export type WavesCommandOptions = {
  run?: string;
  json?: boolean;
  compact?: boolean;
};

export async function runWavesCommand(options: WavesCommandOptions): Promise<void> {
  const tasks = loadTasks(options.run);

  if (!tasks || tasks.length === 0) {
    throw new CliError("No compiled tasks found. Run the pipeline through the plan stage first.", {
      code: "invalid_path"
    });
  }

  const waves = buildTaskWaves(tasks);

  if (options.json) {
    const waveDetails = waves.map((taskIds, i) => ({
      wave: i + 1,
      parallelism: taskIds.length,
      tasks: taskIds.map(id => {
        const task = tasks.find(t => t.id === id)!;
        return {
          id: task.id,
          title: task.title,
          depends_on: task.depends_on ?? [],
          write_scope: task.write_scope ?? [],
        };
      })
    }));

    printJson({
      total_tasks: tasks.length,
      total_waves: waves.length,
      max_parallelism: Math.max(...waves.map(w => w.length)),
      waves: waveDetails
    });
    return;
  }

  printTableLine(`\nExecution Waves (${tasks.length} tasks → ${waves.length} waves)\n`);

  for (let i = 0; i < waves.length; i++) {
    const taskIds = waves[i];
    const parallelLabel = taskIds.length > 1 ? ` (${taskIds.length} parallel)` : "";
    printTableLine(`  Wave ${i + 1}${parallelLabel}`);

    for (const id of taskIds) {
      const task = tasks.find(t => t.id === id)!;
      if (options.compact) {
        printTableLine(`    ${task.id}  ${task.title}`);
      } else {
        const deps = task.depends_on?.length ? ` <- ${task.depends_on.join(", ")}` : "";
        const scope = task.write_scope?.join(", ") ?? "";
        printTableLine(`    ${task.id}  ${task.title}`);
        if (scope) printTableLine(`           writes: ${scope}`);
        if (deps) printTableLine(`           deps:${deps}`);
      }
    }
    printTableLine("");
  }

  const maxParallelism = Math.max(...waves.map(w => w.length));
  printTableLine(`  Max parallelism: ${maxParallelism}`);
  printTableLine(`  Sequential depth: ${waves.length}`);
  printTableLine("");
}

function loadTasks(runId?: string): CompiledTask[] | null {
  const cwd = process.cwd();
  const store = createArtifactStore(lineupArtifactStoreDir(cwd));

  // Try loading from a specific run's tasks artifact
  const targetRunId = runId ?? findLatestRun(cwd);
  if (!targetRunId) return null;

  const state = loadPipelineState(targetRunId, cwd);
  if (!state) return null;

  const tasksHash = state.artifact_hashes.tasks;
  if (tasksHash) {
    try {
      const content = store.readText({ kind: "tasks", format: "json", sha256: tasksHash });
      const parsed = JSON.parse(content) as CompiledTasksArtifact;
      return parsed.tasks;
    } catch { /* fall through */ }
  }

  // Try direct artifact file in run directory
  try {
    const artifactDir = lineupRunArtifactsDir(targetRunId, cwd);
    const raw = readFileSync(path.join(artifactDir, "tasks.json"), "utf8");
    const parsed = JSON.parse(raw) as CompiledTasksArtifact;
    return parsed.tasks;
  } catch { /* fall through */ }

  return null;
}

function findLatestRun(cwd: string): string | null {
  try {
    const runsDir = lineupRunsDir(cwd);
    const entries = readdirSync(runsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    if (entries.length === 0) return null;

    // Find the most recently modified run
    let latest: { name: string; mtime: number } | null = null;
    for (const name of entries) {
      try {
        const stateFile = path.join(runsDir, name, "pipeline-state.json");
        const raw = readFileSync(stateFile, "utf8");
        const parsed = JSON.parse(raw) as { updated_at?: string };
        const mtime = parsed.updated_at ? new Date(parsed.updated_at).getTime() : 0;
        if (!latest || mtime > latest.mtime) {
          latest = { name, mtime };
        }
      } catch { continue; }
    }

    return latest?.name ?? null;
  } catch {
    return null;
  }
}
