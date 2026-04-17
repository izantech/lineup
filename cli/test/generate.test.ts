import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GENERATED_BANNER, HOST_TEMPLATE_SPECS } from "../src/lib/constants";
import { generateHostFiles } from "../src/lib/generate";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function createFixtureSourceRoot(kickoffSkillContent: string): string {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "lineup-generate-"));
  const adapterPath = path.join(sourceRoot, ".lineup-core", "hosts", "codex.json");

  mkdirSync(path.join(fixtureRoot, ".lineup-core", "hosts"), { recursive: true });
  writeFileSync(path.join(fixtureRoot, ".lineup-core", "hosts", "codex.json"), readFileSync(adapterPath, "utf8"), "utf8");

  for (const spec of HOST_TEMPLATE_SPECS) {
    const absolute = path.join(fixtureRoot, spec.source);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(
      absolute,
      spec.source === ".lineup-core/skills/kick-off/core.md" ? kickoffSkillContent : `Generated content for ${spec.source}\n`,
      "utf8"
    );
  }

  return fixtureRoot;
}

describe("host file generation", () => {
  it("generates Codex skill files under .codex/skills", () => {
    const files = generateHostFiles(sourceRoot, "codex");
    const targets = new Set(files.map((file) => file.target));

    expect(targets.has(".codex/skills/lineup-kick-off/SKILL.md")).toBe(true);
    expect(targets.has(".codex/skills/lineup-kick-off/INIT.md")).toBe(true);
    expect(targets.has(".codex/skills/lineup-configure/SKILL.md")).toBe(true);
  });

  it("keeps YAML frontmatter at the top of generated skill files", () => {
    const files = generateHostFiles(sourceRoot, "codex");
    const kickoff = files.find((file) => file.target === ".codex/skills/lineup-kick-off/SKILL.md");

    expect(kickoff).toBeDefined();
    expect(kickoff?.content.startsWith("---\n")).toBe(true);
    expect(kickoff?.content).toContain(`\n${GENERATED_BANNER}\n`);
    expect(kickoff?.content).toContain("\nname: lineup-kick-off\n");
  });

  it("normalizes CRLF frontmatter before injecting the generated banner", () => {
    const fixtureRoot = createFixtureSourceRoot(
      ["---", "name: lineup-kick-off", "description: fixture", "---", "", "Body"].join("\r\n")
    );

    try {
      const files = generateHostFiles(fixtureRoot, "codex");
      const kickoff = files.find((file) => file.target === ".codex/skills/lineup-kick-off/SKILL.md");

      expect(kickoff).toBeDefined();
      expect(kickoff?.content.startsWith("---\n")).toBe(true);
      expect(kickoff?.content).toContain(`---\n\n${GENERATED_BANNER}\n\nBody\n`);
      expect(kickoff?.content).not.toContain("\r\n");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
