# Installation

Lineup is a Claude Code plugin. You need [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and working before adding Lineup.

## Prerequisites

- **Claude Code** installed and configured with a valid API key or valid subscription
- A terminal where you can run `claude` commands

## Choose your install method

| Method | Best for | Time |
| ------ | -------- | ---- |
| [Marketplace](#marketplace-install) | Most users -- quick, auto-updating | 1 minute |
| [Manual](#manual-install) | Contributing to Lineup, inspecting source | 2 minutes |
| [Customized](#customized-install) | Tweaking agent models, tools, or memory | 3 minutes |

## Marketplace install

Register the izantech marketplace (one-time setup):

```bash
claude plugin marketplace add izantech/claude-plugins
```

Then install Lineup:

```bash
# From within Claude Code:
/plugin install lineup@izantech

# Or from terminal:
claude plugin install lineup@izantech
```

To update later:

```bash
claude plugin update lineup@izantech
```

That's it. You now have the `lineup:` namespace with all skills and agents available.

## Manual install

Clone the repository and point Claude Code at it:

```bash
git clone https://github.com/izantech/lineup.git
claude --plugin-dir /path/to/lineup
```

This loads all agents and skills automatically. The `lineup:` namespace comes from the plugin name in `plugin.json`.

Use this method when you want to read or modify the source, or contribute changes back to the project.

## Customized install

**Note:** You can use `/lineup:configure` with **any** installation method (marketplace, manual, or customized) to adjust agent settings interactively.

For deeper customization (modifying agent instructions, adding custom agents, or changing plugin behavior), clone the repository and point Claude Code at your local copy:

```bash
git clone https://github.com/izantech/lineup.git
claude --plugin-dir /path/to/lineup
```

Now you can:
- **Edit files directly** (agent definitions in `agents/`, skill logic in `skills/`)
- **Use the configurator** for model/tool/memory changes:

```bash
/lineup:configure
```

See the [Customize Agents](/guides/customize-agents) guide for details on what you can change with the configurator vs. manual file edits.

## Verify installation

After installing, confirm everything is working:

```bash
/lineup:kick-off Hello, just checking the pipeline works!
```

You should see the orchestrator respond and begin the Clarify stage. You can cancel at any point -- the goal is just to confirm the skill loads.

## Troubleshooting

### Plugin not found

If `/lineup:kick-off` is not recognized:

- **Marketplace install**: Make sure the marketplace was added first with `claude plugin marketplace add izantech/claude-plugins`, then re-run `/plugin install lineup@izantech`.
- **Manual install**: Verify the `--plugin-dir` path points to the directory containing `.claude-plugin/plugin.json`. The path should be to the `lineup` root, not to a subdirectory.

### Skills load but agents fail

If the skill starts but agent delegation fails:

- Check that all files in `agents/` are present (researcher, architect, developer, reviewer, documenter, teacher).
- For customized installs, run `/lineup:configure` and choose **Reset** to restore default agent settings.

### "No such agent" errors

Agent names are auto-namespaced by the plugin. You should see agents like `lineup:researcher`, `lineup:architect`, etc. If you see bare names without the `lineup:` prefix, the plugin manifest may not be loading correctly -- confirm `.claude-plugin/plugin.json` exists and has `"name": "lineup"`.

## Next steps

Head to [Your First Task](/getting-started/first-task) to walk through a complete pipeline run.
