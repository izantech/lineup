# AGENTS.md

Lineup is a multi-agent pipeline for Claude Code, Codex CLI, and OpenCode that picks the right model for every task — automatically.

Pipeline: **Triage -> Clarify -> Research -> Clarification Gate -> Plan -> Implement -> Verify -> Document?**

Stage 0 (Triage) classifies complexity, identifies affected areas, and produces search targets before any agent is spawned. Distributed via a single CLI (`lineup`) across all supported hosts.

`lineup run` has two public modes:

- `human` — interactive local terminal execution
- `host` — NDJSON protocol mode for generated skills and automation

In `host` mode, treat artifact handoff files as part of the runtime contract:
- planner output path from `agent/spawn.params.outputs.path`
- native task/review response files under `.lineup/.runs/<id>/artifacts/native/responses/`
- write host-produced files atomically (temp file + rename)

When updating pipeline behavior, keep the CLI, `.lineup-core/skills/**`, and `docs/`
aligned on that contract.

## Documentation

Detailed agent-facing documentation lives in `docs/`:

- [Commands](docs/commands.md) — dev script and CLI runtime reference
- [Architecture](docs/architecture.md) — canonical+adapter model, CLI package internals
- [Pipeline](docs/pipeline.md) — triage optimizations, task compilation, caching, snapshots
- [Agents](docs/agents.md) — agent definitions, Ollama appendices, config overrides, memory
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
