# Plugin Manifest

This is the reference for Lineup's plugin manifest file. The manifest tells Claude Code how to load and namespace the plugin.

## File location

```text
.claude-plugin/plugin.json
```

The file must be in a `.claude-plugin/` directory at the plugin root. Claude Code discovers plugins by looking for this path.

## Current manifest

```json
{
  "name": "lineup",
  "description": "Structured multi-agent workflow: Clarify, Research, Plan, Implement, Verify, Document",
  "version": "1.3.0",
  "author": { "name": "izantech" },
  "repository": "https://github.com/izantech/lineup"
}
```

## Fields

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `name` | string | Yes | Plugin name. Becomes the namespace prefix for all skills and agents. |
| `description` | string | Yes | One-line summary of the plugin's purpose. |
| `version` | string | Yes | Semantic version string (`major.minor.patch`). |
| `author` | object | Yes | Author information. |
| `author.name` | string | Yes | Author name or organization. |
| `repository` | string | No | URL to the source repository. |

## How the namespace works

The `name` field determines the namespace prefix. Since Lineup's name is `"lineup"`, all skills are registered under the `lineup:` prefix:

| Skill file | Registered command |
| ---------- | ------------------ |
| `skills/kick-off/SKILL.md` | `/lineup:kick-off` |
| `skills/configure/SKILL.md` | `/lineup:configure` |
| `skills/explain/SKILL.md` | `/lineup:explain` |

Agents are similarly namespaced. The `agents/researcher.md` file becomes `lineup:researcher` when loaded.

You don't type the namespace in skill or agent files -- it's added automatically by the plugin system based on this manifest field.

## How versioning works

The `version` field follows [semantic versioning](https://semver.org/):

- **Major** (1.x.x): Breaking changes to skills, agents, or tactic schema
- **Minor** (x.2.x): New features (agents, skills, tactics) that don't break existing workflows
- **Patch** (x.x.1): Bug fixes, prompt improvements, documentation updates

When you update the plugin, the version number indicates what changed:

```bash
# Marketplace update
claude plugin update lineup@izantech
```

The version is informational -- Claude Code doesn't enforce version constraints between plugins. It's used by the marketplace for update discovery.

## Plugin structure

The manifest sits at the root of the plugin directory alongside all other components:

```text
.claude-plugin/
  plugin.json          <-- Manifest
agents/
  researcher.md        <-- Loaded as lineup:researcher
  architect.md
  developer.md
  reviewer.md
  documenter.md
  teacher.md
skills/
  kick-off/
    SKILL.md           <-- Loaded as /lineup:kick-off
  configure/
    SKILL.md           <-- Loaded as /lineup:configure
  explain/
    SKILL.md           <-- Loaded as /lineup:explain
tactics/
  explain.yaml         <-- Built-in tactic
templates/
  researcher.yaml      <-- Document template schemas
  architect.yaml
  developer.yaml
  reviewer.yaml
  documenter.yaml
  teacher.yaml
  tactic.yaml
examples/
  tactics/             <-- Example tactics for users to copy
```

Claude Code discovers agents by scanning the `agents/` directory for `.md` files, and skills by scanning `skills/*/SKILL.md`. Templates, tactics, and examples are referenced by the agents and skills but are not directly loaded by the plugin system.

## Modifying the manifest

The manifest rarely needs modification. The main reasons to edit it:

- **Forking the plugin:** Change `name` to avoid conflicts with the upstream version. This changes the namespace prefix for all commands.
- **Custom distributions:** Change `author` and `repository` for your organization.

::: warning
Changing the `name` field changes the namespace prefix. All commands change from `/lineup:*` to `/newname:*`. Existing tactics and documentation that reference `/lineup:` commands will need updating.
:::

## Further reading

For the full Claude Code plugin specification, see the [Claude Code plugin documentation](https://docs.anthropic.com/en/docs/claude-code).
