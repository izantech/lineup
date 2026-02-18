import { spawn } from "node:child_process";

import { CliError } from "./errors";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new CliError(`Required command not found: ${command}`, {
            code: "command_not_found"
          })
        );
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

export function assertSuccess(result: CommandResult, label: string, allowPatterns: RegExp[] = []): void {
  if (result.code === 0) {
    return;
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  if (allowPatterns.some((pattern) => pattern.test(combined))) {
    return;
  }

  throw new CliError(
    [
      `${label} failed with exit code ${result.code}.`,
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null
    ]
      .filter(Boolean)
      .join("\n"),
    {
      code: "command_failed"
    }
  );
}
