import { readFileSync } from "node:fs";
import path from "node:path";

import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import {
  validateConstitutionYaml,
  validateSpecYaml,
  validatePlanYaml,
  validateReviewYaml,
  validateConfigYaml,
  validateTasksJson,
  validateProtocolJson,
  validatePipelineStateJson,
  parseRestrictedYaml
} from "../lib/validation.js";
import type { ArtifactKind } from "../lib/types.js";

export type ValidateCommandOptions = {
  file: string;
  kind?: string;
  json?: boolean;
};

const VALID_KINDS: ArtifactKind[] = [
  "constitution", "spec", "plan", "tasks", "review", "config", "protocol", "pipeline-state"
];

const FILENAME_KIND_MAP: Record<string, ArtifactKind> = {
  "constitution.yaml": "constitution",
  "spec.yaml": "spec",
  "plan.yaml": "plan",
  "tasks.json": "tasks",
  "review.yaml": "review",
  "config.yaml": "config",
  "protocol.json": "protocol",
  "pipeline-state.json": "pipeline-state",
};

function inferKind(filePath: string): ArtifactKind | null {
  const basename = path.basename(filePath);
  return FILENAME_KIND_MAP[basename] ?? null;
}

function runValidation(kind: ArtifactKind, filePath: string): void {
  const content = readFileSync(filePath, "utf8");

  switch (kind) {
    case "constitution":
      validateConstitutionYaml(content, filePath);
      break;
    case "spec":
      validateSpecYaml(content, filePath);
      break;
    case "plan":
      validatePlanYaml(content, filePath);
      break;
    case "review":
      validateReviewYaml(content, filePath);
      break;
    case "config":
      validateConfigYaml(content, filePath);
      break;
    case "tasks":
      validateTasksJson(JSON.parse(content), filePath);
      break;
    case "protocol":
      validateProtocolJson(JSON.parse(content), filePath);
      break;
    case "pipeline-state":
      validatePipelineStateJson(JSON.parse(content), filePath);
      break;
  }
}

export async function runValidateCommand(options: ValidateCommandOptions): Promise<void> {
  const filePath = path.resolve(options.file);

  let kind: ArtifactKind;
  if (options.kind) {
    if (!VALID_KINDS.includes(options.kind as ArtifactKind)) {
      throw new CliError(
        `Unknown artifact kind "${options.kind}". Valid kinds: ${VALID_KINDS.join(", ")}`,
        { code: "cli_error" }
      );
    }
    kind = options.kind as ArtifactKind;
  } else {
    const inferred = inferKind(filePath);
    if (!inferred) {
      throw new CliError(
        `Could not infer artifact kind from filename "${path.basename(filePath)}". Use --kind to specify. Valid kinds: ${VALID_KINDS.join(", ")}`,
        { code: "cli_error" }
      );
    }
    kind = inferred;
  }

  try {
    runValidation(kind, filePath);
  } catch (error) {
    if (options.json) {
      printJson({ valid: false, kind, file: filePath, errors: (error as Error).message });
      return;
    }
    printTableLine(`INVALID ${kind} artifact: ${filePath}`);
    printTableLine((error as Error).message);
    return;
  }

  if (options.json) {
    printJson({ valid: true, kind, file: filePath, errors: null });
    return;
  }

  printTableLine(`VALID ${kind} artifact: ${filePath}`);
}
