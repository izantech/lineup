# Commands

## Dev Script

- `./dev check` — run all checks (typecheck, test, schema, generate, build)
- `./dev build` / `./dev typecheck` / `./dev test` — individual checks
- `./dev install local` — clean-replace the global CLI and managed host skills from the current source tree
- `./dev install remote` — install latest from npm
- `./dev install clean [--purge]` — remove CLI and host skills
- `./dev web` — start website dev server (Astro + Starlight)
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
- `lineup approve <run-id> [--json]`
- `lineup pending [--json]`
- `lineup gate respond <run-id> <request-id> --choice <value> [--reason <text>] [--json]`
- `lineup completion <bash|zsh|fish>`
- `lineup dag [--workflow <path>] [--json]`
- `lineup waves [--run <id>] [--compact] [--json]`
- `lineup history [--status <status>] [--limit <n>] [--json]`

## Run Modes

`lineup run` supports two runtime modes:

- `human` — interactive prompts and human-readable progress
- `host` — NDJSON protocol output for skills, automation, and CI

If omitted, `--mode` defaults to `human` on a TTY and `host` otherwise.

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
