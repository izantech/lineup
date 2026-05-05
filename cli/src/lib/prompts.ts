import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { HostName } from "./constants";
import { MODEL_ALIASES } from "./constants";
import { CliError } from "./errors";
import { claudeLineupConfigPath, codexLineupConfigPath, opencodeLineupConfigPath } from "./paths";

export function isInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

function createInterface() {
  return readline.createInterface({ input, output });
}

function parseYesNo(raw: string, defaultValue: boolean): boolean | null {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }

  if (value === "y" || value === "yes") {
    return true;
  }

  if (value === "n" || value === "no") {
    return false;
  }

  return null;
}

export async function promptHostSelection(): Promise<HostName[]> {
  const rl = createInterface();

  try {
    output.write("Select host(s):\n");
    output.write("  1. claude\n");
    output.write("  2. codex\n");
    output.write("  3. opencode\n");
    output.write("  4. all\n");

    while (true) {
      const answer = await rl.question("Enter selection [1-4]: ");
      const normalized = answer.trim().toLowerCase();
      if (normalized === "1" || normalized === "claude") {
        return ["claude"];
      }
      if (normalized === "2" || normalized === "codex") {
        return ["codex"];
      }
      if (normalized === "3" || normalized === "opencode") {
        return ["opencode"];
      }
      if (normalized === "4" || normalized === "all") {
        return ["claude", "codex", "opencode"];
      }
      output.write("Invalid selection. Choose 1, 2, 3, or 4.\n");
    }
  } finally {
    rl.close();
  }
}

export async function promptConfirm(message: string, defaultValue = false): Promise<boolean> {
  const rl = createInterface();

  try {
    while (true) {
      const suffix = defaultValue ? "[Y/n]" : "[y/N]";
      const answer = await rl.question(`${message} ${suffix} `);
      const parsed = parseYesNo(answer, defaultValue);
      if (parsed === null) {
        output.write("Please answer yes or no.\n");
        continue;
      }

      return parsed;
    }
  } finally {
    rl.close();
  }
}

export async function promptMigrationConfirm(): Promise<boolean> {
  return promptConfirm("Detected existing lineup@izantech install. Migrate to CLI-managed install now?", true);
}

export async function promptOpencodeModels(homeDir: string, force = false): Promise<{ regular: string; mini: string }> {
  const configPath = opencodeLineupConfigPath(homeDir);

  if (!force && existsSync(configPath)) {
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf8");
    } catch (err) {
      throw new CliError(`OpenCode install-config at ${configPath} could not be read: ${err instanceof Error ? err.message : String(err)}`, { code: "opencode_models_invalid" });
    }
    const lines = raw.split("\n");
    const parsed: Record<string, string> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) parsed[key] = value;
    }
    const REQUIRED_KEYS = ["regular", "mini"];
    const missing = REQUIRED_KEYS.filter((k) => !parsed[k]);
    if (missing.length > 0) {
      throw new CliError(
        `OpenCode install-config at ${configPath} is missing required keys: ${missing.join(", ")}. Edit the file or delete it to re-prompt.`,
        { code: "opencode_models_invalid" }
      );
    }
    return { regular: parsed["regular"], mini: parsed["mini"] };
  }

  if (!isInteractive()) {
    throw new CliError(
      `OpenCode install requires model configuration. Run 'lineup install opencode' interactively first to set up ${configPath}, then re-run in CI.`,
      { code: "opencode_models_required" }
    );
  }

  const rl = createInterface();

  try {
    output.write("OpenCode model configuration\n");

    let regular = "";
    while (!regular) {
      regular = (await rl.question("OpenCode regular model (used for sonnet/opus tiers) [anthropic/claude-sonnet-4-6]: ")).trim();
      if (!regular) regular = "anthropic/claude-sonnet-4-6";
    }

    let mini = "";
    while (!mini) {
      mini = (await rl.question("OpenCode mini model (used for haiku tier) [anthropic/claude-haiku-4-5]: ")).trim();
      if (!mini) mini = "anthropic/claude-haiku-4-5";
    }

    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, `regular: ${regular}\nmini: ${mini}\n`, "utf8");

    return { regular, mini };
  } finally {
    rl.close();
  }
}

export async function promptClaudeModels(homeDir: string, force = false): Promise<{ opus: string; sonnet: string; haiku: string }> {
  const configPath = claudeLineupConfigPath(homeDir);

  if (!force && existsSync(configPath)) {
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf8");
    } catch (err) {
      throw new CliError(`Claude install-config at ${configPath} could not be read: ${err instanceof Error ? err.message : String(err)}`, { code: "claude_models_invalid" });
    }
    const lines = raw.split("\n");
    const parsed: Record<string, string> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) parsed[key] = value;
    }
    const REQUIRED_KEYS = ["opus", "sonnet", "haiku"];
    const missing = REQUIRED_KEYS.filter((k) => !parsed[k]);
    if (missing.length > 0) {
      throw new CliError(
        `Claude install-config at ${configPath} is missing required keys: ${missing.join(", ")}. Edit the file or delete it to re-prompt.`,
        { code: "claude_models_invalid" }
      );
    }
    return { opus: parsed["opus"], sonnet: parsed["sonnet"], haiku: parsed["haiku"] };
  }

  if (!isInteractive()) {
    throw new CliError(
      `Claude install requires model configuration. Run 'lineup install claude' interactively first to set up ${configPath}, then re-run in CI.`,
      { code: "claude_models_required" }
    );
  }

  const rl = createInterface();

  try {
    output.write("Claude model configuration\n");

    let opus = "";
    while (!opus) {
      opus = (await rl.question("Claude opus model [claude-opus-4-7]: ")).trim();
      if (!opus) opus = "claude-opus-4-7";
    }

    let sonnet = "";
    while (!sonnet) {
      sonnet = (await rl.question("Claude sonnet model [claude-sonnet-4-6]: ")).trim();
      if (!sonnet) sonnet = "claude-sonnet-4-6";
    }

    let haiku = "";
    while (!haiku) {
      haiku = (await rl.question("Claude haiku model [claude-haiku-4-5]: ")).trim();
      if (!haiku) haiku = "claude-haiku-4-5";
    }

    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, `opus: ${opus}\nsonnet: ${sonnet}\nhaiku: ${haiku}\n`, "utf8");

    return { opus, sonnet, haiku };
  } finally {
    rl.close();
  }
}

