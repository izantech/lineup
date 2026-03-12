import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { CliError, asErrorMessage } from "../lib/errors";
import { packageRoot } from "../lib/paths";
import {
  parseRestrictedYaml,
  validateInstallerState,
  validateReleaseManifest,
  validateSourceBundle,
  validateTacticYaml
} from "../lib/validation";

function listYamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertYamlRestrictions(): void {
  const anchors = "a: &ref 1\\nb: *ref\\n";
  try {
    parseRestrictedYaml(anchors, "anchor-fixture.yaml");
  } catch {
    return;
  }

  throw new CliError("YAML restriction check failed: anchors/aliases were accepted.", {
    code: "yaml_restriction_regression"
  });
}

function run(): void {
  const repoRoot = path.resolve(packageRoot(), "..");
  const fixtureRoot = path.join(packageRoot(), "fixtures");

  validateSourceBundle(repoRoot);

  const builtInTactics = listYamlFiles(path.join(repoRoot, "tactics"));
  for (const tacticFile of builtInTactics) {
    const content = readFileSync(tacticFile, "utf8");
    validateTacticYaml(content, tacticFile);
  }

  const exampleTactics = listYamlFiles(path.join(repoRoot, "examples", "tactics"));
  for (const tacticFile of exampleTactics) {
    const content = readFileSync(tacticFile, "utf8");
    validateTacticYaml(content, tacticFile);
  }

  const stateFixture = path.join(fixtureRoot, "state.sample.json");
  validateInstallerState(readJson(stateFixture), stateFixture);

  const manifestFixture = path.join(fixtureRoot, "release-manifest.sample.json");
  validateReleaseManifest(readJson(manifestFixture), manifestFixture);

  assertYamlRestrictions();

  process.stdout.write("Schema check passed.\n");
}

try {
  run();
} catch (error) {
  process.stderr.write(`${asErrorMessage(error)}\n`);
  process.exit(1);
}
