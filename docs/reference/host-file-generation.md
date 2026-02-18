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
| Codex | `$HOME/.agents/skills/lineup-*` |

Each generated file includes:

```md
<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->
```

## Validation and drift prevention

Run from repository root:

```bash
npm --prefix cli run schema:check
npm --prefix cli run generate:check
```

- `schema:check` validates JSON/YAML inputs used for generation
- `generate:check` enforces deterministic generation and required output file sets

## Edit policy

- Edit: `.lineup-core/skills/**`, `.lineup-core/hosts/*.json`
- Do not hand-edit generated host artifacts in local install directories
