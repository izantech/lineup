[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-7c3aed)](https://docs.anthropic.com/en/docs/claude-code)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# Lineup

A structured multi-agent workflow for Claude Code that breaks complex tasks into
a clear pipeline: **Clarify, Research, Plan, Implement, Verify, Document**.

Instead of letting a single agent do everything in one shot, Lineup delegates work
to specialized subagents -- each with its own tools, model, and persistent memory.

**[Read the full documentation →](https://lineup.izantech.app)**

## Quick Start

Register the izantech marketplace (one-time setup):

```bash
claude plugin marketplace add izantech/claude-plugins
```

Install lineup:

```bash
# From within Claude Code:
/plugin install lineup@izantech

# Or from terminal:
claude plugin install lineup@izantech
```

Run your first task:

```bash
/lineup:kick-off Refactor the authentication module to use JWT tokens
```

That's it. The pipeline will walk you through clarification, research, planning,
implementation, and verification.

See the [installation guide](https://lineup.izantech.app/getting-started/installation)
for manual install and customization options.

## What's Inside

| Component | Description |
| --------- | ----------- |
| 6 specialized agents | Researcher, Architect, Developer, Reviewer, Documenter, Teacher |
| 7-stage pipeline | Clarify -> Research -> Gate -> Plan -> Implement -> Verify -> Document? |
| 3 skills | `/lineup:kick-off`, `/lineup:configure`, `/lineup:explain` |
| Reusable tactics | Per-project custom workflows in YAML |

## Learn More

- [Getting Started](https://lineup.izantech.app/getting-started/installation) -- Installation and first task
- [Concepts](https://lineup.izantech.app/concepts/pipeline) -- How the pipeline, agents, and tactics work
- [How-To Guides](https://lineup.izantech.app/guides/run-kick-off) -- Step-by-step task guides
- [Reference](https://lineup.izantech.app/reference/agents) -- Complete configuration reference
- [Examples](https://lineup.izantech.app/examples/feature-development) -- Real walkthroughs with output

## Credits

The clarification gate, confidence-based review filtering, and multi-option
architecture patterns were adapted from the
[feature-dev](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/feature-dev)
skill for Claude Code.

## License

MIT
