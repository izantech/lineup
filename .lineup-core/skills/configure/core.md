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
1. Check `ollama --version` via Bash
2. Check MCP server config; offer to run host's MCP add command if missing
3. Run `ollama list` to show available models
4. Write `{{OLLAMA_CONFIG_PATH}}` with `enabled: true`, selected model, `scope: research`

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
