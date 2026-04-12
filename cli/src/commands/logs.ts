import { existsSync, readFileSync } from "node:fs";

import { createArtifactStore } from "../lib/artifact-store.js";
import { CliError } from "../lib/errors.js";
import { lineupArtifactStoreDir, lineupRunDebugBundleFile } from "../lib/paths.js";
import { printJson, printTableLine } from "../lib/output.js";
import { loadPipelineState } from "../lib/state.js";

export type LogsCommandOptions = {
  runId: string;
  json?: boolean;
};

export async function runLogsCommand(options: LogsCommandOptions): Promise<void> {
  const state = loadPipelineState(options.runId);

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: "invalid_path" });
  }

  const protocolHash = state.artifact_hashes.protocol;
  const debugBundlePath = lineupRunDebugBundleFile(options.runId);

  const messages: unknown[] = [];

  if (protocolHash) {
    const store = createArtifactStore(lineupArtifactStoreDir());
    const content = store.readText({ kind: "protocol", format: "json", sha256: protocolHash });
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        messages.push(JSON.parse(trimmed));
      } catch {
        messages.push({ raw: trimmed });
      }
    }
  }

  if (existsSync(debugBundlePath)) {
    try {
      const raw = readFileSync(debugBundlePath, "utf8");
      messages.push({ type: "debug-bundle", data: JSON.parse(raw) });
    } catch {
      messages.push({ type: "debug-bundle", error: "unreadable" });
    }
  }

  if (messages.length === 0) {
    throw new CliError(`No protocol logs found for run ${options.runId}`, { code: "invalid_path" });
  }

  if (options.json) {
    printJson(messages);
    return;
  }

  for (const msg of messages) {
    printTableLine(JSON.stringify(msg));
  }
}
