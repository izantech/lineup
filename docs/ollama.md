# Ollama

Lineup supports Ollama in two different ways:

1. **Model routing assistance**
2. **True host integration**
3. **Local validation**

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

Codex prefers the official local-OSS launch path when that is the active
implementation. Managed integration writes a Lineup-owned provider/profile into:

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

Launch planning uses the provider-qualified model identifier expected by
OpenCode when host integration is enabled.

User config file:

- `~/.config/opencode/lineup/ollama.yaml`

## Doctor

When `ollama.host_integration.enabled` is set, `lineup doctor --json` verifies:

- `ollama` binary availability
- configured model availability via `ollama list`
- host-specific integration target details

If host integration is disabled, Ollama does not block readiness.

## Validation Suite

The CLI includes a three-layer Ollama validation strategy:

1. Deterministic unit and integration tests for config precedence, launch planning, managed config writers, doctor readiness, and runner behavior
2. Deterministic pipeline tests that exercise full Lineup flows with fake host binaries and temporary homes
3. A local-only live smoke lane that runs real Claude, Codex, and OpenCode hosts against a local Ollama daemon

The deterministic suite explicitly covers:

- full human/local pipeline runs
- bridge mode via `lineup bridge start`, `lineup bridge events`, and `lineup bridge answer`
- bundled `explain` tactic runs outside the repo
- legacy `scope: full` compatibility
- host-integration precedence and readiness checks

For the local-only smoke lane, use:

```bash
npm --prefix cli run smoke:ollama-hosts -- --host claude|codex|opencode|all --model <model> [--base-url <url>] [--keep-temp]
```

This command:

- creates a temporary home directory and repository
- runs `lineup init`
- writes host-specific Ollama configuration
- runs `lineup doctor --json`
- runs one full pipeline task and one bundled `explain` tactic task per selected host
- drives bridge questions through the bridge contract
- asserts terminal success and captures artifacts/config output
- preserves the temp workspace on failure or stall so host-specific debugging
  data stays available after a bad run
- prints the preserved run roots, bridge logs, and host trace files for the
  primary lane and any Claude fallback lane

It is local-only by design and is not wired into CI.

Until all hosts are green, prefer per-host smoke runs instead of `--host all`:

- `npm --prefix cli run smoke:ollama-hosts -- --host claude --model <model>`
- `npm --prefix cli run smoke:ollama-hosts -- --host codex --model <model>`
- `npm --prefix cli run smoke:ollama-hosts -- --host opencode --model <model>`

## Trace Artifacts

The local smoke lane now records per-invocation trace data under each run root:

- `.lineup/.runs/<run-id>/host/*.trace.json`
- `.lineup/.runs/<run-id>/host/*.stdout.log`
- `.lineup/.runs/<run-id>/host/*.stderr.log`
- `.lineup/.runs/<run-id>/bridge/events.ndjson`
- `.lineup/.runs/<run-id>/bridge/stdout.log`
- `.lineup/.runs/<run-id>/bridge/stderr.log`

The smoke summary prints these paths when a host fails or stalls. Use them before
guessing about where the hang occurred.

## Current Live Findings

Current live validation status on `qwen3.5:9b` is not green yet. The hosts are
failing in different ways:

### Claude

- both `ollama launch claude` and the Anthropic-compatible env fallback reach
  the strict research invocation and then hang
- the trace file records only the `spawn` event
- there is no stdout, no stderr, no `close` event, and no research artifact

Implication:

- the strict `claude ... --json-schema ...` Ollama-backed path is hanging inside
  the host invocation itself, before Lineup receives any structured output

### OpenCode

- the process starts and writes one-time migration logs to stderr
- after migration it produces no stdout, no artifact, and no process exit
- the bridge remains parked in `research`

Implication:

- OpenCode is not failing on model lookup anymore
- the remaining problem is a non-interactive lifecycle/invocation issue after
  startup rather than a provider-selection bug

### Codex

- the process starts on `provider: ollama`
- the stderr log shows active reasoning/progress, so the host is not dead
- no research artifact is written, and the bridge sees no stage progress

Implication:

- Codex is now a contract/completion problem, not a provider-selection problem
- the smoke runner must distinguish "active host with no artifact yet" from a
  true silent stall

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
