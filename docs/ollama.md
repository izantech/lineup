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
- OpenCode -> `launch`

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

When true host integration is enabled, Lineup can load compact host-specific
agent bodies such as:

- `cli/agents/researcher-ollama-compact.md`
- `cli/agents/architect-ollama-compact.md`
- `cli/agents/teacher-ollama-compact.md`

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

Current live validation status is split by model family:

- `qwen3.5:9b` is not a reliable host-validation target for Claude/OpenCode in
  this setup because it does not consistently answer the Anthropic-compatible
  or OpenAI-compatible compatibility endpoints that those hosts rely on.
- `qwen3-coder:30b` is the current viable local validation target and should be
  used for real host smoke until a smaller model proves stable on the same
  endpoints.

The current branch state also includes a few Lineup-side normalizations that
are now part of the local Ollama checkpoint:

- research `constraints` and `gaps` tolerate scalar and list outputs and are
  normalized into schema-valid objects before validation
- the native plan normalizer accepts Claude-style change keys such as
  `file_path`, `what_to_change`, and `why_this_change_is_needed`
- the native plan normalizer now also recovers Claude-style absolute temp
  checkout paths back into repo-relative `changes[].file` values
- native implement and review local-runner invocations now carry explicit
  output schemas again, using `ImplementationState` JSON for implement and the
  `Review` YAML schema for verify/review
- the smoke lane copies the canonical full-pipeline workflow into the temp repo
  so plan prompts receive the same triage and research inputs as a real run

The hosts are still failing in different ways on the current branch state:

### Claude

- the old strict-schema-first hang is no longer the current failure
- Ollama-backed Claude structured runs now go draft-first, and if the draft
  artifact is already parseable Lineup validates it locally instead of asking
  Claude for a second formatter pass
- Ollama-backed Claude invocations now run from the real working directory
  instead of a neutral temporary cwd, which removed the earlier false
  conclusions that `README.md` or other repo files were missing
- native implement/review stages now request JSON draft output with explicit
  schema validation, so Claude developer/reviewer lanes no longer fall back to
  unconstrained text during local native execution
- headless `ollama launch claude` can return immediately with no output, so the
  runner now retries automatically through the Anthropic-compatible env path
- the wrapper path still looks weaker than the env transport in full smoke
  runs, so the remaining failures are now about stage-by-stage live behavior
  rather than the original strict-schema contract
- the next active Claude work is stage-by-stage live stabilization of the full
  pipeline on `qwen3-coder:30b`, plus deciding whether `auto` should continue
  to prefer wrapper-first launch behavior

Implication:

- the remaining Claude blocker is no longer the old strict-schema launch shape
- the right next work is concrete live-pipeline debugging on
  `qwen3-coder:30b`, plus a transport-default decision based on the env-only
  smoke lane rather than another broad transport redesign

### OpenCode

- OpenCode auto/default host integration now uses the official wrapper launch
  path instead of the managed provider path
- the wrapper contract is known-good for minimal prompts when invoked as
  `ollama launch opencode --model <model> -- run ...`
- managed provider support remains available for explicit `strategy: managed`,
  using `lineup-ollama/<model>` as the qualified selector
- the remaining OpenCode work is full-pipeline stabilization on the wrapper
  launch path, not provider lookup or config injection

Implication:

- OpenCode is no longer blocked on provider selection or on the default host
  launch contract
- any remaining failures should now be debugged against the wrapper path's live
  pipeline behavior rather than the older managed-mode contract

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
