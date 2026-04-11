import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CliError } from "../src/lib/errors";
import {
  parseRestrictedYaml,
  validateHostAdapter,
  validateInstallerState,
  validateTacticYaml
} from "../src/lib/validation";

describe("schema validation", () => {
  it("validates opencode.json against host adapter schema", () => {
    const filePath = path.resolve(process.cwd(), "..", ".lineup-core", "hosts", "opencode.json");
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    expect(() => validateHostAdapter(payload, filePath)).not.toThrow();
  });

  it("rejects invalid host adapter json", () => {
    const invalid = {
      host: "claude"
    };

    expect(() => validateHostAdapter(invalid, "fixture/host.json")).toThrow(CliError);
  });

  it("rejects invalid state json", () => {
    const invalid = {
      schema_version: 1,
      updated_at: null,
      hosts: {
        claude: {
          installed: true,
          last_action: "install"
        }
      }
    };

    expect(() => validateInstallerState(invalid, "fixture/state.json")).toThrow(CliError);
  });

  it("rejects tactic YAML anchors and aliases", () => {
    const anchored = "name: sample\ndescription: x\nstages: &s []\nverification: *s\n";
    expect(() => parseRestrictedYaml(anchored, "fixture/tactic.yaml")).toThrow(CliError);
  });

  it("rejects malformed tactic YAML", () => {
    const malformed = "name: sample\ndescription: bad\nstages:\n  - type: research\n    agent: researcher\nverification\n  - check\n";
    expect(() => validateTacticYaml(malformed, "fixture/tactic.yaml")).toThrow(CliError);
  });
});
