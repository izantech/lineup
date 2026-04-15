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
- Codex -> `launch`
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

Codex defaults to the local OSS launch path:

- `codex exec --oss --local-provider ollama ...`

Managed integration still writes a Lineup-owned provider/profile into:

- `~/.codex/config.toml`

The managed profile remains available as an explicit strategy:

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
- uses a deterministic tiny-repo pipeline prompt instead of a generic freeform smoke request
- runs the bundled `explain` tactic through `lineup bridge start|events|answer`
  instead of an interactive `lineup run --mode human` call
- drives bridge questions through the bridge contract
- answers `verify-decision` gates with `abort` when both `retry` and `abort`
  are available so the smoke lane fails fast on bad local-model output instead
  of compounding it with retries
- asserts terminal success and captures artifacts/config output
- treats bridge events plus host trace/log/artifact growth as progress
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

## Prompt Shaping

When true host integration is enabled, Lineup can load a compact host-specific
agent body such as `cli/agents/researcher-ollama-compact.md` instead of the
full bundled researcher prompt. This keeps local Ollama runs tighter without
changing the final output schema or validation rules.

The local smoke lane also uses a deterministic tiny-repo task:

- replace the placeholder line `REPLACE_ME_VALIDATE_OLLAMA_HOST_EXECUTION` in
  `README.md` with exactly `This repo validates Ollama host execution.`
- require the final `README.md` to contain that sentence exactly once and to no
  longer contain the placeholder
- inspect only `README.md`, `.lineup-core/workflows/full-pipeline.yaml`, and `.lineup/tactics/example.yaml` during research unless later stages truly require more
- avoid host/service/config/runtime-log exploration during research
- keep research read-only even when the overall smoke task later requires an implementation change

## Current Live Findings

Current live validation status is split by model family:

- `qwen3.5:9b` is not a reliable host-validation target for Claude/OpenCode in
  this setup because it does not consistently answer the Anthropic-compatible
  or OpenAI-compatible compatibility endpoints that those hosts rely on.
- `qwen3-coder:30b` is the current viable local validation target and should be
  used for real host smoke until a smaller model proves stable on the same
  endpoints.

The hosts are still failing in different ways on the current branch state:

### Claude

- the old strict-schema-first hang is no longer the current failure
- Ollama-backed Claude structured runs now go draft-first, and if the draft
  artifact is already parseable Lineup validates it locally instead of asking
  Claude for a second formatter pass
- headless `ollama launch claude` can return immediately with no output, so the
  runner now retries automatically through the Anthropic-compatible env path
- even after that change, the remaining live Claude failure is outside the
  Lineup contract: the wrapper still exits quickly with no artifact, and the
  env fallback still hangs on minimal direct prompts across both
  `qwen3-coder-next:q4_K_M` and `qwen3.5:9b`
- Ollama's Anthropic-compatible wiring is already aligned with the documented
  manual setup, so the remaining blocker now looks like Claude Code runtime
  compatibility with the available local models in this environment

Implication:

- the remaining Claude blocker is not Lineup prompt shape or schema handling
- until a Claude-compatible local model path is proven here, the remaining work
  is upstream host/runtime validation rather than another Lineup-side contract
  change

### OpenCode

- OpenCode is now past the original model-selection and generic-startup issues
- Lineup now launches OpenCode with the canonical `ollama/<model>` selector and
  injects the wrapper-style `OPENCODE_CONFIG_CONTENT` payload inline
- even with that corrected runtime contract, OpenCode still hangs after
  migration and provider resolution on both the tiny smoke task and a direct
  minimal “reply with OK” prompt
- that same post-stream-start hang reproduces across `qwen3-coder:30b`,
  `qwen3-coder-next:q4_K_M`, and `qwen3.5:9b`

Implication:

- OpenCode is no longer blocked on provider selection or config injection
- the remaining issue is upstream host/runtime compatibility in this local
  Ollama setup, not the bounded smoke prompt or the Lineup launch contract

### Codex

- the process starts on `provider: ollama`
- the stderr log shows active reasoning/progress, so the host is not dead
- the runner already watches both the expected artifact path and Codex's direct
  `-o` output path
- research normalization now repairs one common local-model artifact shape:
  `what_found` may arrive as an array of `{ path, content }` entries and is
  rewritten into the structured `key_files` object that the Research schema
  expects
- research normalization also repairs one common colon-heavy scalar shape in
  `how_it_works`, where local models emit a single unquoted line containing
  additional `: ` sequences that would otherwise be invalid YAML
- reviewer normalization now accepts both `**Status: PASS**` and
  `**Status**: PASS` markdown styles instead of treating the second form as a
  fatal YAML parse failure
- native implement/review local-runner invocations now stay fully inside the
  isolated worktree, so Codex no longer receives the source repo root through
  the local human-native path during implement/verify
- the older append-task ambiguity is gone because the smoke task now uses a
  placeholder-replacement contract in `README.md`
- reviewer normalization now also repairs the common colon-heavy scalar
  `test_results:` line that local models can emit
- live smoke run `be7176` under the `zFHtPJ` smoke root now completes the full
  pipeline successfully on `qwen3-coder:30b`

Implication:

- Codex is no longer blocked on provider selection, source-repo leakage, or
  malformed bounded-pipeline review output
- the remaining Codex work is explain-tactic validation and general smoke
  throughput, not a known main-pipeline contract failure

## Recommended configs

Research assist only:

```yaml
ollama:
  enabled: true
  model: qwen3-coder:30b
  scope: research
```

True host integration with defaults:

```yaml
ollama:
  enabled: true
  model: qwen3-coder:30b
  scope: research
  host_integration:
    enabled: true
    strategy: auto
```

True host integration with explicit launch strategy:

```yaml
ollama:
  enabled: true
  model: qwen3-coder:30b
  scope: research
  host_integration:
    enabled: true
    strategy: launch
```