export interface CodexModelsConfig {
  haiku: string;
  sonnet: string;
  opus: string;
  haikuReasoningEffort: string;
  sonnetReasoningEffort: string;
  opusReasoningEffort: string;
}

export async function promptCodexModels(homeDir: string, force = false): Promise<CodexModelsConfig> {
  const configPath = codexLineupConfigPath(homeDir);

  if (!force && existsSync(configPath)) {
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf8");
    } catch (err) {
      throw new CliError(`Codex install-config at ${configPath} could not be read: ${err instanceof Error ? err.message : String(err)}`, { code: "codex_models_invalid" });
    }
    const lines = raw.split("\n");
    const parsed: Record<string, string> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) parsed[key] = value;
    }
    const hasTierConfig = Boolean(parsed["haiku"] && parsed["sonnet"] && parsed["opus"]);
    const hasLegacyConfig = Boolean(parsed["regular"] && parsed["mini"]);
    const REQUIRED_KEYS = ["haiku", "sonnet", "opus"];
    const missing = hasTierConfig ? [] : REQUIRED_KEYS.filter((k) => !parsed[k]);
    if (missing.length > 0) {
      if (!hasLegacyConfig) {
        throw new CliError(
          `Codex install-config at ${configPath} is missing required keys: ${missing.join(", ")}. Edit the file or delete it to re-prompt.`,
          { code: "codex_models_invalid" }
        );
      }
      return {
        haiku: parsed["mini"],
        sonnet: MODEL_ALIASES.codex.sonnet,
        opus: MODEL_ALIASES.codex.opus,
        haikuReasoningEffort: MODEL_ALIASES.codex.haikuReasoningEffort,
        sonnetReasoningEffort: MODEL_ALIASES.codex.sonnetReasoningEffort,
        opusReasoningEffort: MODEL_ALIASES.codex.opusReasoningEffort
      };
    }
    return {
      haiku: parsed["haiku"],
      sonnet: parsed["sonnet"],
      opus: parsed["opus"],
      haikuReasoningEffort: parsed["haiku_reasoning_effort"] || MODEL_ALIASES.codex.haikuReasoningEffort,
      sonnetReasoningEffort: parsed["sonnet_reasoning_effort"] || MODEL_ALIASES.codex.sonnetReasoningEffort,
      opusReasoningEffort: parsed["opus_reasoning_effort"] || MODEL_ALIASES.codex.opusReasoningEffort
    };
  }

  if (!isInteractive()) {
    throw new CliError(
      `Codex install requires model configuration. Run 'lineup install codex' interactively first to set up ${configPath}, then re-run in CI.`,
      { code: "codex_models_required" }
    );
  }

  const rl = createInterface();

  try {
    output.write("Codex model configuration\n");

    let haiku = "";
    while (!haiku) {
      haiku = (await rl.question(`Codex Haiku-tier model [${MODEL_ALIASES.codex.haiku}]: `)).trim();
      if (!haiku) haiku = MODEL_ALIASES.codex.haiku;
    }

    let sonnet = "";
    while (!sonnet) {
      sonnet = (await rl.question(`Codex Sonnet-tier model [${MODEL_ALIASES.codex.sonnet}]: `)).trim();
      if (!sonnet) sonnet = MODEL_ALIASES.codex.sonnet;
    }

    let opus = "";
    while (!opus) {
      opus = (await rl.question(`Codex Opus-tier model [${MODEL_ALIASES.codex.opus}]: `)).trim();
      if (!opus) opus = MODEL_ALIASES.codex.opus;
    }

    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, [
      `haiku: ${haiku}`,
      `haiku_reasoning_effort: ${MODEL_ALIASES.codex.haikuReasoningEffort}`,
      `sonnet: ${sonnet}`,
      `sonnet_reasoning_effort: ${MODEL_ALIASES.codex.sonnetReasoningEffort}`,
      `opus: ${opus}`,
      `opus_reasoning_effort: ${MODEL_ALIASES.codex.opusReasoningEffort}`,
      ""
    ].join("\n"), "utf8");

    return {
      haiku,
      sonnet,
      opus,
      haikuReasoningEffort: MODEL_ALIASES.codex.haikuReasoningEffort,
      sonnetReasoningEffort: MODEL_ALIASES.codex.sonnetReasoningEffort,
      opusReasoningEffort: MODEL_ALIASES.codex.opusReasoningEffort
    };
  } finally {
    rl.close();
  }
}

export async function promptUninstallPlan(hosts: HostName[]): Promise<{ proceed: boolean; purge: boolean }> {
  const proceed = await promptConfirm(`Uninstall Lineup for host(s): ${hosts.join(", ")}?`, false);
  if (!proceed) {
    return { proceed: false, purge: false };
  }

  const purge = await promptConfirm(
    "Also purge Lineup data (~/.claude/lineup/agents, ~/.codex/lineup/agents, ~/.codex/lineup/memory, ~/.config/opencode/lineup)?",
    false
  );

  return { proceed: true, purge };
}
