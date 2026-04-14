import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";

import { SUPPORTED_HOSTS, type HostName } from "./constants.js";
import { CliError } from "./errors.js";
import { repairJsonOutput, repairYamlOutput } from "./llm-output-repair.js";
import { planHostLaunch } from "./launch-planner.js";
import { parseRestrictedYaml } from "./validation.js";
import type { AgentRole } from "./types.js";

export type LocalAgentInvocationInput = {
  projectRoot: string;
  workingDirectory: string;
  agent: AgentRole;
  prompt: string;
  timeoutMs?: number;
  addDirs?: string[];
  outputSchemaPath?: string;
  expectedOutputPath?: string;
  tracePrefixPath?: string;
};

export type LocalAgentInvocationResult = {
  host: HostName;
  content: string;
  stderr: string;
};

export type LocalAgentRunner = {
  host: HostName;
  invoke(input: LocalAgentInvocationInput): Promise<LocalAgentInvocationResult>;
};

function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function uniqueDirs(input: string[]): string[] {
  return [...new Set(input.filter((value) => value.trim().length > 0))];
}

function readFileIfPresent(filePath?: string): string | null {
  if (!filePath) {
    return null;
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

type HostInvocationTraceEvent = {
  at: string;
  type: string;
  detail?: string;
  data?: Record<string, unknown>;
};

type HostInvocationTrace = {
  host: HostName;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  expectedOutputPath?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  completionReason?: "exit" | "expected_output" | "timeout" | "spawn_error" | "command_failed";
  exitCode?: number | null;
  signal?: NodeJS.Signals;
  stdoutPath?: string;
  stderrPath?: string;
  env: Record<string, string | null>;
  events: HostInvocationTraceEvent[];
};

function tracePaths(tracePrefixPath: string): { json: string; stdout: string; stderr: string } {
  return {
    json: `${tracePrefixPath}.trace.json`,
    stdout: `${tracePrefixPath}.stdout.log`,
    stderr: `${tracePrefixPath}.stderr.log`
  };
}

function tracedEnvSubset(env: NodeJS.ProcessEnv | undefined): Record<string, string | null> {
  const current = env ?? process.env;
  const secretMarker = (value: string | undefined) => value ? "[set]" : null;

  return {
    HOME: current.HOME ?? null,
    USERPROFILE: current.USERPROFILE ?? null,
    OLLAMA_HOST: current.OLLAMA_HOST ?? null,
    ANTHROPIC_BASE_URL: current.ANTHROPIC_BASE_URL ?? null,
    ANTHROPIC_AUTH_TOKEN: secretMarker(current.ANTHROPIC_AUTH_TOKEN),
    ANTHROPIC_API_KEY: secretMarker(current.ANTHROPIC_API_KEY),
    LINEUP_WRAPPED_VIA_OLLAMA: current.LINEUP_WRAPPED_VIA_OLLAMA ?? null
  };
}

function appendTraceEvent(trace: HostInvocationTrace, type: string, detail?: string, data?: Record<string, unknown>): void {
  trace.events.push({
    at: new Date().toISOString(),
    type,
    ...(detail ? { detail } : {}),
    ...(data ? { data } : {})
  });
}

function recordTraceEvent(
  trace: HostInvocationTrace,
  tracePrefixPath: string | undefined,
  type: string,
  detail?: string,
  data?: Record<string, unknown>
): void {
  appendTraceEvent(trace, type, detail, data);
  writeTraceFile(trace, tracePrefixPath);
}

function writeTraceFile(trace: HostInvocationTrace, tracePrefixPath?: string): void {
  if (!tracePrefixPath) {
    return;
  }

  const paths = tracePaths(tracePrefixPath);
  mkdirSync(path.dirname(paths.json), { recursive: true });
  writeFileSync(paths.json, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
}

function appendTraceStream(tracePrefixPath: string | undefined, stream: "stdout" | "stderr", chunk: string): void {
  if (!tracePrefixPath) {
    return;
  }

  const paths = tracePaths(tracePrefixPath);
  const target = stream === "stdout" ? paths.stdout : paths.stderr;
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, chunk, "utf8");
}

function hasStrictAdditionalProperties(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") {
    return true;
  }

  if (Array.isArray(schema)) {
    return schema.every((item) => hasStrictAdditionalProperties(item));
  }

  const record = schema as Record<string, unknown>;
  if (record.type === "object" && record.additionalProperties !== false) {
    return false;
  }

  return Object.values(record).every((value) => hasStrictAdditionalProperties(value));
}

function inferSchemaTypeFromConst(value: unknown): string | null {
  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "object") {
    return "object";
  }

  return null;
}

