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

If the user provided a tactic name as an argument (e.g., `{{CMD_KICKOFF}} my-tactic`),
pass it to the CLI: `lineup run "<user request>" --tactic <name> --mode host`.

If the user provided NO argument, check if project tactics exist:

```bash
lineup tactic list --json
```

If tactics are found, use **{{QUESTION_PRIMITIVE}}** to ask:

- Options: each tactic name + description, plus "Run the default pipeline"
- If the user selects a tactic: `lineup run "<user request>" --tactic <name> --mode host`
- If the user selects default: `lineup run "<user request>" --mode host`

If no tactics exist, proceed with the default pipeline.

---

## Health Check

Run `lineup doctor --json` to verify prerequisites. If any checks fail,
report the issue and suggest remediation before launching the pipeline.
