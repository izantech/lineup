# AGENTS.md

Lineup is a multi-agent pipeline for Claude Code, Codex CLI, and OpenCode that picks the right model for every task — automatically.

Pipeline: **Triage -> Clarify -> Research -> Clarification Gate -> Plan -> Implement -> Verify -> Document?**

Stage 0 (Triage) classifies complexity, identifies affected areas, and produces search targets before any agent is spawned. Distributed via a single CLI (`lineup`) across all supported hosts.

`lineup run` has two public modes:

- `human` — interactive local terminal execution
- `host` — raw NDJSON protocol mode for advanced integrations and CI

Generated skills should use the bridge API instead of supervising raw host-mode
NDJSON:

- `lineup bridge start <task> --executor-host <host>`
- `lineup bridge events <run-id> --after <seq> --wait <seconds>`
- `lineup bridge answer <run-id> <request-id> --choice <value> [--reason <text>]`

Before the first native run in a new project, run `lineup init`. It scaffolds the
workflow/runtime directories, initializes a git repository if needed, and on the
first interactive init now opens the project config editor for `.lineup/config.yaml`.
Native implementation still requires at least one commit because isolation uses git worktrees.

In bridge mode, treat the compact event stream as the skill contract:
- `status` events carry progress updates
- `question` events require user interaction and must be answered with `lineup bridge answer`
- `complete` events mark terminal status and summary

The runtime now includes a small amount of defensive normalization for raw host
output (fenced payload repair, one planner retry when prose is returned, tolerant
developer/reviewer parsing), but keep generated skills and docs aligned with the
bridge contract rather than relying on recovery behavior.

Ollama host integration is validated in three layers:

- deterministic unit and integration tests for config precedence, launch planning,
  managed config writers, doctor readiness, and runner behavior
- deterministic pipeline and bridge tests that cover full human/local runs,
  bridge mode, and bundled `explain`
- a local-only smoke lane for real Claude, Codex, and OpenCode hosts against a
  real local Ollama daemon

The smoke command is:

- `npm --prefix cli run smoke:ollama-hosts -- --host claude|codex|opencode|all --model <model> [--base-url <url>] [--keep-temp]`

It is local-only and should not be added to CI. Per-host smoke lanes are still
the fastest way to isolate a regression, but `--host all` is now validated on
`qwen3-coder:30b`. The smoke task is
a bounded placeholder replacement in `README.md`, the bundled `explain` tactic
is exercised through the bridge API rather than interactive human mode, the
smoke runner copies the canonical full-pipeline workflow into its temp repo
before execution, and it answers verify gates with `abort` when `retry` is also
present so bad local-model output fails fast instead of compounding.

When updating pipeline behavior, keep the CLI, `.lineup-core/skills/**`, and `docs/`
aligned on that contract.

## Documentation

Detailed agent-facing documentation lives in `docs/`:

- [Commands](docs/commands.md) — dev script and CLI runtime reference
- [Architecture](docs/architecture.md) — canonical+adapter model, CLI package internals
- [Pipeline](docs/pipeline.md) — triage optimizations, task compilation, caching, snapshots
- [Agents](docs/agents.md) — agent definitions, Ollama appendices, config overrides, memory
- [Ollama](docs/ollama.md) — research assist, legacy full routing, and true host integration
- [Skills](docs/skills.md) — lean skill architecture, host command surface
- [Tactics](docs/tactics.md) — project tactics, auto-conversion, composition
- [Gate Protocol](docs/gate-protocol.md) — gate types, interactive mode, retry UX
- [Schemas](docs/schemas.md) — data conventions, document conventions, release process

## Code Style

- TypeScript strict mode, ES modules
- No default exports
- Prefer `const` over `let`; avoid `var`
- Single quotes, no semicolons (enforced by config)
- Error handling: throw typed errors, never swallow exceptions silently
- Agent outputs validated against JSON Schema at runtime
