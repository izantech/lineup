import { createHash } from "node:crypto";
import path from "node:path";

type PlanChange = {
  file: string;
  change: string;
  rationale: string;
};

type PlanDependency = {
  from_change: number;
  to_change: number;
  description: string;
};

type PlanBatch = {
  batch_number: number;
  execution: "parallel" | "serial";
  changes: number[];
  rationale: string;
};

type PlanParallelizationStrategy = {
  batches?: PlanBatch[];
  default_recommendation?: "parallel" | "serial";
  rationale?: string;
};

export type ApprovedPlan = {
  apiVersion: "lineup/v3";
  kind: "Plan";
  status: "approved";
  summary: string;
  approaches: unknown[];
  recommendation: {
    approach: string;
    rationale: string;
  };
  changes: PlanChange[];
  acceptance_criteria: unknown[];
  risks: unknown[];
  dependencies?: PlanDependency[];
  parallelization_strategy?: PlanParallelizationStrategy;
};

export type CompiledTask = {
  id: string;
  title: string;
  wave: number;
  status: "todo";
  depends_on?: string[];
  read_scope?: string[];
  write_scope?: string[];
  deliverables?: string[];
};

export type CompiledTasksArtifact = {
  apiVersion: "lineup/v3";
  kind: "Tasks";
  plan_hash: string;
  git_tree_sha?: string;
  compiled_at: string;
  tasks: CompiledTask[];
};

export type CompilePlanOptions = {
  compiledAt?: string;
  gitTreeSha?: string;
  planHash?: string;
};

export type CompilePlanResult = {
  artifact: CompiledTasksArtifact;
  waves: string[][];
};

type CompiledNode = {
  index: number;
  id: string;
  writeScope: string[];
  readScope: string[];
  dependsOn: string[];
  task: CompiledTask;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, next]) => next !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, next]) => `${JSON.stringify(key)}:${stableSerialize(next)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashPlan(plan: ApprovedPlan): string {
  return createHash("sha256").update(stableSerialize(plan)).digest("hex");
}

function normalizeRepoRelativePath(input: string, label: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`${label} must be a non-empty repo-relative path`);
  }

  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`${label} must be a repo-relative path, not absolute: '${input}'`);
  }

  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${label} escapes the repository root: '${input}'`);
  }

  return normalized;
}

function pathSegmentsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  for (const candidate of left) {
    for (const existing of right) {
      if (pathSegmentsOverlap(candidate, existing)) {
        return true;
      }
    }
  }

  return false;
}

function compileNodes(plan: ApprovedPlan): CompiledNode[] {
  if (plan.status !== "approved") {
    throw new Error(`Plan must be approved before compilation; received '${plan.status}'`);
  }

  if (plan.kind !== "Plan" || plan.apiVersion !== "lineup/v3") {
    throw new Error("Plan compiler only accepts lineup/v3 Plan artifacts");
  }

  if (plan.changes.length === 0) {
    throw new Error("Plan does not contain any changes");
  }

  const changeCount = plan.changes.length;
  const normalizedFiles = plan.changes.map((change, index) => {
    const file = normalizeRepoRelativePath(change.file, `changes[${index + 1}].file`);
    if (!change.change.trim()) {
      throw new Error(`changes[${index + 1}].change must be non-empty`);
    }
    if (!change.rationale.trim()) {
      throw new Error(`changes[${index + 1}].rationale must be non-empty`);
    }
    return file;
  });

  const dependencyEdges = new Map<number, Set<number>>();
  const dependsOn = new Map<number, string[]>();
  for (let index = 1; index <= changeCount; index++) {
    dependencyEdges.set(index, new Set<number>());
    dependsOn.set(index, []);
  }

  for (const dependency of plan.dependencies ?? []) {
    const fromIndex = dependency.from_change;
    const toIndex = dependency.to_change;

    if (!Number.isInteger(fromIndex) || fromIndex < 1 || fromIndex > changeCount) {
      throw new Error(`Dependency references unknown from_change ${fromIndex}`);
    }
    if (!Number.isInteger(toIndex) || toIndex < 1 || toIndex > changeCount) {
      throw new Error(`Dependency references unknown to_change ${toIndex}`);
    }
    if (fromIndex === toIndex) {
      throw new Error(`Change ${fromIndex} cannot depend on itself`);
    }

    dependencyEdges.get(fromIndex)!.add(toIndex);
  }

  for (let index = 1; index <= changeCount; index++) {
    const deps = [...(dependencyEdges.get(index) ?? new Set<number>())]
      .sort((left, right) => left - right)
      .map((dependencyIndex) => `CHANGE-${String(dependencyIndex).padStart(3, "0")}`);
    dependsOn.set(index, deps);
  }

  const compiledNodes = plan.changes.map((change, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    const id = `CHANGE-${String(index).padStart(3, "0")}`;
    const writeScope = [normalizedFiles[zeroBasedIndex]];
    const readScope = [...new Set(dependsOn.get(index)!.flatMap((dependencyId) => {
      const dependencyIndex = Number.parseInt(dependencyId.split("-").pop() ?? "", 10);
      return normalizedFiles[dependencyIndex - 1] ? [normalizedFiles[dependencyIndex - 1]] : [];
    }))];
    const task: CompiledTask = {
      id,
      title: change.change.trim(),
      wave: 0,
      status: "todo",
      ...(dependsOn.get(index)!.length > 0 ? { depends_on: dependsOn.get(index)! } : {}),
      ...(readScope.length > 0 ? { read_scope: readScope } : {}),
      write_scope: writeScope,
      deliverables: [normalizedFiles[zeroBasedIndex]],
    };

    return {
      index,
      id,
      writeScope,
      readScope,
      dependsOn: dependsOn.get(index)!,
      task,
    };
  });

  return compiledNodes;
}

