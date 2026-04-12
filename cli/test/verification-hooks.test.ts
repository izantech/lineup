import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectVerificationCommands, runVerificationHooks } from "../src/lib/verification.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "lineup-verification-"));
}

describe("detectVerificationCommands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects npm test, typecheck, and lint from package.json", () => {
    tempDir = makeTempDir();
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "vitest run",
          typecheck: "tsc --noEmit",
          lint: "eslint ."
        }
      }),
      "utf-8"
    );

    const commands = detectVerificationCommands(tempDir);
    expect(commands).toHaveLength(3);
    expect(commands.find((c) => c.type === "test")).toMatchObject({ name: "npm test", command: "npm run test", type: "test" });
    expect(commands.find((c) => c.type === "typecheck")).toMatchObject({ name: "npm typecheck", command: "npm run typecheck", type: "typecheck" });
    expect(commands.find((c) => c.type === "lint")).toMatchObject({ name: "npm lint", command: "npm run lint", type: "lint" });
  });

  it("detects type-check as typecheck alias", () => {
    tempDir = makeTempDir();
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { "type-check": "tsc --noEmit" } }),
      "utf-8"
    );

    const commands = detectVerificationCommands(tempDir);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ name: "npm type-check", command: "npm run type-check", type: "typecheck" });
  });

  it("detects Makefile test, check, and lint targets", () => {
    tempDir = makeTempDir();
    writeFileSync(
      join(tempDir, "Makefile"),
      "test:\n\tgo test ./...\n\ncheck:\n\tgo vet ./...\n\nlint:\n\tgolangci-lint run\n",
      "utf-8"
    );

    const commands = detectVerificationCommands(tempDir);
    expect(commands.find((c) => c.name === "make test")).toMatchObject({ command: "make test", type: "test" });
    expect(commands.find((c) => c.name === "make check")).toMatchObject({ command: "make check", type: "typecheck" });
    expect(commands.find((c) => c.name === "make lint")).toMatchObject({ command: "make lint", type: "lint" });
  });

  it("returns empty array when package.json is missing", () => {
    tempDir = makeTempDir();
    const commands = detectVerificationCommands(tempDir);
    expect(commands).toEqual([]);
  });

  it("returns empty array when package.json has no relevant scripts", () => {
    tempDir = makeTempDir();
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
      "utf-8"
    );
    const commands = detectVerificationCommands(tempDir);
    expect(commands).toEqual([]);
  });
});

describe("runVerificationHooks", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns structured result with exit code 0 for passing command", async () => {
    tempDir = makeTempDir();
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { test: "echo ok" } }),
      "utf-8"
    );

    const results = await runVerificationHooks(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].exitCode).toBe(0);
    expect(results[0].type).toBe("test");
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns structured error with non-zero exit code for failing command", async () => {
    tempDir = makeTempDir();
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { test: "exit 1" } }),
      "utf-8"
    );

    const results = await runVerificationHooks(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].exitCode).not.toBe(0);
    expect(results[0].name).toBe("npm test");
    expect(results[0].command).toBe("npm run test");
  });

  it("returns empty array when no hooks detected", async () => {
    tempDir = makeTempDir();
    const results = await runVerificationHooks(tempDir);
    expect(results).toEqual([]);
  });
});
