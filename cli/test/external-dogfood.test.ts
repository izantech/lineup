import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const FIXTURES_DIR = join(__dirname, "../fixtures/external-dogfood");

const VALID_COMMANDS = new Set([
  "init",
  "run",
  "cancel",
  "resume",
  "status",
  "doctor",
  "validate",
  "artifacts",
  "workflow",
  "runs",
  "show",
  "logs",
  "approve",
  "pending",
  "tactic",
]);

const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) =>
  f.endsWith(".yaml"),
);

describe("external dogfood fixtures", () => {
  it("finds at least one fixture file", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    describe(file, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      const fixture = parse(raw);

      it("parses as valid YAML", () => {
        expect(fixture).toBeDefined();
        expect(typeof fixture).toBe("object");
      });

      it("has required fields", () => {
        expect(fixture).toHaveProperty("name");
        expect(fixture).toHaveProperty("description");
        expect(fixture).toHaveProperty("repo_shape");
        expect(fixture).toHaveProperty("expected_journeys");
        expect(typeof fixture.name).toBe("string");
        expect(typeof fixture.description).toBe("string");
        expect(Array.isArray(fixture.expected_journeys)).toBe(true);
      });

      it("references valid CLI commands in expected_journeys", () => {
        for (const journey of fixture.expected_journeys) {
          const command = journey.split(" ")[0];
          expect(VALID_COMMANDS).toContain(command);
        }
      });
    });
  }
});
