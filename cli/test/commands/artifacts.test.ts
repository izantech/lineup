import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runArtifactsShowCommand,
  runArtifactsPathCommand,
  runArtifactsDiffCommand,
} from "../../src/commands/artifacts.js";
import * as observer from "../../src/lib/observer.js";
import type { ObservedPipelineRun } from "../../src/lib/types.js";

let tempDir: string;
let stdout: string[];

function makeArtifactFile(dir: string, content: string): string {
  const file = join(dir, "artifact.yaml");
  writeFileSync(file, content);
  return file;
}

function makeRun(overrides: Partial<ObservedPipelineRun> & { run_id: string }): ObservedPipelineRun {
  return {
    status: "success",
    workflow: "default.yaml",
    current_stage: null,
    updated_at: new Date().toISOString(),
    completed_stages: [],
    artifacts: [],
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-artifacts-cmd-"));
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

describe("artifacts show", () => {
  it("rejects unknown kind", async () => {
    await expect(
      runArtifactsShowCommand({ kind: "bogus" })
    ).rejects.toThrow(/Unknown artifact kind "bogus"/);
  });

  it("errors when no runs exist", async () => {
    vi.spyOn(observer, "observePipelineRuns").mockReturnValue([]);

    await expect(
      runArtifactsShowCommand({ kind: "plan" })
    ).rejects.toThrow(/No pipeline runs found/);
  });

  it("shows artifact content", async () => {
    const artifactPath = makeArtifactFile(tempDir, "apiVersion: lineup/v3\nkind: Plan\n");
    vi.spyOn(observer, "observePipelineRuns").mockReturnValue([
      makeRun({
        run_id: "run-1",
        artifacts: [{ kind: "plan", format: "yaml", sha256: "abc", path: artifactPath, exists: true }],
      }),
    ]);

    await runArtifactsShowCommand({ kind: "plan" });
    expect(stdout.join("")).toContain("apiVersion: lineup/v3");
  });

  it("shows artifact content as json", async () => {
    const artifactPath = makeArtifactFile(tempDir, "content here");
    vi.spyOn(observer, "observePipelineRuns").mockReturnValue([
      makeRun({
        run_id: "run-1",
        artifacts: [{ kind: "plan", format: "yaml", sha256: "abc", path: artifactPath, exists: true }],
      }),
    ]);

    await runArtifactsShowCommand({ kind: "plan", json: true });
    const output = JSON.parse(stdout.join(""));
    expect(output.run_id).toBe("run-1");
    expect(output.content).toBe("content here");
  });
});

describe("artifacts path", () => {
  it("prints artifact path", async () => {
    const artifactPath = makeArtifactFile(tempDir, "data");
    vi.spyOn(observer, "observePipelineRuns").mockReturnValue([
      makeRun({
        run_id: "run-1",
        artifacts: [{ kind: "plan", format: "yaml", sha256: "abc", path: artifactPath, exists: true }],
      }),
    ]);

    await runArtifactsPathCommand({ kind: "plan" });
    expect(stdout.join("").trim()).toBe(artifactPath);
  });
});

describe("artifacts diff", () => {
  it("reports no differences when content matches", async () => {
    mkdirSync(join(tempDir, "a"), { recursive: true });
    const path1 = join(tempDir, "a", "artifact.yaml");
    writeFileSync(path1, "same content");
    mkdirSync(join(tempDir, "b"), { recursive: true });
    const path2 = join(tempDir, "b", "artifact.yaml");
    writeFileSync(path2, "same content");

    vi.spyOn(observer, "observePipelineRuns").mockReturnValue([
      makeRun({
        run_id: "run-2",
        artifacts: [{ kind: "plan", format: "yaml", sha256: "abc", path: path2, exists: true }],
      }),
      makeRun({
        run_id: "run-1",
        artifacts: [{ kind: "plan", format: "yaml", sha256: "abc", path: path1, exists: true }],
      }),
    ]);

    await runArtifactsDiffCommand({ kind: "plan" });
    expect(stdout.join("")).toContain("No differences");
  });

  it("shows diff when content differs", async () => {
    const path1 = join(tempDir, "a", "artifact.yaml");
    mkdirSync(join(tempDir, "a"), { recursive: true });
    writeFileSync(path1, "old content\n");
    const path2 = join(tempDir, "b", "artifact.yaml");
    mkdirSync(join(tempDir, "b"), { recursive: true });
    writeFileSync(path2, "new content\n");

    vi.spyOn(observer, "observePipelineRuns").mockReturnValue([
      makeRun({
        run_id: "run-2",
        artifacts: [{ kind: "plan", format: "yaml", sha256: "def", path: path2, exists: true }],
      }),
      makeRun({
        run_id: "run-1",
        artifacts: [{ kind: "plan", format: "yaml", sha256: "abc", path: path1, exists: true }],
      }),
    ]);

    await runArtifactsDiffCommand({ kind: "plan" });
    const output = stdout.join("");
    expect(output).toContain("old content");
    expect(output).toContain("new content");
  });
});
