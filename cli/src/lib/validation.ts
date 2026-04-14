import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseAllDocuments } from "yaml";

import { CliError } from "./errors.js";
import { packageRoot } from "./paths.js";
import type { InstallerState, ReleaseManifest, WorkflowDefinition } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);

const validators = new Map<string, ValidateFunction>();

function schemaPath(relativePath: string): string {
  return path.join(packageRoot(), "schemas", relativePath);
}

function loadValidator(relativePath: string): ValidateFunction {
  const key = relativePath;
  const existing = validators.get(key);
  if (existing) {
    return existing;
  }

  const content = readFileSync(schemaPath(relativePath), "utf8");
  const schema = JSON.parse(content);
  const compiled = ajv.compile(schema);
  validators.set(key, compiled);
  return compiled;
}

function formatErrors(validate: ValidateFunction): string {
  const lines = (validate.errors ?? []).map((error) => {
    const loc = error.instancePath || "/";
    return `- ${loc} ${error.message ?? "invalid"}`;
  });

  return lines.join("\n");
}

function assertValid(schemaRelPath: string, payload: unknown, label: string): void {
  const validate = loadValidator(schemaRelPath);
  const ok = validate(payload);
  if (!ok) {
    throw new CliError(`${label} failed schema validation:\n${formatErrors(validate)}`, {
      code: "schema_validation_failed"
    });
  }
}

export type HostAdapter = {
  host: string;
  vars: Record<string, string>;
};

export function validateHostAdapter(payload: unknown, source: string): HostAdapter {
  assertValid("json/host-adapter.schema.json", payload, `Host adapter ${source}`);
  return payload as HostAdapter;
}

export function validateInstallerState(payload: unknown, source: string): InstallerState {
  assertValid("json/state.schema.json", payload, `State file ${source}`);
  return payload as InstallerState;
}

export function validateReleaseManifest(payload: unknown, source: string): ReleaseManifest {
  assertValid("json/release-manifest.schema.json", payload, `Release manifest ${source}`);
  return payload as ReleaseManifest;
}

function validateYamlArtifact(schemaRelPath: string, content: string, source: string, label: string): void {
  const parsed = parseRestrictedYaml(content, source);
  assertValid(schemaRelPath, parsed, label);
}

function validateJsonArtifact(schemaRelPath: string, payload: unknown, source: string, label: string): void {
  assertValid(schemaRelPath, payload, label);
}

export function parseRestrictedYaml(content: string, source: string): unknown {
  const parsed = parseRestrictedYamlDocuments(content, source);
  if (parsed.length > 1) {
    throw new CliError(
      `${source}: YAML parse failed:\nSource contains multiple documents; please use YAML.parseAllDocuments().`,
      {
        code: "yaml_parse_failed"
      }
    );
  }
  return parsed[0];
}

export function parseRestrictedYamlDocuments(content: string, source: string): unknown[] {
  if (/(^|\s)&[A-Za-z0-9_-]+/m.test(content)) {
    throw new CliError(`${source}: YAML anchors are not allowed.`, {
      code: "yaml_anchor_not_allowed"
    });
  }

  if (/(^|\s)\*[A-Za-z0-9_-]+/m.test(content)) {
    throw new CliError(`${source}: YAML aliases are not allowed.`, {
      code: "yaml_alias_not_allowed"
    });
  }

  if (/(^|\s)![A-Za-z_][\w:-]*/m.test(content)) {
    throw new CliError(`${source}: YAML custom tags are not allowed.`, {
      code: "yaml_tag_not_allowed"
    });
  }

  const docs = parseAllDocuments(content, {
    uniqueKeys: true,
    merge: false
  });

  const errors = docs.flatMap((doc) => doc.errors);
  if (errors.length > 0) {
    const message = errors.map((item) => item.message).join("\n");
    throw new CliError(`${source}: YAML parse failed:\n${message}`, {
      code: "yaml_parse_failed"
    });
  }

  return docs.map((doc) => doc.toJSON());
}

