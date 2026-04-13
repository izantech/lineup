# Contributing to Lineup

Thanks for your interest in contributing to Lineup!

## Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   ./dev setup
   ```
3. Run the checks to make sure everything works:
   ```bash
   ./dev check
   ```

## Development workflow

The `./dev` script at the repo root is the main entry point for development tasks:

```bash
./dev check                     # Run all checks (typecheck, test, schema, generate, build)
./dev build                     # Build CLI
./dev typecheck                 # Run type checks
./dev test                      # Run test suite
./dev install local             # Build from source and install CLI + all host skills
./dev web                       # Start website dev server
```

### Testing your changes locally

To test the full install flow with your local changes:

```bash
./dev install local
```

This builds the CLI from source, installs it globally, and installs skills for all hosts.
It also removes the previous managed CLI/host installation first, so you are always
testing the current source tree instead of a stale local install.

## Project structure

```text
.lineup-core/skills/**        Canonical workflow templates (source of truth)
.lineup-core/hosts/*.json     Host adapter maps (claude, codex, opencode)
agents/*.md                   Shared agent definitions
tactics/*.yaml                Built-in tactics
cli/                          Native runtime, command surface, host install/update lifecycle
site/                         Astro + Starlight website
```

Generated host files are **not committed** — they are produced at install time from canonical templates plus host adapters.

## Making changes

- **CLI code** lives in `cli/src/`. Run `./dev check` before submitting.
- **Canonical templates** live in `.lineup-core/skills/`. Changes here affect all hosts on next install/update.
- **Keep the host contract aligned**. If you change `lineup run` semantics, update:
  - `.lineup-core/skills/**`
  - `docs/skills.md`
  - `docs/gate-protocol.md`
  - `README.md`
  - `site/src/content/docs/**` examples and migration docs
- **Host adapters** live in `.lineup-core/hosts/`. Each JSON file maps template variables to host-specific values.
- **Agent definitions** live in `agents/`. These are shared across all hosts.
- **Website** lives in `site/`. Run `./dev web` to preview locally.

### Runtime modes

`lineup run` supports two modes:

- `human` for local interactive terminal use
- `host` for raw protocol consumers, automation, and CI

Generated skills should use the bridge API instead of supervising raw host-mode
NDJSON. The bridge command surface is:

- `lineup bridge start <task> --executor-host <host>`
- `lineup bridge events <run-id> --after <seq> --wait <seconds>`
- `lineup bridge answer <run-id> <request-id> --choice <value> [--reason <text>]`

Native implementation also requires the current project to have at least one git
commit. `lineup init` scaffolds workflow/runtime files and initializes git when
needed; use `lineup doctor --json` to verify workflow and git readiness before
testing a fresh project.

When changing gate behavior, stdout/stderr behavior, or protocol messages, treat the
mode contract as part of the public API:

- `human`: prompts and human-readable progress belong on `stderr`
- `host`: NDJSON protocol belongs on `stdout`

For bridge mode, the compact event stream is the public API. Generated skills
should answer only `question` events and inspect results after `complete`.

The runtime includes best-effort repair for common raw-host mistakes, but treat that
as defensive compatibility rather than the primary contract. Keep prompts, bridge
events, and output shapes aligned with the docs and canonical skills.

## Commit conventions

- Use [conventional commits](https://www.conventionalcommits.org/): `type(scope): subject`
- Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`
- Single-line messages, imperative mood, no period at end

## Submitting a pull request

1. Create a branch from `main`
2. Make your changes
3. Run `./dev check` and make sure all checks pass
4. Update documentation if your changes affect user-facing behavior
5. Open a pull request with a clear description of what changed and why

## Reporting issues

Use [GitHub Issues](https://github.com/izantech/lineup/issues) for bug reports and feature requests.
