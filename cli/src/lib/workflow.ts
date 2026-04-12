import type { WorkflowDefinition } from "./types.js";

/**
 * Validate workflow DAG integrity. Throws on:
 * - depends_on referencing non-existent stage IDs
 * - Cycles in the dependency graph
 * - Input source referencing non-existent stages
 */
export function validateWorkflowDag(workflow: WorkflowDefinition): void {
  const stageIds = new Set(workflow.stages.map((s) => s.id));

  for (const stage of workflow.stages) {
    for (const dep of stage.depends_on ?? []) {
      if (!stageIds.has(dep)) {
        throw new Error(`Stage '${stage.id}' depends on unknown stage '${dep}'`);
      }
    }

    for (const input of stage.inputs ?? []) {
      if (!stageIds.has(input.source)) {
        throw new Error(`Stage '${stage.id}' references unknown input source '${input.source}'`);
      }
    }
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const stage of workflow.stages) {
    inDegree.set(stage.id, 0);
    adjacency.set(stage.id, []);
  }

  for (const stage of workflow.stages) {
    for (const dep of stage.depends_on ?? []) {
      adjacency.get(dep)!.push(stage.id);
      inDegree.set(stage.id, (inDegree.get(stage.id) ?? 0) + 1);
    }
  }

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
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const stage of workflow.stages) {
    inDegree.set(stage.id, 0);
    adjacency.set(stage.id, []);
  }

  for (const stage of workflow.stages) {
    for (const dep of stage.depends_on ?? []) {
      adjacency.get(dep)!.push(stage.id);
      inDegree.set(stage.id, (inDegree.get(stage.id) ?? 0) + 1);
    }
  }

  const waves: string[][] = [];
  let wave: string[] = [];

  for (const [id, degree] of inDegree) {
    if (degree === 0) wave.push(id);
  }

  while (wave.length > 0) {
    waves.push(wave);
    const nextWave: string[] = [];
    for (const node of wave) {
      for (const dependent of adjacency.get(node) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) nextWave.push(dependent);
      }
    }
    wave = nextWave;
  }

  return waves;
}
