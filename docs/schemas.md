# Schemas and Conventions

## YAML (human-authored)

- Canonical workflow templates: `.lineup-core/skills/**/*.md`
- Tactics: `.lineup/tactics/*.yaml` and built-ins in `tactics/*.yaml`
- YAML restrictions: no anchors, aliases, merge keys, or custom tags
- Validation flow: parse YAML -> validate with JSON Schema

## JSON (machine-owned)

- Host adapters: `.lineup-core/hosts/*.json`
- Installer state: `~/.lineup/state.json`
- Release manifest/checksum metadata

All are validated with JSON Schema in CI and runtime paths.

## Document Conventions

Agent outputs are YAML-structured and **ephemeral by default** (conversation context unless explicitly requested to persist).

Template references:

- `templates/researcher.yaml`
- `templates/architect.yaml`
- `templates/developer.yaml`
- `templates/reviewer.yaml`
- `templates/documenter.yaml`
- `templates/teacher.yaml`

Pipeline state (`pipeline-state.schema.json`) tracks:

- `started_at` / `finished_at` / `duration_ms` — run timing
- `retry_state` — per-stage retry attempts, max attempts, last error, and timestamps

Status values:

- research: `complete`
- plan: `draft`, `approved`, `superseded`
- implementation: `complete`
- review: `PASS`, `FAIL`, `PASS_WITH_WARNINGS`
- documentation: `complete`
- explanation: `complete`

## Release Process

1. Update versions (`cli/package.json`, `.claude-plugin/plugin.json` as needed)
2. Update `CHANGELOG.md`
3. Run checks: `./dev check`
4. Commit and push
5. Create GitHub release tag
6. Publish npm package via GitHub Actions OIDC (workflow checks tag/version alignment)
