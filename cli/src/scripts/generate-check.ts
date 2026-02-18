import path from "node:path";

import { CODEX_REQUIRED_FILES } from "../lib/constants";
import { CliError, asErrorMessage } from "../lib/errors";
import { generateHostFiles, loadHostAdapter } from "../lib/generate";
import { packageRoot } from "../lib/paths";

function assertDeterministic(sourceRoot: string): void {
  const first = {
    claude: generateHostFiles(sourceRoot, "claude"),
    codex: generateHostFiles(sourceRoot, "codex")
  };

  const second = {
    claude: generateHostFiles(sourceRoot, "claude"),
    codex: generateHostFiles(sourceRoot, "codex")
  };

  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new CliError("Host file generation is not deterministic.", {
      code: "generation_non_deterministic"
    });
  }
}

function assertRequiredOutputs(sourceRoot: string): void {
  const claude = generateHostFiles(sourceRoot, "claude");
  const codex = generateHostFiles(sourceRoot, "codex");

  const claudeAdapter = loadHostAdapter(sourceRoot, "claude");
  const expectedClaude = new Set<string>([
    `skills/${claudeAdapter.vars.SKILL_NAME_KICKOFF}/SKILL.md`,
    `skills/${claudeAdapter.vars.SKILL_NAME_KICKOFF}/INIT.md`,
    `skills/${claudeAdapter.vars.SKILL_NAME_CONFIGURE}/SKILL.md`,
    `skills/${claudeAdapter.vars.SKILL_NAME_EXPLAIN}/SKILL.md`,
    `skills/${claudeAdapter.vars.SKILL_NAME_PLAYBOOK}/SKILL.md`
  ]);

  const actualClaude = new Set<string>(claude.map((file) => file.target));
  for (const required of expectedClaude) {
    if (!actualClaude.has(required)) {
      throw new CliError(`Missing generated Claude output: ${required}`, {
        code: "missing_claude_generated_file"
      });
    }
  }

  const actualCodex = new Set<string>(codex.map((file) => file.target));
  for (const required of CODEX_REQUIRED_FILES) {
    if (!actualCodex.has(required)) {
      throw new CliError(`Missing generated Codex output: ${required}`, {
        code: "missing_codex_generated_file"
      });
    }
  }
}

function run(): void {
  const sourceRoot = path.resolve(packageRoot(), "..");

  assertDeterministic(sourceRoot);
  assertRequiredOutputs(sourceRoot);

  process.stdout.write("Generation check passed.\n");
}

try {
  run();
} catch (error) {
  process.stderr.write(`${asErrorMessage(error)}\n`);
  process.exit(1);
}