function normalizeCodexSchemaNode(schema: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(schema)) {
    let changed = false;
    const value = schema.map((item) => {
      const normalized = normalizeCodexSchemaNode(item);
      changed ||= normalized.changed;
      return normalized.value;
    });

    return changed ? { value, changed: true } : { value: schema, changed: false };
  }

  if (!schema || typeof schema !== "object") {
    return { value: schema, changed: false };
  }

  const record = schema as Record<string, unknown>;
  let changed = false;
  const normalizedRecord: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeCodexSchemaNode(value);
    normalizedRecord[key] = normalized.value;
    changed ||= normalized.changed;
  }

  if (!("type" in normalizedRecord) && "const" in normalizedRecord) {
    const inferredType = inferSchemaTypeFromConst(normalizedRecord.const);
    if (inferredType) {
      normalizedRecord.type = inferredType;
      changed = true;
    }
  }

  return changed ? { value: normalizedRecord, changed: true } : { value: schema, changed: false };
}

export function normalizeCodexOutputSchema(schemaContent: string): string | null {
  try {
    const parsed = JSON.parse(schemaContent) as unknown;
    if (!hasStrictAdditionalProperties(parsed)) {
      return null;
    }

    const normalized = normalizeCodexSchemaNode(parsed);
    return normalized.changed ? JSON.stringify(normalized.value, null, 2) : schemaContent;
  } catch {
    return null;
  }
}

