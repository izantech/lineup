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

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
