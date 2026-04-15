# Commands

This page is the operator reference. If you want the human frontend, start with `lineup` in an interactive terminal or use `lineup tui`. If you want the machine surface, use the subcommands below.

## Dev Script

- `./dev check` - run all checks
- `./dev build`, `./dev typecheck`, `./dev test` - individual checks
- `./dev tui` - launch the local-source TUI without installing `lineup` globally
- `./dev install local` - rebuild and reinstall from the current source tree
- `./dev install remote` - install latest from npm
- `./dev install clean [--purge]` - remove CLI and host skills
- `./dev web` - start the website dev server
- `./dev setup` - install dependencies

## What to use when

- `lineup` or `lineup tui` - interactive use in a terminal
- `lineup <subcommand>` - operator, repo maintenance, and CI use
- `lineup bridge start|events|answer` - generated host skills and detached sessions
- `lineup run --mode host` - raw NDJSON protocol for advanced integrations
- `--json` - machine-friendly output on commands that support it

## CLI Reference

### Setup and health

- `lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]`
- `lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]`
- `lineup doctor [--json]`
- `lineup init [--workflow <name>] [--json]`

### Runs and inspection

- `lineup run [task] [--workflow <path>] [--tactic <name>] [--from-stage <id>] [--dry-run] [--force-rerun] [--max-parallel <n>] [--isolation index|full|sparse] [--mode human|host] [--implement-method phase|task|single-session] [--approve-plan] [--gate-timeout <seconds>]`
- `lineup runs [--status <status>] [--json]`
- `lineup show <run-id> [-w|--watch] [--json]`
- `lineup logs <run-id> [--json]`
- `lineup replay <run-id> [--json]`
- `lineup resume <run-id> [--skip-task <id>] [--retry-failed] [--max-retries <n>] [--json]`
- `lineup cancel <run-id> [--json]`
- `lineup history [--status <status>] [--limit <n>] [--json]`
- `lineup waves [--run <id>] [--compact] [--json]`
- `lineup dag [--workflow <path>] [--json]`

### Bridge contract

- `lineup bridge start [task] --executor-host <host> [--workflow <path>] [--tactic <name>] [--timeout <seconds>] [--max-parallel <n>] [--isolation index|full|sparse] [--implement-method phase|task|single-session] [--approve-plan] [--gate-timeout <seconds>] [--json]`
- `lineup bridge events <run-id> [--after <seq>] [--wait <seconds>] [--json]`
- `lineup bridge answer <run-id> <request-id> --choice <value> [--reason <text>] [--json]`

### Artifacts and workflow authoring

- `lineup validate <file> [--kind <kind>] [--json]`
- `lineup artifacts show <kind> [--run <id>] [--json]`
- `lineup artifacts path <kind> [--run <id>]`
- `lineup artifacts diff <kind> [--from <run-id>] [--to <run-id>] [--json]`
- `lineup workflow lint <path> [--json]`
- `lineup workflow list [--json]`
- `lineup tactic new <name>`
- `lineup tactic list [--json] [--include-builtins]`
- `lineup tactic convert <name> [--json]`
- `lineup approve <run-id> [--json]`
- `lineup pending [--json]`
- `lineup gate respond <run-id> <request-id> --choice <value> [--reason <text>] [--json]`
- `lineup completion <bash|zsh|fish>`

## Runtime Contracts

`lineup run` supports two runtime modes:

- `human` - interactive terminal use. The TUI is the normal human surface.
- `host` - NDJSON protocol output for skills, automation, and CI.

If omitted, `--mode` defaults to `human` on a TTY and `host` otherwise.

Generated skills should prefer the detached bridge API:

- `lineup bridge start` launches a CLI-owned detached session
- `lineup bridge events` returns compact replayable `status`, `question`, and `complete` events plus reconnect-safe `session`, `pendingQuestion`, and `recovery` fields
- `lineup bridge answer` responds to pending bridge questions

Built-in tactics shipped with the CLI can also be resolved by name. For example, `lineup bridge start "<question>" --tactic explain --executor-host codex` works even in repos that do not define `./tactics/explain.yaml` or `.lineup/tactics/explain.yaml`.

`lineup tactic list` stays focused on repo-local/project tactics by default. Use `lineup tactic list --include-builtins` when you want bundled CLI tactics in the same listing. Built-ins are labeled with `source: builtin`; repo-local tactics are labeled with `source: project-local` in JSON and in the text list when built-ins are included.

`lineup bridge events --json` keeps:

- `runId`
- `events`
- `nextCursor`
- `terminal`
- `status`

And also returns:

- `session` - `executorHost`, `workflow`, `tactic`, `createdAt`, `updatedAt`, `completedAt`, `currentSeq`
- `pendingQuestion` - the unresolved gate even if the caller's cursor is already past the original `question` event
- `recovery` - the next concrete CLI step for the current session (`answer`, `resume`, or `inspect`)

For detached bridge runs, `recovery.action = "resume"` means the host should surface the timeout state and use the returned recovery command instead of sending another `lineup bridge answer`.

The human-readable `lineup bridge events` output also prints:

- `next_cursor`
- `continue_with` - the exact next poll command using `--after <next_cursor>`
- `recovery` - the next concrete step for the current session, which may point to a specific artifact inspection command when the run has produced a relevant artifact

Keep `lineup run --mode host` for advanced integrations and CI that need the low-level NDJSON protocol directly.

## Notes

- `lineup doctor --json` reports readiness checks explicitly and includes `next_commands` for common fixes such as `lineup init`, `git add -A && git commit -m "Initial commit"`, installing a supported host CLI when no local executor is available, and Ollama readiness when host integration is enabled for Claude, Codex, or OpenCode
- the Ollama validation suite is split across deterministic tests, pipeline/bridge tests, and a local-only smoke lane; see [Ollama](./ollama.md) for the suite layout and the `smoke:ollama-hosts` command
- `lineup run` repairs common host/runtime output issues before failing, including fenced JSON/YAML repair, one stricter retry for prose planner output, and normalization of common artifact shapes
- blocked or failed runs should be recovered with `lineup resume`, `lineup show`, `lineup logs`, or `lineup cancel` depending on state
- `lineup show` prints a compact inspection summary in text mode, and `lineup artifacts diff` includes run ids and artifact hashes in its text output
