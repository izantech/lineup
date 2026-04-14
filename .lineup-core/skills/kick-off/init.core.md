# Kick-off Initialization

Lightweight pre-flight checks before launching `lineup run`.

---

## Agent Configuration Overrides

Check if `{{OVERRIDES_DIR}}` exists. If it does and contains `.yaml` files,
note to the user: "Agent overrides detected — the CLI will apply them automatically."

If an override file's `plugin_version` does not match the current version,
suggest running `{{CMD_CONFIGURE}}` to review customizations.

No further action needed — the CLI reads overrides at runtime.

---

## Tactic Detection

## Workflow Bootstrap

If the user did not provide `--workflow <path>`, ensure the default workflow exists.

Check for `.lineup-core/workflows/full-pipeline.yaml`. If it is missing, run:

```bash
lineup init --json
```

Tell the user that Lineup scaffolded the workflow/runtime directories and initialized
git if needed before launch.

If the user provided a tactic name as an argument (e.g., `{{CMD_KICKOFF}} my-tactic`),
pass it to the bridge: `lineup bridge start "<user request>" --executor-host {{EXECUTOR_HOST}} --tactic <name>`.

If the user provided NO argument, check whether any tactics exist, including
bundled built-ins:

```bash
lineup tactic list --include-builtins --json
```

If tactics are found, use **{{QUESTION_PRIMITIVE}}** to ask:

- Options: each tactic name + description, plus "Run the default pipeline"
- If the user selects a tactic: `lineup bridge start "<user request>" --executor-host {{EXECUTOR_HOST}} --tactic <name>`
- If the user selects default: `lineup bridge start "<user request>" --executor-host {{EXECUTOR_HOST}}`

If no tactics exist, proceed with the default pipeline.

---

## Health Check

Run `lineup doctor --json` to verify prerequisites. If any checks fail,
report the issue and suggest remediation before launching the pipeline.

## Git Preflight

If `lineup doctor --json` reports that the repository has no commits yet, do not launch
the pipeline blindly.

Explain why:

- Native Lineup implementation uses isolated git worktrees.
- A project needs a git repository and at least one commit before `implement` / `verify` can run.

Then ask the user whether to create the initial commit now.

- If the user agrees, run:

```bash
git add -A
git commit -m "Initial commit"
```

If the user declines, stop before `lineup run` and explain that the pipeline cannot
enter native implementation until the first commit exists.
