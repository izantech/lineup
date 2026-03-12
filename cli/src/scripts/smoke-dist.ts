import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CliError, asErrorMessage } from "../lib/errors";
import { packageRoot } from "../lib/paths";

type DistCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runDistCli(args: string[], homeDir: string): DistCommandResult {
  const result = spawnSync(process.execPath, [path.join(packageRoot(), "bin", "lineup.mjs"), ...args], {
    cwd: packageRoot(),
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir
    },
    encoding: "utf8"
  });

  if (result.error) {
    throw new CliError(`Failed to execute dist CLI (${args.join(" ")}): ${result.error.message}`, {
      code: "dist_smoke_spawn_failed"
    });
  }

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function assertExitZero(label: string, result: DistCommandResult): void {
  if (result.status === 0) {
    return;
  }

  throw new CliError(
    [
      `${label} failed with exit code ${result.status ?? "null"}.`,
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null
    ]
      .filter(Boolean)
      .join("\n"),
    {
      code: "dist_smoke_failed"
    }
  );
}

function parseStatusJson(output: string): Record<string, unknown> {
  const trimmed = output.trim();

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CliError("status --json output was not an object.", {
        code: "dist_smoke_invalid_json"
      });
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    throw new CliError(`status --json returned invalid JSON:\n${trimmed}`, {
      code: "dist_smoke_invalid_json"
    });
  }
}

function assertStatusContract(payload: Record<string, unknown>): void {
  for (const key of ["schema_version", "state_file", "hosts"]) {
    if (!(key in payload)) {
      throw new CliError(`status --json missing key: ${key}`, {
        code: "dist_smoke_status_contract_failed"
      });
    }
  }
}

function run(): void {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "lineup-smoke-home-"));

  try {
    assertExitZero("lineup --help", runDistCli(["--help"], tempHome));
    assertExitZero("lineup --cli-version", runDistCli(["--cli-version"], tempHome));

    const statusResult = runDistCli(["status", "--host", "all", "--json"], tempHome);
    assertExitZero("lineup status --host all --json", statusResult);

    const payload = parseStatusJson(statusResult.stdout);
    assertStatusContract(payload);

    process.stdout.write("Dist smoke check passed.\n");
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`${asErrorMessage(error)}\n`);
  process.exit(1);
}
