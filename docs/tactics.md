# Tactics

## Project Tactics

- Stored in `.lineup/tactics/`
- Schema reference: `templates/tactic.yaml`
- Discovered by kick-off
- Define `name`, `description`, `stages`, `verification`, optional `variables`

Built-ins live in `tactics/`. Project tactics override built-ins by matching `name`.

Tactic composition: a stage can reference another tactic via a `tactic` field (mutually
exclusive with `type`/`agent`). The orchestrator inlines the referenced tactic's stages
before execution. Cycle detection prevents infinite recursion; parent variables override
child defaults.

## Tactic Auto-Conversion

Existing tactics (simple `name/stages/verification` format) are automatically
converted to `Workflow` format when `lineup run --tactic <name>` is invoked:

- Linear stages → DAG with sequential dependencies
- `optional: true` → `optional` flag on workflow stage
- `gate: approval` → inserted approval stage
- `verification` → appended verify stage with reviewer agent
- `variables` → workflow variables

Use `lineup tactic convert <name>` to preview the conversion.
