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
- `lineup start [task] [--workflow <path>] [--tactic <name>] [--host claude|codex|opencode] [--mode human|host] [--max-parallel <n>] [--isolation index|full|sparse] [--implement-method phase|task|single-session] [--approve-plan] [--gate-timeout <seconds>]`
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
- `lineup tactic list [--json] [--include-builtins]`
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

- `lineup start "<task>"` is the best first native entrypoint in a new repo because it scaffolds Lineup, checks readiness, and only starts the run once the repo is actually ready
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

`lineup tactic list` stays focused on repo-local/project tactics by default.
Use `lineup tactic list --include-builtins` when you want bundled CLI tactics in
the same listing. Built-ins are labeled with `source: builtin`; repo-local tactics
are labeled `source: project-local` in JSON and in the text list when built-ins
are included.

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

For detached bridge runs, `recovery.action = "resume"` means the host should
surface the timeout state and use the returned recovery command instead of
sending another `lineup bridge answer`.

The human-readable `lineup bridge events` output also prints:

- `next_cursor`
- `continue_with` — the exact next poll command using `--after <next_cursor>`
- `recovery` — the next concrete step for the current session, which may point to a specific artifact inspection command when the run has produced a relevant artifact

Keep `lineup run --mode host` for advanced integrations and CI that need the low-level
NDJSON protocol directly.

For first-run onboarding:

- `lineup start "<task>"` runs `init`-style scaffolding automatically, checks readiness, and only hands off to the native pipeline when the repo is ready
- if the repo still needs an initial commit, `lineup start` stops with the exact `git add -A && git commit -m "Initial commit"` command and a rerun command
- `lineup doctor --json` reports the same readiness checks explicitly and includes `next_commands` for common fixes such as `lineup init`, `git add -A && git commit -m "Initial commit"`, installing a supported host CLI when no local executor is available, and Ollama readiness when host integration is enabled for Claude, Codex, or OpenCode
- see [Ollama](./ollama.md) for the exact `host_integration` config shape and host-specific launch behavior

Before the first full native run without `lineup start`, make sure:

- `lineup init` has scaffolded `.lineup-core/workflows/full-pipeline.yaml`
- `lineup init` has initialized a git repository if one was missing
- the repository has at least one commit

`lineup run` also repairs a few common host/runtime output issues before failing:

- fenced JSON/YAML payloads are unwrapped and revalidated
- host planner output gets one stricter retry if it is prose instead of a structured `Plan`
- native developer responses accept common variants like `status: done`
- markdown-style reviewer summaries are normalized into `Review` YAML

For native recovery:

- blocked runs now point directly at `lineup resume <run-id>`, `lineup show <run-id>`, and `lineup cancel <run-id>` instead of a generic blocked status
- failed native runs now surface the run id together with `lineup show`, `lineup logs`, and `lineup resume <run-id> --retry-failed`
- stale runtime lock conflicts now identify the active run and suggest `lineup show <active-run>` and `lineup cancel <active-run>` before telling you to remove `.lineup/runtime.lock`
- `lineup resume` now explains whether you are resuming a blocked run, retrying a failed stage, or continuing a canceled run, and preserves gate-timeout context when a run blocked waiting for an answer

Inspection polish:

- `lineup show` now prints a compact inspection summary in text mode: timings, task-wave summary when a `tasks` artifact exists, a `what changed in this run?` section, concrete `next:` commands, and artifact-specific inspection commands
- `lineup show --watch` exits as soon as a run becomes blocked and prints the next concrete action instead of looping forever
- `lineup artifacts diff` now prints a short diff header with run ids and artifact hashes in text mode, and JSON output now includes the compared hashes and paths as additive metadata
