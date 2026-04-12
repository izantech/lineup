import { CliError } from "./errors.js";
import type { ErrorCode } from "./types.js";

export type RetryPolicy = {
  maxAttempts?: number;
  on?: ErrorCode[];
};

export type RetryAttemptContext = {
  attempt: number;
  maxAttempts: number;
  previousErrors: Array<{
    code: string;
    message: string;
  }>;
};

export type RetryResult<T> = {
  value: T;
  attempts: number;
  retryCount: number;
  previousErrors: RetryAttemptContext["previousErrors"];
};

function resolveErrorCode(error: unknown): string {
  if (error instanceof CliError) {
    return error.code;
  }

  return "unknown_error";
}

function isRetryableError(error: unknown, retryableCodes: readonly ErrorCode[]): boolean {
  if (retryableCodes.length === 0) {
    return false;
  }

  const code = resolveErrorCode(error);
  return retryableCodes.includes(code as ErrorCode);
}

export async function retryOperation<T>(
  policy: RetryPolicy | undefined,
  operation: (context: RetryAttemptContext) => Promise<T>
): Promise<RetryResult<T>> {
  const maxAttempts = Math.max(policy?.maxAttempts ?? 1, 1);
  const retryableCodes = policy?.on ?? [];
  const previousErrors: RetryAttemptContext["previousErrors"] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await operation({
        attempt,
        maxAttempts,
        previousErrors: [...previousErrors]
      });

      return {
        value,
        attempts: attempt,
        retryCount: attempt - 1,
        previousErrors
      };
    } catch (error) {
      previousErrors.push({
        code: resolveErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      });

      if (attempt >= maxAttempts || !isRetryableError(error, retryableCodes)) {
        throw error;
      }
    }
  }

  throw new CliError("Retry operation exhausted without producing a result.", {
    code: "command_failed"
  });
}
