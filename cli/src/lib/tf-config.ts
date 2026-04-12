import { resolve } from "node:path";

import type { TfRole, WorkflowDefinition } from "./types.js";
import type { HostName } from "./constants.js";

export type TfGeneratorContext = {
  workflow: WorkflowDefinition;
  projectRoot: string;
  runId: string;
  adaptersDir: string;
  promptsDir: string;
  host: HostName;
  modelOverrides?: Partial<Record<TfRole, string>>;
  concurrency?: number;
  maxRetries?: number;
  timeout?: number;
};

const DEFAULT_MODELS: Record<HostName, string> = {
  claude: "claude-sonnet-4-6",
  codex: "codex-mini-latest",
  opencode: "anthropic/claude-sonnet-4-6"
};

function resolveModel(host: HostName, role: TfRole, overrides?: Partial<Record<TfRole, string>>): string {
  return overrides?.[role] ?? DEFAULT_MODELS[host];
}

function buildRoleSection(
  program: string,
  args: string[],
  env: Record<string, string>
): string {
  const argsYaml = args.map((a) => `"${a}"`).join(", ");
  const envLines = Object.entries(env)
    .map(([k, v]) => `    ${k}: "${v}"`)
    .join("\n");
  return `  program: ${program}\n  args: [${argsYaml}]\n  env:\n${envLines}`;
}

function buildRunnerSection(concurrency: number, maxRetries: number, projectRoot: string, timeout?: number): string {
  let result = `runner:
  output_dir: .runner-output
  max_retries: ${maxRetries}
  concurrency: ${concurrency}
  workspace_root: "${projectRoot}"
  scope_max_files: 12
  scope_max_file_bytes: 4000
  scope_max_tree_entries: 256
  manifest_max_tasks: 32
  excluded_paths: [.git, .runner-output, .lineup, node_modules, target]
  command_hooks: []`;
  if (timeout) {
    result += `\n  timeout_seconds: ${timeout}`;
  }
  return result;
}

export function generateTfConfig(ctx: TfGeneratorContext): string {
  const { workflow, projectRoot, adaptersDir, promptsDir, host, modelOverrides, concurrency = 4, maxRetries = 2, timeout } = ctx;

  const plannerAdapter = resolve(adaptersDir, "planner.sh");
  const workerAdapter = resolve(adaptersDir, "worker.sh");
  const validatorAdapter = resolve(adaptersDir, "validator.sh");

  const plannerPrompt = resolve(promptsDir, "planner-system.txt");
  const workerPrompt = resolve(promptsDir, "worker-system.txt");
  const validatorPrompt = resolve(promptsDir, "validator-system.txt");

  const runner = buildRunnerSection(concurrency, maxRetries, projectRoot, timeout);

  const plannerSection = buildRoleSection("bash", [plannerAdapter], {
    MODEL: resolveModel(host, "planner", modelOverrides),
    SYSTEM_PROMPT_FILE: plannerPrompt
  });

  const workerSection = buildRoleSection("bash", [workerAdapter], {
    MODEL: resolveModel(host, "worker", modelOverrides),
    SYSTEM_PROMPT_FILE: workerPrompt
  });

  const validatorSection = buildRoleSection("bash", [validatorAdapter], {
    MODEL: resolveModel(host, "validator", modelOverrides),
    SYSTEM_PROMPT_FILE: validatorPrompt
  });

  return `${runner}

planner:
${plannerSection}

worker:
${workerSection}

validator:
${validatorSection}
`;
}

export function generatePassthroughConfig(ctx: TfGeneratorContext, approvedManifestPath: string): string {
  const { projectRoot, adaptersDir, promptsDir, host, modelOverrides, concurrency = 4, maxRetries = 2, timeout } = ctx;

  const passthroughAdapter = resolve(adaptersDir, "passthrough-planner.sh");
  const workerAdapter = resolve(adaptersDir, "worker.sh");
  const validatorAdapter = resolve(adaptersDir, "validator.sh");

  const workerPrompt = resolve(promptsDir, "worker-system.txt");
  const validatorPrompt = resolve(promptsDir, "validator-system.txt");

  const absoluteManifestPath = resolve(approvedManifestPath);

  const runner = buildRunnerSection(concurrency, maxRetries, projectRoot, timeout);

  const plannerSection = buildRoleSection("bash", [passthroughAdapter], {
    APPROVED_MANIFEST_PATH: absoluteManifestPath
  });

  const workerSection = buildRoleSection("bash", [workerAdapter], {
    MODEL: resolveModel(host, "worker", modelOverrides),
    SYSTEM_PROMPT_FILE: workerPrompt
  });

  const validatorSection = buildRoleSection("bash", [validatorAdapter], {
    MODEL: resolveModel(host, "validator", modelOverrides),
    SYSTEM_PROMPT_FILE: validatorPrompt
  });

  return `${runner}

planner:
${plannerSection}

worker:
${workerSection}

validator:
${validatorSection}
`;
}
