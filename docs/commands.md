# Commands

## Dev Script

- `./dev check` — run all checks (typecheck, test, schema, generate, build)
- `./dev build` / `./dev typecheck` / `./dev test` — individual checks
- `./dev cli -- <args...>` — run the Lineup CLI directly from source without installing it
- `./dev install local` — clean-replace the global CLI and managed host skills from the current source tree; auto-installs missing CLI deps first
- `./dev install remote` — install latest from npm
- `./dev install clean [--purge]` — remove CLI and host skills
- `./dev web` — generate Mermaid SVGs, then start website dev server (Astro + Starlight); auto-installs missing site deps first
- `./dev web build` — generate Mermaid SVGs, then build the website for production
- `./dev web preview` — generate Mermaid SVGs, then preview the production site build locally
- `./dev bench [--agent claude|codex|opencode] [--auto-models] [...]` — run Ollama benchmark
- `./dev bench clean` — remove benchmark results
- `./dev clean [--dry-run]` — remove all generated artifacts (build, benchmark, cache)
- `./dev setup` — install dependencies

The docs site keeps Mermaid diagram sources in `site/diagrams/*.mmd` and pre-renders
them to `site/public/diagrams/*.svg` before serving or building the site.

## CLI Runtime

- `lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]`
- `lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]`
- `lineup config [show] [--host claude|codex|opencode] [--json]`
- `lineup doctor [--json]`
- `lineup start [task] [--workflow <path>] [--tactic <name>] [--host claude|codex|opencode|ollama] [--runner claude|codex|opencode] [--model <name>] [--mode human|host] [--max-parallel <n>] [--isolation index|full|sparse] [--implement-method phase|task|single-session] [--approve-plan] [--gate-timeout <seconds>]`
- `lineup run [task] [--workflow <path>] [--tactic <name>] [--host claude|codex|opencode|ollama] [--runner claude|codex|opencode] [--model <name>] [--from-stage <id>] [--dry-run] [--force-rerun] [--max-parallel <n>] [--isolation index|full|sparse] [--mode human|host] [--implement-method phase|task|single-session] [--approve-plan] [--gate-timeout <seconds>]`
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
- `npm --prefix cli run smoke:ollama-hosts -- --host claude|codex|opencode|all --model <model> [--base-url <url>] [--keep-temp]` — local-only smoke lane that validates Ollama-backed Claude, Codex, and OpenCode host integrations end to end against a real local Ollama daemon; it creates an isolated temp home and repo, runs `lineup init`, copies the repo's canonical `.lineup-core/workflows/full-pipeline.yaml` into the temp repo, runs `lineup doctor --json`, a deterministic tiny-repo pipeline task, and a bundled `explain` tactic task, then drives bridge questions through the bridge contract; the pipeline task replaces a `README.md` placeholder with exactly one validation sentence, and the `explain` leg also runs through the bridge contract instead of interactive human mode. The smoke lane preserves the temp workspace on failure or stall for debugging, treats host trace/log/artifact growth as progress, answers verify gates with `abort` when `retry` is also available, uses the internal Claude force-env switch instead of PATH mutation when it needs to bypass the wrapper lane, and prints the exact bridge/host trace files to inspect. For current local validation, prefer `qwen3-coder:30b` over `qwen3.5:9b`.
- `npm --prefix cli run validate:direct-hosts -- --host claude|codex|opencode|all [--lane bridge|recovery|human|real-repo|all] [--scenario <name>] [--report <path>] [--skip-preflight] [--skip-certification] [--skip-recovery] [--keep-temp]` — local-only direct-host validation harness for the non-Ollama matrix on the current built runtime. It creates bounded temp repos for bridge and human validation, runs focused recovery scenarios, and uses detached temporary git worktrees for real-repo sweeps so the main checkout is never mutated. The JSON report includes per-host lane/scenario status, exact run ids, host version, preserved temp/worktree paths, trace/log/artifact paths, diff summaries, artifact-parity status, and blocker classification (`contract_breakage`, `host_runtime`, `auth/config`, or `expected_variance`). The human lane uses a PTY-backed transcript harness and now falls back to a Python-created pseudo-terminal on this machine when `node-pty` cannot spawn one directly.