function extractStructuredPayload(raw: string): unknown {
  let parsed: { structured_output?: unknown; result?: unknown } | unknown;
  try {
    parsed = JSON.parse(raw) as { structured_output?: unknown; result?: unknown };
  } catch {
    return undefined;
  }
  if (parsed && typeof parsed === "object" && "structured_output" in parsed && parsed.structured_output !== undefined) {
    return parsed.structured_output;
  }

  if (parsed && typeof parsed === "object" && "result" in parsed && typeof parsed.result === "string") {
    try {
      return JSON.parse(parsed.result);
    } catch {
      try {
        return JSON.parse(repairJsonOutput(parsed.result).content);
      } catch {
        return undefined;
      }
    }
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    !("type" in parsed && (parsed as { type?: unknown }).type === "result")
  ) {
    return parsed;
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  return undefined;
}

export function parseLocalAgentStructuredOutput(raw: string): unknown {
  const extracted = extractStructuredPayload(raw);
  if (extracted !== undefined) {
    return extracted;
  }

  try {
    const repairedJson = JSON.parse(repairJsonOutput(raw).content);
    if (repairedJson && typeof repairedJson === "object" && !Array.isArray(repairedJson)) {
      const record = repairedJson as Record<string, unknown>;
      if (record.structured_output !== undefined) {
        return record.structured_output;
      }
      if (typeof record.result === "string") {
        const nested = parseLocalAgentStructuredOutput(record.result);
        if (nested !== undefined) {
          return nested;
        }
      }
    }
    return repairedJson;
  } catch {
    // fall through
  }

  try {
    const parsedYaml = parseRestrictedYaml(repairYamlOutput(raw).content, "agent-runner");
    if (parsedYaml && typeof parsedYaml === "object" && !Array.isArray(parsedYaml)) {
      const record = parsedYaml as Record<string, unknown>;
      if (record.structured_output !== undefined) {
        return record.structured_output;
      }
      if (typeof record.result === "string") {
        const nested = parseLocalAgentStructuredOutput(record.result);
        if (nested !== undefined) {
          return nested;
        }
      }
    }
    return parsedYaml;
  } catch {
    return undefined;
  }
}

export function resolveLocalExecutionHost(preferredHost?: HostName): HostName {
  if (preferredHost) {
    if (!commandExists(preferredHost)) {
      throw new CliError(`Requested local execution host '${preferredHost}' is not installed or not on PATH.`, {
        code: "command_not_found"
      });
    }
    return preferredHost;
  }

  for (const host of SUPPORTED_HOSTS) {
    if (commandExists(host)) {
      return host;
    }
  }

  throw new CliError(
    "No supported local execution host found on PATH. Install Claude Code, Codex CLI, or OpenCode, or run through a generated host skill with --mode host.",
    { code: "command_not_found" }
  );
}

async function runClaudeAgent(host: HostName, input: LocalAgentInvocationInput): Promise<LocalAgentInvocationResult> {
  const schemaContent = input.outputSchemaPath ? readFileSync(input.outputSchemaPath, "utf8") : null;
  const runClaudeAttempt = async (attempt: {
    prompt: string;
    schemaContent: string | null;
    traceSuffix: string;
  }): Promise<LocalAgentInvocationResult> => {
    const launchPlan = planHostLaunch({
      host,
      projectRoot: input.projectRoot,
      workingDirectory: input.workingDirectory,
      agent: input.agent,
      prompt: attempt.prompt,
      timeoutMs: input.timeoutMs,
      addDirs: input.addDirs,
      schemaContent: attempt.schemaContent
    });

    const result = await runSpawnedCommand({
      host: launchPlan.host,
      command: launchPlan.command,
      args: launchPlan.args,
      cwd: input.workingDirectory,
      env: launchPlan.env,
      timeoutMs: input.timeoutMs,
      stopOnExpectedOutputPath: input.expectedOutputPath,
      tracePrefixPath: input.tracePrefixPath ? `${input.tracePrefixPath}-${attempt.traceSuffix}` : undefined
    });
    const fileOutput = readFileIfPresent(input.expectedOutputPath);
    if (fileOutput && !attempt.schemaContent) {
      return {
        host: result.host,
        stderr: result.stderr,
        content: fileOutput
      };
    }
    if (!attempt.schemaContent) {
      return result;
    }

    const structured =
      parseLocalAgentStructuredOutput(fileOutput ?? result.content) ??
      (await formatStructuredOutputWithClaude({
        projectRoot: input.projectRoot,
        workingDirectory: input.workingDirectory,
        agent: input.agent,
        rawDraft: fileOutput ?? result.content,
        schemaContent: attempt.schemaContent,
        timeoutMs: input.timeoutMs,
        tracePrefixPath: input.tracePrefixPath ? `${input.tracePrefixPath}-${attempt.traceSuffix}-format` : undefined
      }));

    return {
      host: result.host,
      stderr: result.stderr,
      content: `${JSON.stringify(structured, null, 2)}\n`
    };
  };

  if (!schemaContent) {
    return runClaudeAttempt({
      prompt: input.prompt,
      schemaContent: null,
      traceSuffix: "draft"
    });
  }

  try {
    return await runClaudeAttempt({
      prompt: input.prompt,
      schemaContent,
      traceSuffix: "strict"
    });
  } catch (error) {
    const isTimeout = error instanceof CliError && error.code === "timeout";
    if (!isTimeout) {
      throw error;
    }

    return runClaudeAttempt({
      prompt: input.prompt,
      schemaContent: null,
      traceSuffix: "draft-fallback"
    });
  }
}

async function formatStructuredOutputWithClaude(input: {
  projectRoot: string;
  rawDraft: string;
  schemaContent: string;
  agent: AgentRole;
  workingDirectory: string;
  timeoutMs?: number;
  tracePrefixPath?: string;
}): Promise<unknown> {
  const formatterPrompt = [
    "Convert the following draft into a JSON value that matches the provided schema.",
    "Return structured JSON only.",
    "",
    "Draft:",
    input.rawDraft
  ].join("\n");

  const launchPlan = planHostLaunch({
    host: "claude",
    projectRoot: input.projectRoot,
    workingDirectory: input.workingDirectory,
    agent: input.agent,
    prompt: formatterPrompt,
    timeoutMs: input.timeoutMs,
    schemaContent: input.schemaContent
  });

  const result = await runSpawnedCommand({
    host: launchPlan.host,
    command: launchPlan.command,
    args: launchPlan.args,
    cwd: input.workingDirectory,
    env: launchPlan.env,
    timeoutMs: input.timeoutMs,
    tracePrefixPath: input.tracePrefixPath
  });

  const structured = extractStructuredPayload(result.content);
  if (structured !== undefined) {
    return structured;
  }

  const repaired = parseLocalAgentStructuredOutput(result.content);
  if (repaired !== undefined) {
    return repaired;
  }

  throw new CliError("Claude did not return structured output that could be parsed.", {
      code: "malformed_output"
    });
}

async function runCodexAgent(host: HostName, input: LocalAgentInvocationInput): Promise<LocalAgentInvocationResult> {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "lineup-codex-output-"));
  const outputPath = path.join(outputDir, `${input.agent}.txt`);
  const normalizedSchema = input.outputSchemaPath
    ? normalizeCodexOutputSchema(readFileSync(input.outputSchemaPath, "utf8"))
    : null;
  const normalizedSchemaPath = normalizedSchema ? path.join(outputDir, `${input.agent}.schema.json`) : null;
  const launchPlan = planHostLaunch({
    host,
    projectRoot: input.projectRoot,
    workingDirectory: input.workingDirectory,
    agent: input.agent,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
    addDirs: input.addDirs,
    outputPath,
    schemaPath: normalizedSchemaPath
  });

  try {
    if (normalizedSchemaPath && normalizedSchema) {
      writeFileSync(normalizedSchemaPath, normalizedSchema, "utf8");
    }

    const result = await runSpawnedCommand({
      host: launchPlan.host,
      command: launchPlan.command,
      args: launchPlan.args,
      cwd: input.workingDirectory,
      env: launchPlan.env,
      timeoutMs: input.timeoutMs,
      stopOnExpectedOutputPath: input.expectedOutputPath,
      tracePrefixPath: input.tracePrefixPath
    });
    const fileOutput = readFileIfPresent(input.expectedOutputPath);
    if (fileOutput) {
      return {
        host: result.host,
        stderr: result.stderr,
        content: fileOutput
      };
    }
    const content = readFileSync(outputPath, "utf8");
    return {
      host: result.host,
      content,
      stderr: result.stderr
    };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

async function runOpencodeAgent(host: HostName, input: LocalAgentInvocationInput): Promise<LocalAgentInvocationResult> {
  const launchPlan = planHostLaunch({
    host,
    projectRoot: input.projectRoot,
    workingDirectory: input.workingDirectory,
    agent: input.agent,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
    addDirs: input.addDirs
  });

  const result = await runSpawnedCommand({
    host: launchPlan.host,
    command: launchPlan.command,
    args: launchPlan.args,
    cwd: input.workingDirectory,
    env: launchPlan.env,
    timeoutMs: input.timeoutMs,
    stopOnExpectedOutputPath: input.expectedOutputPath,
    tracePrefixPath: input.tracePrefixPath
  });
  const fileOutput = readFileIfPresent(input.expectedOutputPath);
  if (fileOutput) {
    return {
      host: result.host,
      stderr: result.stderr,
      content: fileOutput
    };
  }
  return result;
}

async function runSpawnedCommand(input: {
  host: HostName;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stopOnExpectedOutputPath?: string;
  tracePrefixPath?: string;
}): Promise<LocalAgentInvocationResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const trace: HostInvocationTrace = {
      host: input.host,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.stopOnExpectedOutputPath ? { expectedOutputPath: input.stopOnExpectedOutputPath } : {}),
      startedAt: new Date(startedAt).toISOString(),
      env: tracedEnvSubset(input.env),
      events: []
    };
    if (input.tracePrefixPath) {
      const paths = tracePaths(input.tracePrefixPath);
      trace.stdoutPath = paths.stdout;
      trace.stderrPath = paths.stderr;
    }
    recordTraceEvent(trace, input.tracePrefixPath, "spawn", `${input.command} ${input.args.join(" ")}`.trim());

    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let completedFromExpectedOutput = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let expectedOutputPoller: NodeJS.Timeout | undefined;
    let expectedOutputKillTimer: NodeJS.Timeout | undefined;

    const clearPendingTimers = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      if (expectedOutputPoller) {
        clearInterval(expectedOutputPoller);
      }
      if (expectedOutputKillTimer) {
        clearTimeout(expectedOutputKillTimer);
      }
    };

    const settleResolve = (result: LocalAgentInvocationResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (expectedOutputPoller) {
        clearInterval(expectedOutputPoller);
        expectedOutputPoller = undefined;
      }
      trace.completedAt = new Date().toISOString();
      trace.durationMs = Date.now() - startedAt;
      trace.completionReason = completedFromExpectedOutput ? "expected_output" : "exit";
      writeTraceFile(trace, input.tracePrefixPath);
      resolve(result);
    };

    const settleReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearPendingTimers();
      trace.completedAt = new Date().toISOString();
      trace.durationMs = Date.now() - startedAt;
      if (timedOut) {
        trace.completionReason = "timeout";
      } else {
        trace.completionReason = error instanceof CliError && error.code === "command_failed"
          ? "command_failed"
          : "spawn_error";
      }
      writeTraceFile(trace, input.tracePrefixPath);
      reject(error);
    };

    if (input.timeoutMs && input.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        recordTraceEvent(trace, input.tracePrefixPath, "timeout", `Timed out after ${input.timeoutMs}ms.`);
        child.kill("SIGTERM");
        recordTraceEvent(trace, input.tracePrefixPath, "signal", "Sent SIGTERM after timeout.", { signal: "SIGTERM" });
        setTimeout(() => {
          recordTraceEvent(trace, input.tracePrefixPath, "signal", "Sent SIGKILL after timeout grace period.", { signal: "SIGKILL" });
          child.kill("SIGKILL");
        }, 1_000).unref();
      }, input.timeoutMs);
    }

    if (input.stopOnExpectedOutputPath) {
      expectedOutputPoller = setInterval(() => {
        const fileOutput = readFileIfPresent(input.stopOnExpectedOutputPath);
        if (!fileOutput || fileOutput.trim().length === 0 || completedFromExpectedOutput) {
          return;
        }

        completedFromExpectedOutput = true;
        recordTraceEvent(trace, input.tracePrefixPath, "artifact_detected", `Detected expected output at ${input.stopOnExpectedOutputPath}.`, {
          bytes: Buffer.byteLength(fileOutput, "utf8")
        });
        if (expectedOutputPoller) {
          clearInterval(expectedOutputPoller);
          expectedOutputPoller = undefined;
        }
        settleResolve({
          host: input.host,
          content: stdout,
          stderr
        });
        child.kill("SIGTERM");
        recordTraceEvent(trace, input.tracePrefixPath, "signal", "Sent SIGTERM after expected output was detected.", { signal: "SIGTERM" });
        expectedOutputKillTimer = setTimeout(() => {
          recordTraceEvent(trace, input.tracePrefixPath, "signal", "Sent SIGKILL after expected-output grace period.", { signal: "SIGKILL" });
          child.kill("SIGKILL");
        }, 1_000);
        expectedOutputKillTimer.unref();
      }, 250);
      expectedOutputPoller.unref();
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      appendTraceStream(input.tracePrefixPath, "stdout", text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendTraceStream(input.tracePrefixPath, "stderr", text);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        clearPendingTimers();
        return;
      }
      if (error.code === "ENOENT") {
        recordTraceEvent(trace, input.tracePrefixPath, "spawn_error", `Required command not found: ${input.command}`);
        settleReject(
          new CliError(`Required command not found: ${input.command}`, {
            code: "command_not_found"
          })
        );
        return;
      }
      recordTraceEvent(trace, input.tracePrefixPath, "spawn_error", error.message);
      settleReject(error);
    });

    child.on("close", (code) => {
      clearPendingTimers();
      trace.exitCode = code;
      recordTraceEvent(trace, input.tracePrefixPath, "close", `Process exited with code ${code ?? 1}.`, {
        code: code ?? 1,
        completedFromExpectedOutput
      });

      if (settled) {
        writeTraceFile(trace, input.tracePrefixPath);
        return;
      }

      if (timedOut) {
        settleReject(
          new CliError(
            [
              `${input.host} ${input.command} invocation timed out after ${input.timeoutMs}ms.`,
              input.tracePrefixPath ? `trace: ${tracePaths(input.tracePrefixPath).json}` : null
            ].filter(Boolean).join("\n"),
            {
              code: "timeout"
            }
          )
        );
        return;
      }

      if (completedFromExpectedOutput) {
        settleResolve({
          host: input.host,
          content: stdout,
          stderr
        });
        return;
      }

      if ((code ?? 1) !== 0) {
        settleReject(
          new CliError(
            [
              `${input.host} agent invocation failed with exit code ${code ?? 1}.`,
              input.tracePrefixPath ? `trace: ${tracePaths(input.tracePrefixPath).json}` : null,
              stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
              stderr.trim() ? `stderr:\n${stderr.trim()}` : null
            ]
              .filter(Boolean)
              .join("\n"),
            { code: "command_failed" }
          )
        );
        return;
      }

      settleResolve({
        host: input.host,
        content: stdout,
        stderr
      });
    });
  });
}

export function createLocalAgentRunner(preferredHost?: HostName): LocalAgentRunner {
  const host = resolveLocalExecutionHost(preferredHost);

  return {
    host,
    async invoke(input) {
      switch (host) {
        case "claude":
          return runClaudeAgent(host, input);
        case "codex":
          return runCodexAgent(host, input);
        case "opencode":
          return runOpencodeAgent(host, input);
      }
    }
  };
}
