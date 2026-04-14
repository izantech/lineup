import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { initializeGitRepository, inspectGitProject } from "../lib/git.js";
import { printJson, printTableLine } from "../lib/output.js";
import { lineupProjectRoot, projectRoot } from "../lib/paths.js";
import type { GitProjectStatus } from "../lib/git.js";

export type InitCommandOptions = {
  json?: boolean;
  workflow?: string;
};

type InitEntry = {
  path: string;
  kind: "directory" | "file" | "repository";
  status: "created" | "already_exists";
};

export type InitCommandResult = {
  entries: InitEntry[];
  gitProject: GitProjectStatus;
};

const DEFAULT_WORKFLOW_TEMPLATE = `apiVersion: lineup/v3
kind: Workflow
name: full-pipeline
description: Default Lineup pipeline with all stages
stages:
  - id: triage
    type: builtin
    description: Analyze request and determine complexity
  - id: research
    type: agent
    agent: researcher
    description: Explore codebase and gather context
    depends_on: [triage]
  - id: plan
    type: agent
    agent: architect
    description: Design implementation plan
    depends_on: [research]
  - id: plan-approval
    type: approval
    description: User approves the plan
    depends_on: [plan]
  - id: implement
    type: agent
    agent: developer
    description: Implement the plan
    depends_on: [plan-approval]
  - id: verify
    type: agent
    agent: reviewer
    description: Verify implementation
    depends_on: [implement]
  - id: document
    type: agent
    agent: documenter
    description: Update documentation
    depends_on: [verify]
    optional: true
`;

const EXAMPLE_TACTIC = `apiVersion: lineup/v3
kind: Tactic
name: example
description: Example tactic — customize or replace this file
stages:
  - type: agent
    agent: researcher
    prompt: "Research the target area"
  - type: agent
    agent: architect
    prompt: "Design the changes"
    gate: approval
  - type: agent
    agent: developer
    prompt: "Implement the approved plan"
verification:
  - All changes compile without errors
  - Tests pass
`;

const GITIGNORE_CONTENT = `.runs/
.cache/
.ephemeral/
.artifacts/
runtime.lock
`;

function ensureDir(dirPath: string, entries: InitEntry[]): void {
  if (existsSync(dirPath)) {
    entries.push({ path: dirPath, kind: "directory", status: "already_exists" });
  } else {
    mkdirSync(dirPath, { recursive: true });
    entries.push({ path: dirPath, kind: "directory", status: "created" });
  }
}

function ensureFile(filePath: string, content: string, entries: InitEntry[]): void {
  if (existsSync(filePath)) {
    entries.push({ path: filePath, kind: "file", status: "already_exists" });
  } else {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, { flag: "wx" });
    entries.push({ path: filePath, kind: "file", status: "created" });
  }
}

export function initializeLineupProject(options: InitCommandOptions, cwd = process.cwd()): InitCommandResult {
  const lineupRoot = lineupProjectRoot(cwd);
  const root = projectRoot(cwd);
  const workflowName = options.workflow ?? "full-pipeline";
  const entries: InitEntry[] = [];

  // Directories
  ensureDir(path.join(lineupRoot, ".runs"), entries);
  ensureDir(path.join(lineupRoot, ".cache"), entries);
  ensureDir(path.join(lineupRoot, ".artifacts"), entries);
  ensureDir(path.join(lineupRoot, ".ephemeral"), entries);
  ensureDir(path.join(lineupRoot, "tactics"), entries);

  // Workflow file
  const workflowDir = path.join(root, ".lineup-core", "workflows");
  const workflowFile = path.join(workflowDir, `${workflowName}.yaml`);
  ensureFile(workflowFile, DEFAULT_WORKFLOW_TEMPLATE, entries);

  // Example tactic
  ensureFile(path.join(lineupRoot, "tactics", "example.yaml"), EXAMPLE_TACTIC, entries);

  // Gitignore
  ensureFile(path.join(lineupRoot, ".gitignore"), GITIGNORE_CONTENT, entries);

  let gitProject = inspectGitProject(root);
  if (!gitProject.isRepository) {
    initializeGitRepository(root);
    gitProject = inspectGitProject(root);
    entries.push({
      path: path.join(root, ".git"),
      kind: "repository",
      status: "created"
    });
  } else {
    entries.push({
      path: path.join(root, ".git"),
      kind: "repository",
      status: "already_exists"
    });
  }

  return {
    entries,
    gitProject
  };
}

export async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const { entries, gitProject } = initializeLineupProject(options);

  if (options.json) {
    printJson(entries);
    return;
  }

  for (const entry of entries) {
    const label = entry.status === "created" ? "created" : "already exists";
    printTableLine(`${label}: ${entry.path}`);
  }

  if (!gitProject.hasHeadCommit) {
    printTableLine('note: native Lineup runs require at least one git commit. Run `git add -A && git commit -m "Initial commit"` before `lineup run`.')
  }
}
