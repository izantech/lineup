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
./dev docs                      # Start docs dev server
```

### Testing your changes locally

To test the full install flow with your local changes:

```bash
./dev install local
```

This builds the CLI from source, installs it globally, and installs skills for all hosts.

## Project structure

```text
.lineup-core/skills/**        Canonical workflow templates (source of truth)
.lineup-core/hosts/*.json     Host adapter maps (claude, codex, opencode)
agents/*.md                   Shared agent definitions
tactics/*.yaml                Built-in tactics
cli/                          CLI package (install/update/uninstall/status)
docs/                         VitePress documentation site
```

Generated host files are **not committed** — they are produced at install time from canonical templates plus host adapters.

## Making changes

- **CLI code** lives in `cli/src/`. Run `./dev check` before submitting.
- **Canonical templates** live in `.lineup-core/skills/`. Changes here affect all hosts on next install/update.
- **Host adapters** live in `.lineup-core/hosts/`. Each JSON file maps template variables to host-specific values.
- **Agent definitions** live in `agents/`. These are shared across all hosts.
- **Documentation** lives in `docs/`. Run `./dev docs` to preview locally.

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
