import type { WorkflowDefinition } from "./types.js";

type WorkflowGraph = {
  stageOrder: Map<string, number>;
  inDegree: Map<string, number>;
  adjacency: Map<string, string[]>;
};

function buildWorkflowGraph(workflow: WorkflowDefinition): WorkflowGraph {
  const stageOrder = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const seen = new Set<string>();

  workflow.stages.forEach((stage, index) => {
    if (seen.has(stage.id)) {
      throw new Error(`Workflow contains duplicate stage id: '${stage.id}'`);
    }
    seen.add(stage.id);
    stageOrder.set(stage.id, index);
    inDegree.set(stage.id, 0);
    adjacency.set(stage.id, []);
  });

  for (const stage of workflow.stages) {
    for (const dep of stage.depends_on ?? []) {
      if (!seen.has(dep)) {
        throw new Error(`Stage '${stage.id}' depends on unknown stage '${dep}'`);
      }
      adjacency.get(dep)!.push(stage.id);
      inDegree.set(stage.id, (inDegree.get(stage.id) ?? 0) + 1);
    }

    for (const input of stage.inputs ?? []) {
      if (!seen.has(input.source)) {
        throw new Error(`Stage '${stage.id}' references unknown input source '${input.source}'`);
      }
    }
  }

  const sortByStageOrder = (a: string, b: string): number => {
    const orderA = stageOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
    const orderB = stageOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.localeCompare(b);
  };

  for (const dependents of adjacency.values()) {
    dependents.sort(sortByStageOrder);
  }

  return { stageOrder, inDegree, adjacency };
}

/**
 * Validate workflow DAG integrity. Throws on:
 * - depends_on referencing non-existent stage IDs
 * - Cycles in the dependency graph
 * - Input source referencing non-existent stages
 */
export function validateWorkflowDag(workflow: WorkflowDefinition): void {
  const { inDegree, adjacency } = buildWorkflowGraph(workflow);

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    for (const dependent of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (processed < workflow.stages.length) {
    const remaining = workflow.stages
      .map((s) => s.id)
      .filter((id) => (inDegree.get(id) ?? 0) > 0)
      .join(", ");
    throw new Error(`Workflow contains a dependency cycle involving stages: ${remaining}`);
  }
}

/**
 * Topological sort of stages into execution waves.
 * Returns array of arrays: each inner array is a set of stages
 * that can run in parallel (all dependencies satisfied).
 * Uses Kahn's algorithm.
 */
export function resolveExecutionOrder(workflow: WorkflowDefinition): string[][] {
  const { stageOrder, inDegree, adjacency } = buildWorkflowGraph(workflow);

  const sortByStageOrder = (a: string, b: string): number => {
    const orderA = stageOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
    const orderB = stageOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.localeCompare(b);
  };

  const waves: string[][] = [];
  let wave = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort(sortByStageOrder);

  while (wave.length > 0) {
    waves.push(wave);
    const nextWave = new Set<string>();
    for (const node of wave) {
      for (const dependent of adjacency.get(node) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) nextWave.add(dependent);
      }
    }
    wave = [...nextWave].sort(sortByStageOrder);
  }

  return waves;
}
