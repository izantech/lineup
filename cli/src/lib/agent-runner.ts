import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";

import { SUPPORTED_HOSTS, type HostName } from "./constants.js";
import { resolveAgentConfig } from "./config.js";
import { CliError } from "./errors.js";
import { repairJsonOutput, repairYamlOutput } from "./llm-output-repair.js";
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
  const agentConfig = resolveAgentConfig(input.agent, {
    projectRoot: input.projectRoot,
    host
  });
  const schemaContent = input.outputSchemaPath ? readFileSync(input.outputSchemaPath, "utf8") : null;
  const args = [
    "-p",
    "--output-format",
    schemaContent ? "json" : "text",
    "--permission-mode",
    "bypassPermissions",
    ...uniqueDirs([input.projectRoot, input.workingDirectory, ...(input.addDirs ?? [])]).flatMap((dir) => ["--add-dir", dir]),
    ...(schemaContent ? ["--json-schema", schemaContent] : []),
    ...(agentConfig.modelTarget ? ["--model", agentConfig.modelTarget] : []),
    input.prompt
  ];

  const result = await runSpawnedCommand({
    host,
    command: "claude",
    args,
    cwd: input.workingDirectory,
    timeoutMs: input.timeoutMs
  });
  const fileOutput = readFileIfPresent(input.expectedOutputPath);
  if (fileOutput && !schemaContent) {
    return {
      host: result.host,
      stderr: result.stderr,
      content: fileOutput
    };
  }
  if (!schemaContent) {
    return result;
  }

  const structured =
    parseLocalAgentStructuredOutput(fileOutput ?? result.content) ??
    (await formatStructuredOutputWithClaude({
      rawDraft: fileOutput ?? result.content,
      schemaContent,
      workingDirectory: input.workingDirectory,
      timeoutMs: input.timeoutMs
    }));

  return {
    host: result.host,
    stderr: result.stderr,
    content: `${JSON.stringify(structured, null, 2)}\n`
  };
}

async function formatStructuredOutputWithClaude(input: {
  rawDraft: string;
  schemaContent: string;
  workingDirectory: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const formatterPrompt = [
    "Convert the following draft into a JSON value that matches the provided schema.",
    "Return structured JSON only.",
    "",
    "Draft:",
    input.rawDraft
  ].join("\n");

  const result = await runSpawnedCommand({
    host: "claude",
    command: "claude",
    args: [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      input.schemaContent,
      "--permission-mode",
      "bypassPermissions",
      formatterPrompt
    ],
    cwd: input.workingDirectory,
    timeoutMs: input.timeoutMs
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
  const agentConfig = resolveAgentConfig(input.agent, {
    projectRoot: input.projectRoot,
    host
  });

  try {
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      input.workingDirectory,
      ...uniqueDirs([input.projectRoot, ...(input.addDirs ?? [])]).flatMap((dir) => ["--add-dir", dir]),
      ...(agentConfig.modelTarget && !["haiku", "sonnet", "opus"].includes(agentConfig.modelTarget) ? ["-m", agentConfig.modelTarget] : []),
      ...(input.outputSchemaPath ? ["--output-schema", input.outputSchemaPath] : []),
      "-o",
      outputPath,
      input.prompt
    ];

    const result = await runSpawnedCommand({
      host,
      command: "codex",
      args,
      cwd: input.workingDirectory,
      timeoutMs: input.timeoutMs
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
  const agentConfig = resolveAgentConfig(input.agent, {
    projectRoot: input.projectRoot,
    host
  });
  const args = [
    "run",
    "--dir",
    input.workingDirectory,
    "--dangerously-skip-permissions",
    ...(agentConfig.modelTarget && !["haiku", "sonnet", "opus"].includes(agentConfig.modelTarget) ? ["--model", agentConfig.modelTarget] : []),
    input.prompt
  ];

  const result = await runSpawnedCommand({
    host,
    command: "opencode",
    args,
    cwd: input.workingDirectory,
    timeoutMs: input.timeoutMs
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
  timeoutMs?: number;
}): Promise<LocalAgentInvocationResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    if (input.timeoutMs && input.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
      }, input.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (error.code === "ENOENT") {
        reject(
          new CliError(`Required command not found: ${input.command}`, {
            code: "command_not_found"
          })
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (timedOut) {
        reject(
          new CliError(`${input.host} ${input.command} invocation timed out after ${input.timeoutMs}ms.`, {
            code: "timeout"
          })
        );
        return;
      }

      if ((code ?? 1) !== 0) {
        reject(
          new CliError(
            [
              `${input.host} agent invocation failed with exit code ${code ?? 1}.`,
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

      resolve({
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
