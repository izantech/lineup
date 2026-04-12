import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, afterEach, beforeEach, it } from "vitest";

import { CliError } from "../src/lib/errors.js";
import { createArtifactStore, hashArtifactContent, serializeCanonicalJson } from "../src/lib/artifact-store.js";

describe("artifact store", () => {
  let tempDir: string;
  let storeRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-artifacts-"));
    storeRoot = join(tempDir, ".lineup", ".artifacts");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores text artifacts immutably under content hashes", () => {
    const store = createArtifactStore(storeRoot);
    const content = "apiVersion: lineup/v3\nkind: Constitution\nrequest:\n  summary: Add native executor\n";

    const first = store.persistText("constitution", content, "yaml");
    const second = store.persistText("constitution", content, "yaml");

    expect(first.sha256).toBe(hashArtifactContent(`${content.replace(/\r\n?/g, "\n")}`));
    expect(second.sha256).toBe(first.sha256);
    expect(second.existed).toBe(true);
    expect(first.path).toBe(second.path);
    expect(readFileSync(first.path, "utf8")).toBe(`${content.replace(/\r\n?/g, "\n")}`);
  });

  it("canonicalizes json payloads before hashing and writing", () => {
    const store = createArtifactStore(storeRoot);
    const firstPayload = { b: 2, a: { z: 1, y: [3, 2, 1] } };
    const secondPayload = { a: { y: [3, 2, 1], z: 1 }, b: 2 };

    const first = store.persistJson("tasks", firstPayload);
    const second = store.persistJson("tasks", secondPayload);

    expect(first.sha256).toBe(second.sha256);
    expect(second.existed).toBe(true);
    expect(readFileSync(first.path, "utf8")).toBe(serializeCanonicalJson(firstPayload));
  });

  it("rejects a tampered file at the same content-addressed path", () => {
    const store = createArtifactStore(storeRoot);
    const content = "apiVersion: lineup/v3\nkind: Review\nstatus: PASS\nsummary: ok\nissues: []\ntest_results:\n  test_suite:\n    status: pass\n";

    const persisted = store.persistText("review", content, "yaml");
    writeFileSync(persisted.path, "tampered\n", "utf8");

    expect(() => store.persistText("review", content, "yaml")).toThrow(CliError);
  });
});
