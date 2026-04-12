# Ollama Integration

This guide covers how to enable Ollama for research tasks in the Lineup pipeline. When enabled, researcher agents can delegate text summarization and context gathering to a local Ollama model — at no API cost.

## What Ollama is used for

Ollama is used exclusively during Stage 2 (Research). Researcher agents can call it to:

- Summarize large files (>200 lines) before reporting findings
- Pre-digest documentation pages fetched via WebFetch
- Extract key facts from verbose configuration or log output
- Generate plain-language descriptions of complex data structures

Ollama is **never** used for code analysis, architectural decisions, or code generation. Those tasks remain with the Claude-backed researcher agent.

## Prerequisites

Before enabling the integration, you need:

1. **Ollama installed and running locally.** Download from [ollama.com](https://ollama.com) and verify it is running with `ollama list`.

2. **A model pulled.** Recommended options:
   - `llama3.1:8b` — good balance of speed and quality, requires ~8 GB VRAM
   - `mistral-small` — strong summarization quality, 128K context window, also ~8 GB VRAM

   Pull a model with:
   ```bash
   ollama pull llama3.1:8b
   ```

3. **The `rawveg/ollama-mcp` MCP server.** This is an npm package that exposes Ollama's API as MCP tools. The configure skill can install it for you — see Setup below.

## Setup

Run the Lineup configurator:

```bash
/lineup:configure
```

When prompted for which category to configure, choose **Ollama**. The configurator walks through three checks:

1. **Ollama binary** — runs `ollama --version` to confirm Ollama is installed. If not found, it provides installation instructions and stops.

2. **MCP server** — checks your MCP config for an `ollama` entry. If missing, it offers to run:
   ```bash
   claude mcp add ollama -- npx -y ollama-mcp
   ```
   Accept to install and register the server automatically.

3. **Model selection** — runs `ollama list` to show your pulled models and asks which to use. The default recommendation is `llama3.1:8b`.

When complete, the configurator writes the Ollama config file for your host:

- Claude: `~/.claude/lineup/ollama.yaml`
- Codex: `~/.codex/lineup/ollama.yaml`
- OpenCode: `~/.config/opencode/lineup/ollama.yaml`

```yaml
enabled: true
model: llama3.1:8b
scope: research
```

That file is the single switch. To disable Ollama at any time, run the configure skill again and choose **Disable Ollama**.

## How it works during the pipeline

During kick-off initialization (before Stage 1), the orchestrator reads the host's Ollama config file and verifies the MCP server is reachable by calling `mcp__ollama__ollama_list`. If the call succeeds, it sets `OLLAMA_AVAILABLE = true` internally.

At Stage 2 (Research), for every researcher spawned while `OLLAMA_AVAILABLE = true`:

- The tools `mcp__ollama__ollama_chat`, `mcp__ollama__ollama_generate`, `mcp__ollama__ollama_web_search`, and `mcp__ollama__ollama_web_fetch` are appended to the researcher's tool list.
- The researcher's spawn prompt includes instructions explaining which tasks to delegate to Ollama and which to handle directly.

No other stages are affected. The architect, developer, reviewer, and documenter agents do not receive Ollama tools.

## Supported models

Any model you have pulled with `ollama pull` can be used. Recommendations:

| Model | Context | VRAM | Notes |
| ----- | ------- | ---- | ----- |
| `llama3.1:8b` | 128K | ~8 GB | Default recommendation, fast |
| `mistral-small` | 128K | ~8 GB | Strong summarization quality |

Models with at least 8K context work for most summarization tasks. Prefer models with 32K+ context if your researchers frequently process long documentation pages.

## Limitations

- **Research tasks only.** Ollama tools are injected only for researcher agents. Code analysis, planning, implementation, and review stages are unaffected.
- **No accuracy guarantees.** Smaller local models are less reliable than Claude. Researchers are instructed to verify critical claims from any Ollama-generated summary against the source.
- **MCP server required.** The `rawveg/ollama-mcp` npm package must be registered as an MCP server. The integration is silently disabled if the server is unavailable at pipeline start.
- **Single model per pipeline run.** The model from `ollama.yaml` is used for the entire pipeline run. You cannot assign different models to different researcher agents.

## Troubleshooting

### "Ollama is enabled in config but the MCP server is not available"

The MCP server is not registered or not running. Re-run `/lineup:configure` and choose the Ollama category to re-register it, or run manually:

```bash
claude mcp add ollama -- npx -y ollama-mcp
```

Then restart Claude Code so the server is picked up.

### Ollama tool calls fail during research

The local Ollama daemon may not be running. Start it with:

```bash
ollama serve
```

Or restart the Ollama application if you are using the desktop app.

### Ollama not using the right model

Check your host's Ollama config file (`~/.claude/lineup/ollama.yaml` for Claude, `~/.config/opencode/lineup/ollama.yaml` for OpenCode) — the `model` field must exactly match the name shown in `ollama list`. Re-run the configure skill to update it.

### Disabling Ollama without the configurator

Delete or edit the host's Ollama config file directly. Setting `enabled: false` disables it; deleting the file has the same effect.