function sortCandidates(left: CompiledNode, right: CompiledNode): number {
  return left.index - right.index || left.id.localeCompare(right.id);
}

function conflictsWithWave(candidate: CompiledNode, wave: CompiledNode[]): boolean {
  for (const selected of wave) {
    if (scopesOverlap(candidate.writeScope, selected.writeScope)) {
      return true;
    }
    if (scopesOverlap(candidate.writeScope, selected.readScope)) {
      return true;
    }
    if (scopesOverlap(candidate.readScope, selected.writeScope)) {
      return true;
    }
  }

  return false;
}

function assertAcyclicCompletion(remaining: CompiledNode[], readyCount: number): never {
  const ids = remaining.map((node) => node.id).join(", ");
  if (readyCount === 0) {
    throw new Error(`Plan dependency graph contains a cycle involving: ${ids}`);
  }
  throw new Error(`Plan scheduler could not place remaining tasks: ${ids}`);
}

export function buildTaskWaves(tasks: readonly CompiledTask[]): string[][] {
  const nodes = tasks.map((task, index) => ({
    index: index + 1,
    id: task.id,
    writeScope: task.write_scope ?? [],
    readScope: task.read_scope ?? [],
    dependsOn: task.depends_on ?? [],
    task,
  }));

  const taskById = new Map(nodes.map((node) => [node.id, node] as const));
  const remaining = new Map(nodes.map((node) => [node.id, node] as const));
  const completed = new Set<string>();
  const waves: string[][] = [];

  for (const node of nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!taskById.has(dependencyId)) {
        throw new Error(`Task ${node.id} depends on unknown task ${dependencyId}`);
      }
    }
  }

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dependencyId) => completed.has(dependencyId)))
      .sort(sortCandidates);

    if (ready.length === 0) {
      assertAcyclicCompletion([...remaining.values()], ready.length);
    }

    const wave: CompiledNode[] = [];
    for (const candidate of ready) {
      if (!conflictsWithWave(candidate, wave)) {
        wave.push(candidate);
      }
    }

    if (wave.length === 0) {
      assertAcyclicCompletion([...remaining.values()], ready.length);
    }

    waves.push(wave.map((node) => node.id));
    for (const node of wave) {
      completed.add(node.id);
      remaining.delete(node.id);
    }
  }

  return waves;
}

export function compilePlanToTasks(plan: ApprovedPlan, options: CompilePlanOptions = {}): CompilePlanResult {
  const nodes = compileNodes(plan);
  const artifactTasks = nodes.map((node) => ({ ...node.task }));
  const waves = buildTaskWaves(artifactTasks);
  const waveById = new Map<string, number>();

  waves.forEach((wave, waveIndex) => {
    for (const id of wave) {
      waveById.set(id, waveIndex + 1);
    }
  });

  const tasks = artifactTasks.map((task) => ({
    ...task,
    wave: waveById.get(task.id) ?? 0,
  }));

  return {
    artifact: {
      apiVersion: "lineup/v3",
      kind: "Tasks",
      plan_hash: options.planHash ?? hashPlan(plan),
      ...(options.gitTreeSha ? { git_tree_sha: options.gitTreeSha } : {}),
      compiled_at: options.compiledAt ?? new Date().toISOString(),
      tasks,
    },
    waves,
  };
}

export function resolvePlanTaskGraph(plan: ApprovedPlan, options: CompilePlanOptions = {}): CompilePlanResult {
  return compilePlanToTasks(plan, options);
}
