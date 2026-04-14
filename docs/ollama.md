# Ollama

Lineup supports Ollama in two different ways:

1. **Model routing assistance**
2. **True host integration**

These are separate on purpose. `ollama.scope` keeps its existing meaning, and `ollama.host_integration` enables host-native Ollama launch behavior.

## Modes

### Research assist

Use:

```yaml
ollama:
  enabled: true
  model: qwen3-coder
  scope: research
```

Behavior:

- enables the Ollama appendix for supported agents
- does not change how Claude, Codex, or OpenCode are launched

### Legacy full routing

Use:

```yaml
ollama:
  enabled: true
  model: qwen3-coder
  scope: full
```

Behavior:

- preserves the existing behavior already shipped on the branch
- routes Lineup agent stages through the selected host using the configured Ollama-backed model target
- does not enable host-native `ollama launch` or managed host config by itself

### True host integration

Use:

```yaml
ollama:
  enabled: true
  model: qwen3-coder
  scope: research
  host_integration:
    enabled: true
    strategy: auto
```

Behavior:

- enables host-native Ollama execution behavior
- takes precedence over legacy `scope: full` model-target routing
- keeps `scope` intact for compatibility and prompt behavior

## Strategies

Supported values:

- `auto`
- `launch`
- `managed`

`auto` resolves per host:

- Claude -> `launch`
- Codex -> `managed`
- OpenCode -> `managed`

## Host behavior

### Claude

True host integration uses:

- `ollama launch claude --model <model> --yes -- ...` when available
- Anthropic-compatible env fallback when the wrapper is unavailable

Fallback env shape:

- `ANTHROPIC_AUTH_TOKEN=ollama`
- `ANTHROPIC_API_KEY=`
- `ANTHROPIC_BASE_URL=<ollama base URL without /v1>`

User config file:

- `~/.claude/lineup/ollama.yaml`

### Codex

Managed integration writes a Lineup-owned provider/profile into:

- `~/.codex/config.toml`

Lineup uses the dedicated profile:

- `lineup-ollama`

User config file:

- `~/.codex/lineup/ollama.yaml`

### OpenCode

Managed integration writes a Lineup-owned provider into:

- `~/.config/opencode/opencode.json`

Lineup uses the dedicated provider:

- `lineup-ollama`

User config file:

- `~/.config/opencode/lineup/ollama.yaml`

## Doctor

When `ollama.host_integration.enabled` is set, `lineup doctor --json` verifies:

- `ollama` binary availability
- configured model availability via `ollama list`
- host-specific integration target details

If host integration is disabled, Ollama does not block readiness.

## Recommended configs

Research assist only:

```yaml
ollama:
  enabled: true
  model: qwen3-coder
  scope: research
```

True host integration with defaults:

```yaml
ollama:
  enabled: true
  model: qwen3-coder
  scope: research
  host_integration:
    enabled: true
    strategy: auto
```

True host integration with explicit launch strategy:

```yaml
ollama:
  enabled: true
  model: qwen3-coder
  scope: research
  host_integration:
    enabled: true
    strategy: launch
```
