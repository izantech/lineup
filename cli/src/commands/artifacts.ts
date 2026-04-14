import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { CliError } from "../lib/errors.js";
import { createArtifactStore } from "../lib/artifact-store.js";
import { formatArtifactDiffHeader } from "../lib/inspection.js";
import { observePipelineRuns } from "../lib/observer.js";
import { printJson, printTableLine } from "../lib/output.js";
import type { ArtifactKind, ObservedPipelineRun } from "../lib/types.js";

const VALID_KINDS: ArtifactKind[] = [
  "constitution", "spec", "plan", "tasks", "review", "config", "protocol", "pipeline-state"
];

export type ArtifactsShowOptions = {
  kind: string;
  run?: string;
  json?: boolean;
};

export type ArtifactsPathOptions = {
  kind: string;
  run?: string;
};

export type ArtifactsDiffOptions = {
  kind: string;
  from?: string;
  to?: string;
  json?: boolean;
};

function assertValidKind(kind: string): asserts kind is ArtifactKind {
  if (!VALID_KINDS.includes(kind as ArtifactKind)) {
    throw new CliError(
      `Unknown artifact kind "${kind}". Valid kinds: ${VALID_KINDS.join(", ")}`,
      { code: "cli_error" }
    );
  }
}

function findRun(runs: ObservedPipelineRun[], runId?: string): ObservedPipelineRun {
  if (!runId) {
    const latest = runs[0];
    if (!latest) {
      throw new CliError("No pipeline runs found.", { code: "cli_error" });
    }
    return latest;
  }

  const run = runs.find((r) => r.run_id === runId);
  if (!run) {
    throw new CliError(`Run "${runId}" not found.`, { code: "cli_error" });
  }
  return run;
}

function findArtifact(run: ObservedPipelineRun, kind: ArtifactKind) {
  const artifact = run.artifacts.find((a) => a.kind === kind);
  if (!artifact) {
    throw new CliError(`Artifact "${kind}" not found in run "${run.run_id}".`, { code: "cli_error" });
  }
  if (!artifact.exists) {
    throw new CliError(`Artifact "${kind}" in run "${run.run_id}" is missing from the store (${artifact.path}).`, { code: "cli_error" });
  }
  return artifact;
}

export async function runArtifactsShowCommand(options: ArtifactsShowOptions): Promise<void> {
  assertValidKind(options.kind);
  const runs = observePipelineRuns();
  const run = findRun(runs, options.run);
  const artifact = findArtifact(run, options.kind);
  const content = readFileSync(artifact.path, "utf8");

  if (options.json) {
    printJson({ run_id: run.run_id, kind: options.kind, sha256: artifact.sha256, content });
    return;
  }

  printTableLine(content.trimEnd());
}

export async function runArtifactsPathCommand(options: ArtifactsPathOptions): Promise<void> {
  assertValidKind(options.kind);
  const runs = observePipelineRuns();
  const run = findRun(runs, options.run);
  const artifact = findArtifact(run, options.kind);
  printTableLine(artifact.path);
}

export async function runArtifactsDiffCommand(options: ArtifactsDiffOptions): Promise<void> {
  assertValidKind(options.kind);
  const runs = observePipelineRuns();

  if (runs.length < 2 && !options.from) {
    throw new CliError("Need at least two runs to diff. Use --from and --to to specify run IDs.", { code: "cli_error" });
  }

  const toRun = findRun(runs, options.to);
  const fromRun = findRun(runs, options.from ?? runs[1]?.run_id);

  const fromArtifact = findArtifact(fromRun, options.kind);
  const toArtifact = findArtifact(toRun, options.kind);

  const fromContent = readFileSync(fromArtifact.path, "utf8");
  const toContent = readFileSync(toArtifact.path, "utf8");

  if (fromContent === toContent) {
    if (options.json) {
      printJson({
        from: fromRun.run_id,
        to: toRun.run_id,
        kind: options.kind,
        changed: false,
        from_sha256: fromArtifact.sha256,
        to_sha256: toArtifact.sha256,
        from_path: fromArtifact.path,
        to_path: toArtifact.path,
        diff: ""
      });
      return;
    }
    printTableLine(formatArtifactDiffHeader(options.kind, fromRun.run_id, toRun.run_id, fromArtifact.sha256, toArtifact.sha256));
    printTableLine("No differences found.");
    return;
  }

  let diff: string;
  try {
    execSync("which diff", { stdio: "ignore" });
    diff = execSync(
      `diff -u --label "${options.kind}@${fromRun.run_id}" --label "${options.kind}@${toRun.run_id}" "${fromArtifact.path}" "${toArtifact.path}"`,
      { encoding: "utf8" }
    );
  } catch (error) {
    const execError = error as { stdout?: string; status?: number };
    if (execError.status === 1 && execError.stdout) {
      diff = execError.stdout;
    } else {
      // Fallback: simple output of both
      diff = `--- ${options.kind}@${fromRun.run_id}\n+++ ${options.kind}@${toRun.run_id}\n`;
      const fromLines = fromContent.split("\n");
      const toLines = toContent.split("\n");
      for (const line of fromLines) {
        diff += `-${line}\n`;
      }
      for (const line of toLines) {
        diff += `+${line}\n`;
      }
    }
  }

  if (options.json) {
    printJson({
      from: fromRun.run_id,
      to: toRun.run_id,
      kind: options.kind,
      changed: true,
      from_sha256: fromArtifact.sha256,
      to_sha256: toArtifact.sha256,
      from_path: fromArtifact.path,
      to_path: toArtifact.path,
      diff
    });
    return;
  }

  printTableLine(formatArtifactDiffHeader(options.kind, fromRun.run_id, toRun.run_id, fromArtifact.sha256, toArtifact.sha256));
  printTableLine("");
  printTableLine(diff.trimEnd());
}