export function selectRestrictedYamlDocument(
  content: string,
  source: string,
  options: {
    describe: string;
    normalize: (payload: unknown, index: number) => string | null;
  }
): string | null {
  const candidates = parseRestrictedYamlDocuments(content, source)
    .map((payload, index) => ({
      index,
      content: options.normalize(payload, index)
    }))
    .filter((candidate): candidate is { index: number; content: string } => Boolean(candidate.content));

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length > 1) {
    throw new CliError(
      `${source}: YAML parse failed:\nMultiple ${options.describe} YAML documents matched; cannot choose automatically.`,
      {
        code: "yaml_parse_failed"
      }
    );
  }

  return candidates[0].content;
}

export function validateTacticYaml(content: string, source: string): void {
  const parsed = parseRestrictedYaml(content, source);
  assertValid("yaml/tactic.schema.json", parsed, `Tactic YAML ${source}`);
}

export function parseWorkflowYaml(raw: string, source: string): WorkflowDefinition {
  const parsed = parseRestrictedYaml(raw, source);
  assertValid("yaml/workflow.schema.json", parsed, `Workflow YAML ${source}`);
  return parsed as WorkflowDefinition;
}

const AGENT_SCHEMA_MAP = {
  researcher: "yaml/agent-output/researcher.schema.json",
  architect: "yaml/agent-output/architect.schema.json",
  developer: "yaml/agent-output/developer.schema.json",
  reviewer: "yaml/agent-output/reviewer.schema.json",
  documenter: "yaml/agent-output/documenter.schema.json",
  teacher: "yaml/agent-output/teacher.schema.json"
} as const;

export type AgentOutputKind = keyof typeof AGENT_SCHEMA_MAP;

export function validateAgentOutputYaml(kind: AgentOutputKind, content: string, source: string): void {
  const parsed = parseRestrictedYaml(content, source);
  assertValid(AGENT_SCHEMA_MAP[kind], parsed, `${kind} output ${source}`);
}

export function validateConstitutionYaml(content: string, source: string): void {
  validateYamlArtifact("yaml/v3/constitution.schema.json", content, source, `Constitution ${source}`);
}

export function validateSpecYaml(content: string, source: string): void {
  validateYamlArtifact("yaml/v3/spec.schema.json", content, source, `Spec ${source}`);
}

export function validatePlanYaml(content: string, source: string): void {
  validateYamlArtifact("yaml/v3/plan.schema.json", content, source, `Plan ${source}`);
}

export function validateReviewYaml(content: string, source: string): void {
  validateYamlArtifact("yaml/v3/review.schema.json", content, source, `Review ${source}`);
}

export function validateConfigYaml(content: string, source: string): void {
  validateYamlArtifact("yaml/v3/config.schema.json", content, source, `Config ${source}`);
}

export function validateTasksJson(payload: unknown, source: string): void {
  validateJsonArtifact("json/v3/tasks.schema.json", payload, source, `Tasks ${source}`);
}

export function validateProtocolJson(payload: unknown, source: string): void {
  validateJsonArtifact("json/v3/protocol.schema.json", payload, source, `Protocol ${source}`);
}

export function validatePipelineStateJson(payload: unknown, source: string): void {
  validateJsonArtifact("json/v3/pipeline-state.schema.json", payload, source, `Pipeline state ${source}`);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readTextFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function listFilesWithExtension(directory: string, extension: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

export function validateSourceBundle(sourceRoot: string): void {
  const hostsDir = path.join(sourceRoot, ".lineup-core", "hosts");
  for (const hostFile of listFilesWithExtension(hostsDir, ".json")) {
    validateHostAdapter(readJsonFile(hostFile), hostFile);
  }

  const tacticsDir = path.join(sourceRoot, "tactics");
  for (const tacticFile of listFilesWithExtension(tacticsDir, ".yaml")) {
    validateTacticYaml(readTextFile(tacticFile), tacticFile);
  }

  const templateMap: Record<string, AgentOutputKind> = {
    researcher: "researcher",
    architect: "architect",
    developer: "developer",
    reviewer: "reviewer",
    documenter: "documenter",
    teacher: "teacher"
  };

  const templatesDir = path.join(sourceRoot, "templates");
  for (const [name, kind] of Object.entries(templateMap)) {
    const filePath = path.join(templatesDir, `${name}.yaml`);
    validateAgentOutputYaml(kind, readTextFile(filePath), filePath);
  }
}
