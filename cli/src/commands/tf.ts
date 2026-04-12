import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import type { TfGenerateOptions } from "../lib/types.js";
import type { HostName } from "../lib/constants.js";
import { parseWorkflowYaml } from "../lib/validation.js";
import { generateTfAdapters, type AdapterGenerationContext } from "../lib/tf-adapters.js";
import { generateTfConfig, generatePassthroughConfig, type TfGeneratorContext } from "../lib/tf-config.js";

export async function runTfGenerateCommand(options: TfGenerateOptions): Promise<void> {
  const projectRoot = resolve(".");

  const workflowPath = options.workflow ?? findDefaultWorkflow();
  const raw = readFileSync(workflowPath, "utf-8");
  const workflow = parseWorkflowYaml(raw, workflowPath);

  const host = options.host ? (options.host as HostName) : detectHost();

  const outputDir = resolve(options.output ?? resolve(projectRoot, ".lineup", ".ephemeral", "tf"));
  mkdirSync(outputDir, { recursive: true });

  const adaptersDir = resolve(outputDir, "adapters");
  const adaptersCtx: AdapterGenerationContext = {
    host,
    adaptersSourceDir: resolve(projectRoot, ".lineup-core", "adapters"),
    promptsSourceDir: resolve(projectRoot, ".lineup-core", "prompts"),
    outputDir: adaptersDir,
    agentsDir: resolve(projectRoot, "agents"),
    modelMap: {
      scope_selector: "",
      planner: "claude-sonnet-4-6",
      worker: "claude-sonnet-4-6",
      validator: "claude-sonnet-4-6",
    },
  };
  const adapterPaths = generateTfAdapters(adaptersCtx);

  const tfCtx: TfGeneratorContext = {
    workflow,
    projectRoot,
    runId: "tf-generate",
    adaptersDir,
    promptsDir: adaptersDir,
    host,
  };

  const configYaml = options.manifestPath
    ? generatePassthroughConfig(tfCtx, options.manifestPath)
    : generateTfConfig(tfCtx);

  const configPath = resolve(outputDir, "tf-config.yaml");
  writeFileSync(configPath, configYaml, "utf-8");

  console.log(JSON.stringify({ configPath, adapters: adapterPaths }, null, 2));
}

function findDefaultWorkflow(): string {
  const candidates = [
    resolve(".lineup-core", "workflows", "full-pipeline.yaml"),
    resolve(".lineup", "workflows", "full-pipeline.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("No workflow file found. Specify one with --workflow <path>.");
}

function detectHost(): HostName {
  try { execSync("which claude", { stdio: "ignore" }); return "claude"; } catch {}
  try { execSync("which codex", { stdio: "ignore" }); return "codex"; } catch {}
  try { execSync("which opencode", { stdio: "ignore" }); return "opencode"; } catch {}
  throw new Error("No supported host CLI found (claude, codex, or opencode).");
}
