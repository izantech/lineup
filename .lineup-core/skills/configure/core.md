---
name: {{SKILL_NAME_CONFIGURE}}
description: Customize Lineup agent settings (models, tools, memory, Ollama)
---

You interactively customize Lineup agent settings. Customizations are stored as
YAML override files in `{{OVERRIDES_DIR}}`, layered on top of {{HOST_DEFAULTS_TERM}}.

## Show current config

Run `lineup status --artifacts --json` to get current installation state. Then
read agent frontmatter from `agents/*.md` (researcher, architect, developer,
reviewer, documenter, teacher) and any override files in `{{OVERRIDES_DIR}}`.

Present a merged config table. Mark overridden fields with `*`.

## Customization options

Use **{{QUESTION_PRIMITIVE}}** to present categories:

| Category | Options |
|----------|---------|
| Model | Keep current / Set one for all / Set per-agent |
| Tools | Replace / Add / Remove / No changes |
| Memory | Keep current / Set one for all / Set per-agent |
| Ollama | Enable / Disable / No changes |
| Reset | Restore all to {{HOST_DEFAULTS_TERM}} |

### Model values: `haiku`, `sonnet`, `opus`
### Memory values: `user`, `project`, `local`
### Tools format: comma-space separated (e.g., `Read, Grep, Glob, LS`)

## Ollama setup

If the user chooses **Enable Ollama**:
1. Ask whether they want **Research assist**, **Legacy full routing**, or **True host integration**
2. Check `ollama --version` via Bash
3. If the user wants research-assist tool access through an Ollama MCP server, check host MCP config and offer to add it when missing; otherwise skip this step
4. Run `ollama list` to show available models
5. For **Research assist**, write `enabled: true`, the selected model, and `scope: research`
6. For **Legacy full routing**, write `enabled: true`, the selected model, and `scope: full`
7. For **True host integration**, write `enabled: true`, the selected model, keep `scope` at the user's desired appendix behavior, and also write `host_integration.enabled: true` with a strategy of `auto`, `launch`, or `managed`
8. Remind them to run `lineup doctor --json` so host-specific Ollama readiness can be verified before the bridge starts

## Apply changes

1. Preview changes (show old → new for each agent)
2. Get confirmation via **{{QUESTION_PRIMITIVE}}**
3. Read plugin version from `.claude-plugin/plugin.json`
4. Write override files to `{{OVERRIDES_DIR}}<agent>.yaml` (only changed fields + `plugin_version`)
5. Delete override files when all fields match defaults

## Rules

- Never modify agent `.md` files — overrides only
- Override files contain only changed fields + `plugin_version`
- Always preview and confirm before writing
- Reset deletes all override files in `{{OVERRIDES_DIR}}`
