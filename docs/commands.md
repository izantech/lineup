# Commands

## Dev Script

- `./dev check` — run all checks (typecheck, test, schema, generate, build)
- `./dev build` / `./dev typecheck` / `./dev test` — individual checks
- `./dev install local` — clean-replace the global CLI and managed host skills from the current source tree; auto-installs missing CLI deps first
- `./dev install remote` — install latest from npm
- `./dev install clean [--purge]` — remove CLI and host skills
- `./dev web` — start website dev server (Astro + Starlight); auto-installs missing site deps first
- `./dev bench [--agent claude|codex|opencode] [--auto-models] [...]` — run Ollama benchmark
- `./dev bench clean` — remove benchmark results
- `./dev clean [--dry-run]` — remove all generated artifacts (build, benchmark, cache)
- `./dev setup` — install dependencies

## CLI Runtime

- `lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]`
- `lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]`
- `lineup doctor [--json]`
- `lineup run [task] [--workflow <path>] [--tactic <name>] [--from-stage <id>] [--dry-run] [--force-rerun] [--max-parallel <n>] [--isolation index|full|sparse] [--mode human|host] [--implement-method phase|task|single-session] [--approve-plan] [--gate-timeout <seconds>]`
- `lineup bridge start [task] --executor-host <host> [--workflow <path>] [--tactic <name>] [--timeout <seconds>] [--max-parallel <n>] [--isolation index|full|sparse] [--implement-method phase|task|single-session] [--approve-plan] [--gate-timeout <seconds>] [--json]`
- `lineup bridge events <run-id> [--after <seq>] [--wait <seconds>] [--json]`
- `lineup bridge answer <run-id> <request-id> --choice <value> [--reason <text>] [--json]`
- `lineup runs [--status <status>] [--json]`
- `lineup show <run-id> [-w|--watch] [--json]`
- `lineup logs <run-id> [--json]`
- `lineup replay <run-id> [--json]`
- `lineup resume <run-id> [--skip-task <id>] [--retry-failed] [--max-retries <n>] [--json]`
- `lineup cancel <run-id> [--json]`
- `lineup validate <file> [--kind <kind>] [--json]`
- `lineup artifacts show <kind> [--run <id>] [--json]`
- `lineup artifacts path <kind> [--run <id>]`
- `lineup artifacts diff <kind> [--from <run-id>] [--to <run-id>] [--json]`
- `lineup init [--workflow <name>] [--json]`
- `lineup workflow lint <path> [--json]`
- `lineup workflow list [--json]`
- `lineup tactic new <name>`
- `lineup tactic list [--json]`
- `lineup tactic convert <name> [--json]`
- `lineup approve <run-id> [--json]`
- `lineup pending [--json]`
- `lineup gate respond <run-id> <request-id> --choice <value> [--reason <text>] [--json]`
- `lineup completion <bash|zsh|fish>`
- `lineup dag [--workflow <path>] [--json]`
- `lineup waves [--run <id>] [--compact] [--json]`
- `lineup history [--status <status>] [--limit <n>] [--json]`

## Entry Points

Lineup users interact with the engine in two ways:

- directly through the CLI
- indirectly through generated host skills

The CLI is always the source of truth. Skills are wrappers that call the CLI.

Practical split:

- `lineup run "<task>"` is the normal direct-entry command for humans in a terminal
- `lineup bridge start|events|answer` is the normal skill-facing contract for Claude/Codex/OpenCode wrappers
- `lineup run --mode host` remains the low-level raw protocol path for advanced integrations and CI

## Run Modes

`lineup run` supports two runtime modes:

- `human` — interactive prompts and human-readable progress
- `host` — NDJSON protocol output for skills, automation, and CI

If omitted, `--mode` defaults to `human` on a TTY and `host` otherwise.

Generated skills should prefer the detached bridge API:

- `lineup bridge start` launches a CLI-owned detached session
- `lineup bridge events` returns compact replayable `status`, `question`, and `complete` events plus reconnect-safe `session`, `pendingQuestion`, and `recovery` fields
- `lineup bridge answer` responds to pending bridge questions

Built-in tactics shipped with the CLI can also be resolved by name. For example,
`lineup bridge start "<question>" --tactic explain --executor-host codex` works
even in repos that do not define `./tactics/explain.yaml` or `.lineup/tactics/explain.yaml`.

`lineup tactic list` still reflects repo-local/project tactics. Use
`lineup tactic convert explain --json` or run the tactic directly when you need a
built-in CLI tactic like `explain`.

`lineup bridge events --json` keeps:

- `runId`
- `events`
- `nextCursor`
- `terminal`
- `status`

And also returns:

- `session` — `executorHost`, `workflow`, `tactic`, `createdAt`, `updatedAt`, `completedAt`, `currentSeq`
- `pendingQuestion` — the unresolved gate even if the caller's cursor is already past the original `question` event
- `recovery` — the next concrete CLI step for the current session (`answer`, `resume`, or `inspect`)

The human-readable `lineup bridge events` output also prints:

- `next_cursor`
- `continue_with` — the exact next poll command using `--after <next_cursor>`
- `recovery`

Keep `lineup run --mode host` for advanced integrations and CI that need the low-level
NDJSON protocol directly.

Before the first full native run, make sure:

- `lineup init` has scaffolded `.lineup-core/workflows/full-pipeline.yaml`
- `lineup init` has initialized a git repository if one was missing
- the repository has at least one commit

`lineup doctor --json` reports all three checks explicitly.

`lineup run` also repairs a few common host/runtime output issues before failing:

- fenced JSON/YAML payloads are unwrapped and revalidated
- host planner output gets one stricter retry if it is prose instead of a structured `Plan`
- native developer responses accept common variants like `status: done`
- markdown-style reviewer summaries are normalized into `Review` YAML
