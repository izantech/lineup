import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Claude local install lifecycle", () => {
  let tempHome: string;

  beforeEach(() => {
    vi.resetModules();
    tempHome = mkdtempSync(join(tmpdir(), "lineup-claude-install-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("rebuilds the managed plugin directory from scratch for the same version", async () => {
    const { prepareClaudePluginFromSource } = await import("../src/lib/host-claude.js");
    const targetRoot = join(tempHome, ".lineup", "hosts", "claude", "marketplace", "plugins", "lineup", "3.0.0");
    mkdirSync(targetRoot, { recursive: true });
    writeFileSync(join(targetRoot, "STALE.txt"), "stale", "utf8");

    const preparedRoot = prepareClaudePluginFromSource(sourceRoot, "3.0.0", tempHome);

    expect(preparedRoot).toBe(targetRoot);
    expect(existsSync(join(targetRoot, "STALE.txt"))).toBe(false);
    expect(existsSync(join(targetRoot, "skills", "kick-off", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(targetRoot, "skills", "kick-off", "SKILL.md"), "utf8")).toContain("AUTO-GENERATED");
  });

  it("uninstall removes old managed plugin versions and marketplace metadata", async () => {
    vi.doMock("../src/lib/process.js", () => ({
      runCommand: vi.fn(async () => ({
        code: 0,
        stdout: "",
        stderr: ""
      })),
      assertSuccess: vi.fn()
    }));

    const { uninstallClaude } = await import("../src/lib/host-claude.js");

    const versionsRoot = join(tempHome, ".lineup", "hosts", "claude", "marketplace", "plugins", "lineup");
    mkdirSync(join(versionsRoot, "2.2.0"), { recursive: true });
    mkdirSync(join(versionsRoot, "3.0.0"), { recursive: true });
    const manifestPath = join(tempHome, ".lineup", "hosts", "claude", "marketplace", ".claude-plugin", "marketplace.json");
    mkdirSync(join(tempHome, ".lineup", "hosts", "claude", "marketplace", ".claude-plugin"), { recursive: true });
    writeFileSync(manifestPath, "{}", "utf8");

    await uninstallClaude(tempHome);

    expect(existsSync(join(versionsRoot, "2.2.0"))).toBe(false);
    expect(existsSync(join(versionsRoot, "3.0.0"))).toBe(false);
    expect(existsSync(manifestPath)).toBe(false);
  });
});
