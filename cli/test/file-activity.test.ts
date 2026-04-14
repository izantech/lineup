import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { captureFileActivity, hasFileActivity, listImmediateFiles } from "../src/lib/file-activity.js";

describe("file activity", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("lists only immediate files that exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "file-activity-"));
    mkdirSync(join(tempDir, "nested"), { recursive: true });
    writeFileSync(join(tempDir, "one.log"), "a", "utf8");
    writeFileSync(join(tempDir, "nested", "two.log"), "b", "utf8");

    expect(listImmediateFiles(tempDir)).toEqual([join(tempDir, "one.log")]);
  });

  it("detects newly created files as activity", () => {
    tempDir = mkdtempSync(join(tmpdir(), "file-activity-"));
    const tracked = join(tempDir, "tracked.log");

    const before = captureFileActivity([tracked]);
    writeFileSync(tracked, "hello", "utf8");
    const after = captureFileActivity([tracked]);

    expect(hasFileActivity(before, after)).toBe(true);
  });

  it("detects file growth as activity", () => {
    tempDir = mkdtempSync(join(tmpdir(), "file-activity-"));
    const tracked = join(tempDir, "tracked.log");
    writeFileSync(tracked, "hello", "utf8");

    const before = captureFileActivity([tracked]);
    writeFileSync(tracked, "hello world", "utf8");
    const after = captureFileActivity([tracked]);

    expect(hasFileActivity(before, after)).toBe(true);
  });

  it("detects mtime changes as activity even when size is unchanged", () => {
    tempDir = mkdtempSync(join(tmpdir(), "file-activity-"));
    const tracked = join(tempDir, "tracked.log");
    writeFileSync(tracked, "same-size", "utf8");

    const before = captureFileActivity([tracked]);
    const nextTime = new Date(before[tracked].mtimeMs + 5_000);
    utimesSync(tracked, nextTime, nextTime);
    const after = captureFileActivity([tracked]);

    expect(hasFileActivity(before, after)).toBe(true);
  });

  it("does not report activity when file state is unchanged", () => {
    tempDir = mkdtempSync(join(tmpdir(), "file-activity-"));
    const tracked = join(tempDir, "tracked.log");
    writeFileSync(tracked, "stable", "utf8");

    const before = captureFileActivity([tracked]);
    const after = captureFileActivity([tracked]);

    expect(hasFileActivity(before, after)).toBe(false);
  });
});
