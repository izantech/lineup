import { existsSync, readFileSync } from "node:fs";
import { exec } from "node:child_process";
import { join } from "node:path";

export interface VerificationCommand {
  name: string;
  command: string;
  type: "test" | "typecheck" | "lint";
}

export interface VerificationResult {
  name: string;
  command: string;
  type: "test" | "typecheck" | "lint";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function detectVerificationCommands(projectRoot: string): VerificationCommand[] {
  const commands: VerificationCommand[] = [];

  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      if (scripts["test"]) {
        commands.push({ name: "npm test", command: "npm run test", type: "test" });
      }
      if (scripts["typecheck"]) {
        commands.push({ name: "npm typecheck", command: "npm run typecheck", type: "typecheck" });
      } else if (scripts["type-check"]) {
        commands.push({ name: "npm type-check", command: "npm run type-check", type: "typecheck" });
      }
      if (scripts["lint"]) {
        commands.push({ name: "npm lint", command: "npm run lint", type: "lint" });
      }
    } catch {
      // ignore parse errors
    }
  }

  const makefilePath = join(projectRoot, "Makefile");
  if (existsSync(makefilePath)) {
    try {
      const content = readFileSync(makefilePath, "utf-8");
      const targetPattern = /^([a-zA-Z][a-zA-Z0-9_-]*):/gm;
      const targets = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = targetPattern.exec(content)) !== null) {
        targets.add(match[1]);
      }
      if (targets.has("test")) {
        commands.push({ name: "make test", command: "make test", type: "test" });
      }
      if (targets.has("check")) {
        commands.push({ name: "make check", command: "make check", type: "typecheck" });
      }
      if (targets.has("lint")) {
        commands.push({ name: "make lint", command: "make lint", type: "lint" });
      }
    } catch {
      // ignore read errors
    }
  }

  return commands;
}

export async function runVerificationHooks(projectRoot: string): Promise<VerificationResult[]> {
  const commands = detectVerificationCommands(projectRoot);
  const results: VerificationResult[] = [];

  for (const cmd of commands) {
    const start = Date.now();
    const result = await new Promise<VerificationResult>((resolve) => {
      exec(cmd.command, { cwd: projectRoot, timeout: 120_000 }, (error, stdout, stderr) => {
        resolve({
          name: cmd.name,
          command: cmd.command,
          type: cmd.type,
          exitCode: error?.code != null ? (error.code as number) : (error ? 1 : 0),
          stdout,
          stderr,
          durationMs: Date.now() - start
        });
      });
    });
    results.push(result);
  }

  return results;
}