## Entry Points

Lineup users interact with the engine in two ways:

- directly through the CLI
- indirectly through generated host skills

The CLI is always the source of truth. Skills are wrappers that call the CLI.

For the control-flow view with diagrams, see [CLI Overview](./cli-overview.md).

Practical split:

- `lineup start "<task>"` is the best first native entrypoint in a new repo because it scaffolds Lineup, checks readiness, and only starts the run once the repo is actually ready
- `lineup run "<task>"` is the normal direct-entry command for humans in a terminal
- `lineup run "<task>" --host ollama --runner codex --model qwen3-coder:30b` is the explicit local-Ollama path when you want Ollama as the execution host and Codex/Claude/OpenCode only as the runner adapter
- `lineup bridge start|events|answer` is the normal skill-facing contract for Claude/Codex/OpenCode wrappers
- `lineup run --mode host` remains the low-level raw protocol path for advanced integrations and CI
- `npm --prefix cli run smoke:ollama-hosts -- ...` is the local-only packaged CLI smoke runner for validating Ollama host integration across full pipeline, bridge, human/local, and explain coverage; it copies the canonical full-pipeline workflow into its temp repo, uses a bounded deterministic placeholder-replacement task with `README.md` as the first research target, routes the bundled `explain` tactic through the bridge API, can force Claude onto the env transport internally when the wrapper lane needs to be bypassed, and now supports both per-host validation and the combined `--host all` matrix on the current `qwen3-coder:30b` baseline
- `npm --prefix cli run validate:direct-hosts -- ...` is the direct-host companion harness for the same bounded repo/task, intended to be the single source of truth for non-Ollama Claude, Codex, and OpenCode validation across four lanes: bounded bridge certification, focused recovery, PTY-driven `--mode human` parity, and disposable real-repo worktree sweeps

## Run Modes

`lineup run` supports two runtime modes:

- `human` — interactive prompts plus a TTY dashboard on `stderr`
- `host` — NDJSON protocol output for skills, automation, and CI

If omitted, `--mode` defaults to `human` on a TTY and `host` otherwise.

Human mode now uses a capability-aware terminal UI instead of raw `[stage]`
log lines:

- transient progress goes to `stderr`
- stage starts render as `Stage <n>/<total> | <label> | <purpose>`
- TTY runs mount a dynamic dashboard with live timers, stage attempts, pending gates, artifact hints, and next actions
- interactive gate prompts temporarily suspend the dashboard, ask on `stderr`, then resume the live view after the answer
- non-TTY runs append plain ASCII-safe lines with no ANSI cursor movement
- completion renders one final block with status, changed artifacts, and next commands

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

Text-mode bridge output is now structured for operators rather than raw progress
lines:

- `status` events render under normalized stage labels and explicit kinds such as `stage-start`, `progress`, `warning`, and `stage-end`
- `question` events render as multi-line blocks with choices, default choice, expiry, and the exact `lineup bridge answer` command
- `complete` events render a terminal summary plus the best follow-up inspection command when one exists

Keep `lineup run --mode host` for advanced integrations and CI that need the low-level
NDJSON protocol directly.

For first-run onboarding:

