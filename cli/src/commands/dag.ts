import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { parseWorkflowYaml } from "../lib/validation.js";
import { validateWorkflowDag, resolveExecutionOrder } from "../lib/workflow.js";
import type { WorkflowDefinition } from "../lib/types.js";

export type DagCommandOptions = {
  workflow?: string;
  json?: boolean;
};

function findDefaultWorkflow(): string {
  const candidates = [
    path.resolve(".lineup-core", "workflows", "full-pipeline.yaml"),
    path.resolve(".lineup", "workflows", "full-pipeline.yaml")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new CliError("No workflow found. Specify one with --workflow <path>.", { code: "invalid_path" });
}

function loadWorkflow(workflowPath?: string): WorkflowDefinition {
  const filePath = workflowPath ? path.resolve(workflowPath) : findDefaultWorkflow();

  if (!existsSync(filePath)) {
    throw new CliError(`File not found: ${filePath}`, { code: "invalid_path" });
  }

  const raw = readFileSync(filePath, "utf8");
  const workflow = parseWorkflowYaml(raw, filePath);
  validateWorkflowDag(workflow);
  return workflow;
}

export async function runDagCommand(options: DagCommandOptions): Promise<void> {
  const workflow = loadWorkflow(options.workflow);
  const waves = resolveExecutionOrder(workflow);
  const stageMap = new Map(workflow.stages.map(s => [s.id, s]));

  if (options.json) {
    printJson({
      waves,
      stages: workflow.stages.map(s => ({
        id: s.id,
        type: s.type,
        agent: s.agent ?? null,
        depends_on: s.depends_on ?? []
      }))
    });
    return;
  }

  for (let i = 0; i < waves.length; i++) {
    const waveLabel = `Wave ${i + 1}: ${waves[i].join(", ")}`;
    printTableLine(waveLabel);
  }

  printTableLine("");

  const allStages = waves.flat();
  for (let i = 0; i < allStages.length; i++) {
    const stageId = allStages[i];
    const stage = stageMap.get(stageId);
    const suffix = stage?.optional ? " (optional)" : "";
    const indent = i === 0 ? "" : "  ".repeat(i) + "\u2514\u2500> ";
    printTableLine(`${indent}${stageId}${suffix}`);
  }
}
