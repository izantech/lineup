# TUI Guide

Lineup has two frontends:

- `lineup` and `lineup tui` are the human entrypoints in interactive terminals
- `lineup <subcommand>` is the operator and automation surface for scripts, CI, and generated skills

The TUI is a renderer over the same CLI engine, run state, bridge data, and artifacts that power the command surface. It should not change the bridge contract or the raw `lineup run --mode host` path.

## Views

- Home: repo readiness, host readiness, latest run, recent runs, quick actions
- Composer: task prompt, workflow or tactic, host, isolation mode, implement method, approval defaults
- Live run: stage timeline, current status stream, task-wave summary, verification summary, artifact shortcuts, next actions
- Gate modal: approval, clarification, verify-decision, and custom gates with keyboard-first actions
- Inspect: run history, plan/tasks/review/artifact summaries, diff shortcuts, resume and cancel actions
- Command palette: searchable actions plus keybindings and slash-style commands

## Keyboard And Focus

- `/` opens the command palette and focuses search
- `Tab` and `Shift+Tab` move focus between the active regions and fields
- Arrow keys move through lists, gate choices, palette results, and run actions
- `Enter` activates the focused action or confirms the current field
- `Esc` closes a modal first, then backs out of the current screen state
- `q` quits the TUI cleanly
- `r` resumes the selected run
- `a` opens artifact and action shortcuts for the selected run
- `l` toggles logs and details for the selected run
- Numeric shortcuts remain supported for gates, but explicit focus should be the primary interaction model

## What The TUI Surfaces

The TUI is designed to make the common human flows obvious:

- check readiness before starting a run
- start or resume a run without switching context
- answer gates without reading raw protocol output
- inspect what changed during the run while the run is still visible
- jump from a blocked or failed run to the next concrete action
- reattach to the latest relevant persisted run when one already exists

The same run data powers the terminal views and the existing read-only commands like `lineup doctor`, `lineup status`, `lineup runs`, `lineup show`, `lineup logs`, and `lineup artifacts ...`.

## Fallbacks And Reattachment

- Non-interactive shells should bypass the TUI and stay on the operator surface
- `--no-tui` forces the text path in an interactive terminal
- Unsupported terminals should degrade to readable text instead of blocking the user
- When persisted run state exists, the TUI should attach to the latest relevant run first, then expose the inspection and recovery actions for that run

## What Does Not Change

- `lineup run --mode host` remains the raw NDJSON path for advanced integrations and CI
- generated skills still use `lineup bridge start|events|answer`
- bridge JSON remains machine-owned and stable
- artifact and resume behavior still come from the same persistent run state on disk