- `lineup start "<task>"` runs `init`-style scaffolding automatically, checks readiness, and only hands off to the native pipeline when the repo is ready
- if the repo still needs an initial commit, `lineup start` stops with the exact `git add -A && git commit -m "Initial commit"` command and a rerun command
- the first interactive `lineup init` opens the project config screen after scaffolding finishes
- `lineup config` opens the full-screen project config editor for `.lineup/config.yaml`
- the config editor adapts to narrow terminals by stacking panes instead of forcing the review preview into a fixed side column
- the `ollama.model` field offers detected models from the active Ollama daemon and the local `~/.ollama/models/manifests` cache, with `Custom value...` available when you want to type a model manually
- Ollama fields use `Use higher-layer value` / `Unset in project config` instead of the generic `Inherited` label because unsetting a project value falls back to host config, environment variables, or built-in defaults
- `lineup config show` shows the resolved local host, alias routing, per-agent model targets, and any host-specific Ollama configuration that a human run would use
- `lineup run --host claude|codex|opencode` keeps the normal native path and may still use Ollama integration if config enables it
- `lineup run --host ollama --runner claude|codex|opencode --model <name>` forces the selected runner through the local Ollama backend and does not depend on nested runner host-integration config
- any Ollama-enabled path now fails fast unless the model is set explicitly with `--model <name>` or in `.lineup/config.yaml`
- `lineup doctor --json` reports the same readiness checks explicitly and includes `next_commands` for common fixes such as `lineup init`, `git add -A && git commit -m "Initial commit"`, installing a supported host CLI when no local executor is available, and Ollama readiness when host integration is enabled for Claude, Codex, or OpenCode
- see [Ollama](./ollama.md) for the exact `host_integration` config shape and host-specific launch behavior
- the Ollama validation suite is split across deterministic tests, pipeline/bridge tests, and a local-only smoke lane; see [Ollama](./ollama.md) for the suite layout and the `smoke:ollama-hosts` command
- per-host smoke runs are still the fastest way to isolate a regression, but `--host all` is now part of the validated local smoke workflow on `qwen3-coder:30b`

Before the first full native run without `lineup start`, make sure:

- `lineup init` has scaffolded `.lineup-core/workflows/full-pipeline.yaml`
- `lineup init` has initialized a git repository if one was missing
- the repository has at least one commit

`lineup run` also repairs a few common host/runtime output issues before failing:

- fenced JSON/YAML payloads are unwrapped and revalidated
- host planner output gets one stricter retry if it is prose instead of a structured `Plan`
- pre-stage structured artifacts get one stricter retry if the first output is prose or malformed YAML
- pre-stage research artifacts normalize scalar/list `constraints` and `gaps`
  into schema-valid objects before validation
- pre-stage retries clear the previous artifact path before re-invoking the host so stale malformed artifacts cannot short-circuit the retry
- plan normalization now accepts common host variants such as `file_path`,
  `what_to_change`, and `why_this_change_is_needed`
- native developer responses accept common variants like `status: done`
- markdown-style reviewer summaries are normalized into `Review` YAML

For native recovery:

- blocked runs now point directly at `lineup resume <run-id>`, `lineup show <run-id>`, and `lineup cancel <run-id>` instead of a generic blocked status
- failed native runs now surface the run id together with `lineup show`, `lineup logs`, and `lineup resume <run-id> --retry-failed`
- stale runtime lock conflicts now identify the active run and suggest `lineup show <active-run>` and `lineup cancel <active-run>` before telling you to remove `.lineup/runtime.lock`
- `lineup resume` now explains whether you are resuming a blocked run, retrying a failed stage, or continuing a canceled run, and preserves gate-timeout context when a run blocked waiting for an answer

Inspection polish:

- `lineup show` now prints a compact inspection summary in text mode: timings, task-wave summary when a `tasks` artifact exists, a `what changed in this run?` section, concrete `next:` commands, and artifact-specific inspection commands
- `lineup show --watch` now renders a TTY-only live dashboard with a run header, stage table, pending-question block, change summary, artifact summary, and next actions
- `lineup show --watch` keeps live durations moving even when no new stage events arrive, falls back to append-only snapshots on non-TTY output, and exits once the run is blocked or terminal with the next concrete step
- `lineup artifacts diff` now prints a short diff header with run ids and artifact hashes in text mode, and JSON output now includes the compared hashes and paths as additive metadata
