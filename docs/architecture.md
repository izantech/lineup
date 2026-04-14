# Architecture

## Canonical + Adapter Model

Lineup avoids prompt drift by keeping one canonical source and generating host artifacts at install time.

```
.lineup-core/skills/**        → Canonical skill templates (source of truth)
  kick-off/core.md            → Lean CLI wrapper: launch pipeline, handle gates, present results
  kick-off/init.core.md       → Pre-flight: override detection, tactic selection, health check
  configure/core.md           → Agent config customization (models, tools, memory, Ollama)
  digest/core.md              → Codebase onboarding digest generator
  playbook/core.md            → Tactic CRUD manager
  explain/core.md             → Explain alias (delegates to CLI tactic)
.lineup-core/hosts/*.json     → Host adapter maps (claude, codex, opencode)
agents/*.md                   → Shared agent definitions
tactics/*.yaml                → Built-in tactics
templates/*.yaml              → YAML format references
cli/                          → Lineup CLI package (native runtime, command surface, host lifecycle)
```

Generated host outputs are **not committed** to git:

- Claude skill files are generated into the CLI-managed local plugin directory during install/update.
- Codex skill files are generated and synced into `$HOME/.agents/skills/lineup-*`.

## CLI Package (`cli/`)

`cli/` is the source of truth for distribution and host lifecycle management. It
also ships bundled tactics in `cli/tactics/` so installed skills can resolve
`--tactic explain` outside the Lineup repo, and so `lineup tactic list
--include-builtins` can surface the bundled set alongside project-local tactics.

Key internals:

- `cli/src/cli.ts` — Commander command registration and dispatch
- `cli/src/commands/*.ts` — CLI command handlers (runtime, inspection, lifecycle, gate operations)
- `cli/src/lib/run-pipeline.ts` — Pipeline orchestration engine with gate blocking
- `cli/src/commands/bridge.ts` — Detached bridge session lifecycle for generated skills
- `cli/src/lib/bridge.ts` — Bridge session/event persistence, reconnect-safe pending gate state, and replay
- `cli/src/lib/git.ts` — project git readiness checks and tree SHA resolution
- `cli/src/lib/protocol.ts` — NDJSON protocol types (gate/request, gate/respond, agent/spawn)
- `cli/src/lib/gate-store.ts` — Gate request/response file persistence, `GateTimeoutError`
- `cli/src/lib/interactive-gate.ts` — Interactive stdin gate handler for `lineup run --mode human`
- `cli/src/lib/executor.ts` — Native task/review driver, host response-file waits, artifact normalization
- `cli/src/lib/verification.ts` — Auto-detect and run project test/typecheck/lint hooks
- `cli/src/lib/tactic-convert.ts` — Tactic-to-Workflow auto-converter
- `cli/src/lib/release.ts` — GitHub release resolution, cache, checksum verification
- `cli/src/lib/generate.ts` — template rendering using host adapters
- `cli/src/lib/host-claude.ts` — Claude lifecycle and migration handling
- `cli/src/lib/host-codex.ts` — Codex global skill sync/uninstall/status
- `cli/src/lib/validation.ts` — AJV + YAML parsing + schema checks + agent output validation
- `cli/src/lib/dag.ts` — Task compilation, cross-cutting detection, read-write dependency analysis
- `cli/src/commands/replay.ts` — Pipeline run narrative replay
- `cli/schemas/**` — JSON/YAML schemas

Agent prompt resolution prefers repo-local `agents/*.md` when present, then falls back to
bundled definitions shipped in `cli/agents/` so freshly initialized projects can execute
without copying agent files into the repo.

Fresh projects still need a git repository with at least one commit before native
implementation can run, because isolation uses detached git worktrees.

The bridge session record persists more than an event cursor. It also stores the
latest unresolved gate metadata, whether the worker is still waiting for an answer,
and whether the run has moved into blocked timeout recovery. This lets generated
skills reconnect without replaying the full event stream and distinguish between:

- live unanswered gates (`recovery.action = "answer"`)
- timed-out blocked runs that need `recovery.action = "resume"` and an explicit recovery command
- completed runs that should be inspected with `lineup show` / `lineup logs`
