import { CliError } from "../lib/errors.js";
import { printTableLine } from "../lib/output.js";

export type CompletionCommandOptions = {
  shell: string;
};

const COMMANDS = [
  "install", "update", "uninstall", "status", "doctor", "run", "runs",
  "show", "logs", "resume", "cancel", "validate", "init", "approve", "pending",
  "artifacts", "workflow", "tactic", "completion", "dag"
];

const BASH_COMPLETION = `
_lineup_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${COMMANDS.join(" ")}"
  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _lineup_completions lineup
`.trim();

const ZSH_COMPLETION = `
#compdef lineup
_lineup() {
  local commands=(${COMMANDS.map(c => `"${c}"`).join(" ")})
  _describe 'command' commands
}
_lineup
`.trim();

const FISH_COMPLETION = COMMANDS.map(c => `complete -c lineup -n "__fish_use_subcommand" -a "${c}"`).join("\n");

export async function runCompletionCommand(options: CompletionCommandOptions): Promise<void> {
  switch (options.shell) {
    case "bash":
      printTableLine(BASH_COMPLETION);
      break;
    case "zsh":
      printTableLine(ZSH_COMPLETION);
      break;
    case "fish":
      printTableLine(FISH_COMPLETION);
      break;
    default:
      throw new CliError(`Unsupported shell: ${options.shell}. Use bash, zsh, or fish.`, { code: "cli_error" });
  }
}
