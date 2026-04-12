import type { ErrorCode } from "./types.js";

export class CliError extends Error {
  code: string;
  exitCode: number;

  constructor(message: string, options?: { code?: string; exitCode?: number }) {
    super(message);
    this.name = "CliError";
    this.code = options?.code ?? "cli_error";
    this.exitCode = options?.exitCode ?? 1;
  }
}

export function cliError(message: string, code: ErrorCode, exitCode = 1): CliError {
  return new CliError(message, { code, exitCode });
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
