import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { readArtifactContent, readArtifactDiff, readArtifactPath } from "../lib/tui-services.js";
import type { ArtifactKind } from "../lib/types.js";

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

export async function runArtifactsShowCommand(options: ArtifactsShowOptions): Promise<void> {
  assertValidKind(options.kind);
  try {
    const artifact = readArtifactContent(options.kind, options.run);
    if (options.json) {
      printJson({ run_id: artifact.runId, kind: options.kind, path: artifact.path, content: artifact.content });
      return;
    }
    printTableLine(artifact.content.trimEnd());
  } catch (error) {
    throw new CliError((error as Error).message, { code: "cli_error" });
  }
}

export async function runArtifactsPathCommand(options: ArtifactsPathOptions): Promise<void> {
  assertValidKind(options.kind);
  try {
    printTableLine(readArtifactPath(options.kind, options.run).path);
  } catch (error) {
    throw new CliError((error as Error).message, { code: "cli_error" });
  }
}

export async function runArtifactsDiffCommand(options: ArtifactsDiffOptions): Promise<void> {
  assertValidKind(options.kind);
  try {
    const diff = readArtifactDiff(options.kind, options.from, options.to);
    if (options.json) {
      printJson({
        from: diff.fromRunId,
        to: diff.toRunId,
        kind: diff.kind,
        changed: diff.changed,
        from_sha256: diff.fromSha256,
        to_sha256: diff.toSha256,
        from_path: diff.fromPath,
        to_path: diff.toPath,
        diff: diff.diff
      });
      return;
    }
    printTableLine(diff.header);
    if (!diff.changed) {
      printTableLine("No differences found.");
      return;
    }
    printTableLine("");
    printTableLine(diff.diff.trimEnd());
  } catch (error) {
    throw new CliError((error as Error).message, { code: "cli_error" });
  }
}
