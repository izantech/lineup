# Host File Generation

Lineup 2.0 keeps one canonical workflow source and generates host files at install time.

## Canonical source

- `.lineup-core/skills/**` (workflow templates)
- `.lineup-core/hosts/*.json` (host adapter maps)

## Generated outputs

Generated host files are artifacts, not tracked files.

| Host | Install-time output |
| ---- | ------------------- |
| Claude | Local plugin skills in CLI-managed plugin directory |
| Codex | `$HOME/.codex/skills/lineup-*` |
| OpenCode | `~/.config/opencode/skills/lineup-*/` (directory-per-skill with `SKILL.md`) |

Each generated file includes:

```md
<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->
```

## Validation and drift prevention

Run from repository root:

```bash
./dev check
```

- `schema:check` validates JSON/YAML inputs used for generation
- `generate:check` enforces deterministic generation and required output file sets

## Host adapter variables

Host adapter maps in `.lineup-core/hosts/*.json` define variables that the generation engine injects into skill templates at install time.

| Variable | Description |
| -------- | ----------- |
| `AGENTS_DIR` | Absolute path to the installed agent definition directory. Used by the kick-off skill in teams mode to locate and read agent `.md` files for prompt embedding. |

The `AGENTS_DIR` variable was added in 2.1.0 to support teams mode, where the orchestrator must read agent files at runtime rather than relying on the platform to apply them.

## Edit policy

- Edit: `.lineup-core/skills/**`, `.lineup-core/hosts/*.json`
- Do not hand-edit generated host artifacts in local install directories
