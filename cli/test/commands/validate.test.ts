import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runValidateCommand } from "../../src/commands/validate.js";

let tempDir: string;
let stdout: string[];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-validate-"));
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("validate command", () => {
  it("rejects unknown kind", async () => {
    const file = join(tempDir, "foo.txt");
    writeFileSync(file, "hello");

    await expect(
      runValidateCommand({ file, kind: "bogus" })
    ).rejects.toThrow(/Unknown artifact kind "bogus"/);
  });

  it("fails to infer kind from unknown filename", async () => {
    const file = join(tempDir, "random.txt");
    writeFileSync(file, "hello");

    await expect(
      runValidateCommand({ file })
    ).rejects.toThrow(/Could not infer artifact kind/);
  });

  it("reports invalid artifact in table mode", async () => {
    const file = join(tempDir, "plan.yaml");
    writeFileSync(file, "not_valid: true\n");

    await runValidateCommand({ file });

    const output = stdout.join("");
    expect(output).toContain("INVALID");
  });

  it("reports invalid artifact in json mode", async () => {
    const file = join(tempDir, "plan.yaml");
    writeFileSync(file, "not_valid: true\n");

    await runValidateCommand({ file, json: true });

    const output = JSON.parse(stdout.join(""));
    expect(output.valid).toBe(false);
    expect(output.kind).toBe("plan");
  });

  it("validates with explicit --kind override", async () => {
    const file = join(tempDir, "myfile.yaml");
    writeFileSync(file, "not_valid: true\n");

    await runValidateCommand({ file, kind: "spec", json: true });

    const output = JSON.parse(stdout.join(""));
    expect(output.valid).toBe(false);
    expect(output.kind).toBe("spec");
  });
});
