# Ollama

Lineup supports Ollama in two different ways:

1. **Model routing assistance**
2. **True host integration**
3. **Local validation**

These are separate on purpose. `ollama.scope` keeps its existing meaning, and `ollama.host_integration` enables host-native Ollama launch behavior.

You can now enter that path explicitly from the CLI:

```bash
lineup run "your task" --host ollama --runner codex
lineup run "your task" --host ollama --runner claude
lineup run "your task" --host ollama --runner opencode
```

That explicit `--host ollama` path forces the selected runner through the local
Ollama backend and does not rely on nested runner host-integration strategy.

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

- Claude -> Anthropic-compatible env transport by default; explicit `launch` keeps the wrapper lane
- Codex -> local OSS provider launch
- OpenCode -> wrapper launch

## Host behavior

### Claude

True host integration uses:

- Anthropic-compatible env transport by default when `strategy: auto`
- `ollama launch claude --model <model> --yes -- ...` when `strategy: launch`
- the same Anthropic-compatible env transport when smoke/debug retries explicitly force the env lane

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

True host integration now defaults to the official wrapper launch path:

- `ollama launch opencode --model <model> --yes -- run --pure --format json ...`

Managed integration still writes a Lineup-owned provider into:

- `~/.config/opencode/opencode.json`

Lineup uses the dedicated provider:

- `lineup-ollama`

Managed launch planning uses the provider-qualified model identifier expected
by OpenCode when the strategy is explicitly set to `managed`.

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
- copies the repo's canonical `.lineup-core/workflows/full-pipeline.yaml` into
  the temp repo so the smoke lane exercises the real workflow contract instead
  of the minimal scaffolded version
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

The smoke lane is now validated both per-host and through the combined matrix:

- `npm --prefix cli run smoke:ollama-hosts -- --host claude --model <model>`
- `npm --prefix cli run smoke:ollama-hosts -- --host codex --model <model>`
- `npm --prefix cli run smoke:ollama-hosts -- --host opencode --model <model>`
- `npm --prefix cli run smoke:ollama-hosts -- --host all --model <model>`

Per-host runs are still the fastest way to isolate a regression, but `--host all`
is now a supported validation pass for the current local model baseline.

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

When true host integration is enabled, Lineup can load compact host-specific
agent bodies such as:

- `cli/agents/researcher-ollama-compact.md`
- `cli/agents/architect-ollama-compact.md`
- `cli/agents/teacher-ollama-compact.md`
- `cli/agents/developer-ollama-compact.md`
- `cli/agents/reviewer-ollama-compact.md`

Lineup also switches the stage-level instructions onto a compact contract:

- shorter stage metadata
- compact JSON context instead of verbose pretty-printed context blocks
- a minimal required-fields summary instead of the older long template prose

This keeps local Ollama runs tighter without changing the final output schema
or validation rules.

The local smoke lane also uses a deterministic tiny-repo task:

- replace the placeholder line `REPLACE_ME_VALIDATE_OLLAMA_HOST_EXECUTION` in
  `README.md` with exactly `This repo validates Ollama host execution.`
- require the final `README.md` to contain that sentence exactly once and to no
  longer contain the placeholder
- inspect `README.md` first during research and stop once that is enough to
  produce the required structured artifact
- avoid host/service/config/runtime-log exploration during research
- keep research read-only even when the overall smoke task later requires an implementation change

## Current Live Findings

Current live Ollama validation is green on `qwen3-coder:30b`:

- per-host smoke passes for Claude, Codex, and OpenCode
- the combined `--host all` matrix also passes on the same built runtime
- each host passes both the bounded full-pipeline smoke task and the bundled
  `explain` tactic through the bridge contract

`qwen3.5:9b` remains a poor validation target for this setup because it does
not reliably satisfy the compatibility endpoints exercised by Claude and
OpenCode. Use `qwen3-coder:30b` as the current local acceptance baseline unless
another smaller model is re-proven.

The final validated Lineup-side behavior includes:

- research `constraints` and `gaps` normalize scalar and list outputs into
  schema-valid objects before validation
- plan normalization accepts Claude-style change keys such as `file_path`,
  `what_to_change`, and `why_this_change_is_needed`, and recovers absolute temp
  checkout paths back into repo-relative `changes[].file` values
- native implement and review local-runner invocations carry explicit output
  schemas again, using `ImplementationState` JSON for implement and `Review`
  YAML for verify/review
- isolated-worktree diff detection and patch capture compare against the
  baseline worktree `HEAD`, so edits are preserved even if a local host stages
  or commits inside the detached worktree
- the smoke lane copies the canonical full-pipeline workflow into the temp repo
  so plan prompts see the same triage and research inputs as a real run

Validated host contracts:

### Claude

- structured runs are draft-first, with local validation when the draft is
  already parseable
- `strategy: auto` prefers the Anthropic-compatible env transport, while
  explicit `strategy: launch` keeps the wrapper lane available for comparison
- native implement runs keep changes inside the isolated worktree, and the
  reviewer lane is stabilized by a tool-free Claude invocation plus a
  worktree-only review contract

### OpenCode

- auto/default execution uses the official wrapper launch path
- explicit `strategy: managed` still keeps the `lineup-ollama/<model>` selector
  available
- the wrapper path is stable for the bounded pipeline smoke task and bundled
  `explain`

### Codex

- default live execution uses `codex exec --oss --local-provider ollama`
- the runner watches both the final artifact path and Codex's direct `-o`
  output path
- research and review normalization cover the local-model artifact shapes that
  previously broke bounded smoke runs

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
