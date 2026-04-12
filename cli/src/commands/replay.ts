import { createArtifactStore } from "../lib/artifact-store.js";
import { CliError } from "../lib/errors.js";
import { lineupArtifactStoreDir } from "../lib/paths.js";
import { printJson, printTableLine } from "../lib/output.js";
import { loadPipelineState } from "../lib/state.js";
import { isJsonRpcRequest, isJsonRpcNotification, isJsonRpcSuccessResponse, isJsonRpcMessage } from "../lib/protocol.js";

export type ReplayCommandOptions = { runId: string; json?: boolean };

type ReplayEvent = {
  offsetMs: number;
  label: string;
  raw: Record<string, unknown>;
};

function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
}

export async function runReplayCommand(options: ReplayCommandOptions, cwd?: string): Promise<void> {
  const state = loadPipelineState(options.runId, cwd);

  if (!state) {
    throw new CliError(`Run not found: ${options.runId}`, { code: "invalid_path" });
  }

  const protocolHash = state.artifact_hashes.protocol;

  if (!protocolHash) {
    throw new CliError(`No protocol logs found for run ${options.runId}`, { code: "invalid_path" });
  }

  const store = createArtifactStore(lineupArtifactStoreDir(cwd));
  const content = store.readText({ kind: "protocol", format: "json", sha256: protocolHash });

  let rawMessages: unknown[];
  try {
    const parsed = JSON.parse(content) as unknown;
    rawMessages = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    rawMessages = content
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => { try { return JSON.parse(l) as unknown; } catch { return null; } })
      .filter(Boolean) as unknown[];
  }

  const messages = rawMessages.filter(isJsonRpcMessage);

  const events: ReplayEvent[] = [];
  let seq = 0;

  for (const msg of messages) {
    const offsetMs = seq * 1000;

    if (isJsonRpcRequest(msg)) {
      const method = msg.method;
      const params = (msg as Record<string, unknown>).params as Record<string, unknown> | undefined;

      if (method === "agent/spawn") {
        const stageId = (params?.stageId as string) ?? "unknown";
        events.push({ offsetMs, label: `Stage "${stageId}" started`, raw: msg as Record<string, unknown> });
        seq++;
      } else if (method === "gate/request") {
        const stageId = (params?.stageId as string) ?? "unknown";
        const gateType = (params?.gateType as string) ?? "unknown";
        events.push({ offsetMs, label: `Gate "${stageId}" requested (${gateType})`, raw: msg as Record<string, unknown> });
        seq++;
      }
    } else if (isJsonRpcNotification(msg)) {
      const method = msg.method;
      const params = (msg as Record<string, unknown>).params as Record<string, unknown> | undefined;

      if (method === "agent/done") {
        const stageId = (params?.stageId as string) ?? "unknown";
        const status = (params?.status as string) ?? "unknown";
        events.push({ offsetMs, label: `Stage "${stageId}" completed (${status})`, raw: msg as Record<string, unknown> });
        seq++;
      } else if (method === "pipeline/complete") {
        const status = (params?.status as string) ?? "unknown";
        events.push({ offsetMs, label: `Pipeline completed (${status})`, raw: msg as Record<string, unknown> });
        seq++;
      } else if (method === "agent/cancel") {
        const stageId = (params?.stageId as string) ?? "unknown";
        events.push({ offsetMs, label: `Stage "${stageId}" cancelled`, raw: msg as Record<string, unknown> });
        seq++;
      }
    } else if (isJsonRpcSuccessResponse(msg)) {
      const result = (msg as Record<string, unknown>).result as Record<string, unknown> | undefined;
      if (result && "choice" in result) {
        const choice = result.choice as string;
        const approved = result.approved as boolean | undefined;
        const decision = approved === false ? "rejected" : "approved";
        events.push({ offsetMs, label: `Gate responded — ${decision} (${choice})`, raw: msg as Record<string, unknown> });
        seq++;
      }
    }
  }

  if (options.json) {
    printJson(events.map((e) => ({ offsetMs: e.offsetMs, label: e.label })));
    return;
  }

  if (events.length === 0) {
    printTableLine("No key events found in protocol log.");
    return;
  }

  const baseMs = events[0]!.offsetMs;
  for (const event of events) {
    printTableLine(`${formatOffset(event.offsetMs - baseMs)} ${event.label}`);
  }
}
