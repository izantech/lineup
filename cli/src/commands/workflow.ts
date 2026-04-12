import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { parseWorkflowYaml } from "../lib/validation.js";
import { validateWorkflowDag, resolveExecutionOrder } from "../lib/workflow.js";

export type WorkflowLintOptions = {
  path: string;
  json?: boolean;
};

export type WorkflowListOptions = {
  json?: boolean;
};

export async function runWorkflowLintCommand(options: WorkflowLintOptions): Promise<void> {
  const filePath = path.resolve(options.path);

  if (!existsSync(filePath)) {
    throw new CliError(`File not found: ${filePath}`, { code: "invalid_path" });
  }

  const raw = readFileSync(filePath, "utf8");
  const errors: string[] = [];

  let workflow;
  try {
    workflow = parseWorkflowYaml(raw, filePath);
  } catch (error) {
    errors.push((error as Error).message);
  }

  if (workflow) {
    try {
      validateWorkflowDag(workflow);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  let waves: string[][] = [];
  if (workflow && errors.length === 0) {
    try {
      waves = resolveExecutionOrder(workflow);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  if (errors.length > 0) {
    if (options.json) {
      printJson({ valid: false, errors, stages: workflow?.stages.length ?? 0, waves: 0 });
      return;
    }
    for (const err of errors) {
      printTableLine(err);
    }
    return;
  }

  const stageCount = workflow!.stages.length;
  const waveCount = waves.length;

  if (options.json) {
    printJson({ valid: true, errors: [], stages: stageCount, waves: waveCount });
    return;
  }

  printTableLine(`Valid workflow: ${workflow!.name} (${stageCount} stages, ${waveCount} waves)`);
}

export async function runWorkflowListCommand(options: WorkflowListOptions): Promise<void> {
  const dirs = [
    path.resolve(".lineup-core", "workflows"),
    path.resolve(".lineup", "workflows")
  ];

  const entries: { file: string; name: string; stages: number; apiVersion: string }[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const file of files) {
      const filePath = path.join(dir, file.name);
      const raw = readFileSync(filePath, "utf8");
      try {
        const workflow = parseWorkflowYaml(raw, filePath);
        entries.push({
          file: file.name,
          name: workflow.name,
          stages: workflow.stages.length,
          apiVersion: workflow.apiVersion
        });
      } catch {
        entries.push({
          file: file.name,
          name: "(invalid)",
          stages: 0,
          apiVersion: "unknown"
        });
      }
    }
  }

  if (options.json) {
    printJson(entries);
    return;
  }

  if (entries.length === 0) {
    printTableLine("No workflows found.");
    return;
  }

  for (const entry of entries) {
    printTableLine(`${entry.file}  ${entry.name}  ${entry.stages} stages  ${entry.apiVersion}`);
  }
}
