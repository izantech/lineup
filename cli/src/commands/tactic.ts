import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { tacticToWorkflow, type TacticDefinition } from "../lib/tactic-convert.js";
import { parseRestrictedYaml, validateTacticYaml } from "../lib/validation.js";

export type TacticNewOptions = {
  name: string;
};

export type TacticListOptions = {
  json?: boolean;
};

const TACTIC_SCAFFOLD = (name: string): string => `apiVersion: lineup/v3
kind: Tactic
name: ${name}
description: TODO — describe this tactic
variables: []
stages:
  - type: agent
    agent: researcher
    prompt: "TODO — research prompt"
  - type: agent
    agent: architect
    prompt: "TODO — planning prompt"
    gate: approval
  - type: agent
    agent: developer
    prompt: "TODO — implementation prompt"
verification:
  - TODO — add acceptance criteria
`;

export async function runTacticNewCommand(options: TacticNewOptions): Promise<void> {
  const tacticsDir = path.resolve(".lineup", "tactics");

  if (!existsSync(tacticsDir)) {
    mkdirSync(tacticsDir, { recursive: true });
  }

  const filePath = path.join(tacticsDir, `${options.name}.yaml`);

  try {
    writeFileSync(filePath, TACTIC_SCAFFOLD(options.name), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CliError(`Tactic already exists: ${filePath}`, { code: "cli_error" });
    }
    throw error;
  }

  printTableLine(filePath);
}

type TacticEntry = {
  name: string;
  description: string;
  stages: number;
};

function scanTactics(dir: string): TacticEntry[] {
  if (!existsSync(dir)) return [];

  const entries: TacticEntry[] = [];
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    const raw = readFileSync(filePath, "utf8");
    try {
      const parsed = parseRestrictedYaml(raw, filePath) as {
        name?: string;
        description?: string;
        stages?: unknown[];
      };
      const desc = parsed.description ?? "";
      entries.push({
        name: parsed.name ?? file.name.replace(/\.yaml$/, ""),
        description: desc.length > 60 ? desc.slice(0, 57) + "..." : desc,
        stages: Array.isArray(parsed.stages) ? parsed.stages.length : 0
      });
    } catch {
      entries.push({
        name: file.name.replace(/\.yaml$/, ""),
        description: "(invalid)",
        stages: 0
      });
    }
  }

  return entries;
}

export async function runTacticListCommand(options: TacticListOptions): Promise<void> {
  const dirs = [
    path.resolve(".lineup", "tactics"),
    path.resolve("tactics")
  ];

  const entries: TacticEntry[] = [];
  for (const dir of dirs) {
    entries.push(...scanTactics(dir));
  }

  if (options.json) {
    printJson(entries);
    return;
  }

  if (entries.length === 0) {
    printTableLine("No tactics found.");
    return;
  }

  for (const entry of entries) {
    printTableLine(`${entry.name}  ${entry.description}  ${entry.stages} stages`);
  }
}

export type TacticConvertOptions = {
  name: string;
  json?: boolean;
};

function resolveTacticFile(name: string): string {
  const candidates = [
    path.resolve(".lineup", "tactics", `${name}.yaml`),
    path.resolve("tactics", `${name}.yaml`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new CliError(`Tactic '${name}' not found. Searched: ${candidates.join(", ")}`, { code: "cli_error" });
}

export async function runTacticConvertCommand(options: TacticConvertOptions): Promise<void> {
  const tacticPath = resolveTacticFile(options.name);
  const raw = readFileSync(tacticPath, "utf8");
  validateTacticYaml(raw, tacticPath);
  const tacticDef = parseRestrictedYaml(raw, tacticPath) as TacticDefinition;
  const workflow = tacticToWorkflow(tacticDef);

  if (options.json) {
    printJson(workflow);
  } else {
    printTableLine(stringifyYaml(workflow, { lineWidth: 120 }));
  }
}
