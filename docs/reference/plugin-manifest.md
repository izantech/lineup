# Plugin Manifest

This is the reference for Lineup's plugin manifest file. The manifest tells Claude Code how to load and namespace the plugin.

## File location

:::info File Location

`.claude-plugin/plugin.json`

:::

The file must be in a `.claude-plugin/` directory at the plugin root. Claude Code discovers plugins by looking for this path.

## Current manifest

```json
{
  "name": "lineup",
  "description": "Structured multi-agent workflow: Triage, Clarify, Research, Plan, Implement, Verify, Document",
  "version": "2.1.0",
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

The `name` field determines the namespace prefix. Since Lineup's name is `"lineup"`, all generated skills are registered under the `lineup:` prefix:

| Generated skill file | Registered command |
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

When you update the Claude host install through the Lineup manager, the version number indicates what changed:

```bash
# CLI-managed Claude host update
lineup update --host claude --version latest --yes
```

The version is informational -- Claude Code doesn't enforce version constraints between plugins.

## Plugin structure

The manifest sits at the root of the generated plugin directory alongside all runtime components:

<div class="file-tree">

- <span class="tree-folder">.claude-plugin/</span>
  - <span class="tree-file">plugin.json</span> <span class="tree-comment">Plugin manifest</span>
- <span class="tree-folder">agents/</span> <span class="tree-comment">Loaded as lineup:{name}</span>
  - <span class="tree-file">researcher.md</span>
  - <span class="tree-file">architect.md</span>
  - <span class="tree-file">developer.md</span>
  - <span class="tree-file">reviewer.md</span>
  - <span class="tree-file">documenter.md</span>
  - <span class="tree-file">teacher.md</span>
- <span class="tree-folder">skills/</span> <span class="tree-comment">Generated at install-time; loaded as /lineup:{name}</span>
  - <span class="tree-folder">kick-off/</span>
    - <span class="tree-file">SKILL.md</span>
  - <span class="tree-folder">configure/</span>
    - <span class="tree-file">SKILL.md</span>
  - <span class="tree-folder">explain/</span>
    - <span class="tree-file">SKILL.md</span>
- <span class="tree-folder">tactics/</span> <span class="tree-comment">Built-in tactics</span>
  - <span class="tree-file">explain.yaml</span>
- <span class="tree-folder">templates/</span> <span class="tree-comment">YAML schemas for agent output</span>
  - <span class="tree-file">researcher.yaml</span>
  - <span class="tree-file">architect.yaml</span>
  - <span class="tree-file">developer.yaml</span>
  - <span class="tree-file">reviewer.yaml</span>
  - <span class="tree-file">documenter.yaml</span>
  - <span class="tree-file">teacher.yaml</span>
  - <span class="tree-file">tactic.yaml</span>
- <span class="tree-folder">examples/</span>
  - <span class="tree-folder">tactics/</span> <span class="tree-comment">User-copyable examples</span>
    - <span class="tree-file">brownfield-docs.yaml</span>
    - <span class="tree-file">api-feature.yaml</span>
    - <span class="tree-file">targeted-refactor.yaml</span>
    - <span class="tree-file">bug-triage.yaml</span>
    - <span class="tree-comment">...</span>

</div>

Claude Code discovers agents by scanning `agents/` and skills by scanning `skills/*/SKILL.md` in the generated plugin directory. Templates, tactics, and examples are referenced by the agents and skills but are not directly loaded by the plugin system.

## Modifying the manifest

The manifest rarely needs modification. The main reasons to edit it:

- **Forking the plugin:** Change `name` to avoid conflicts with the upstream version. This changes the namespace prefix for all commands.
- **Custom distributions:** Change `author` and `repository` for your organization.

::: warning
Changing the `name` field changes the namespace prefix. All commands change from `/lineup:*` to `/newname:*`. Existing tactics and documentation that reference `/lineup:` commands will need updating.
:::

## Further reading

For the full Claude Code plugin specification, see the [Claude Code plugin documentation](https://docs.anthropic.com/en/docs/claude-code).
