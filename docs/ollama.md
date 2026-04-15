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
- Ollama-backed Claude research now goes draft-first, then strict formatter
- headless `ollama launch claude` can return immediately with no output, so the
  runner now retries automatically through the Anthropic-compatible env path
- on `qwen3-coder:30b`, that env fallback can produce a valid `research.yaml`
  after a long local-model turn; the preserved `4ebd39` run under the
  `vm2S2E` smoke root is the current proof point
- the latest `0868fe` run under the `ZmPYGb` smoke root still timed out at the
  300000ms host invocation boundary, so the remaining blocker is not wrapper
  detection anymore but draft completion time/reliability on the env lane
- the next likely runtime focus is Anthropic-compat request shape rather than
  prompt wording alone; Ollama's compatibility layer still does not implement
  every Anthropic feature Claude Code can use against the cloud API

Implication:

- the remaining Claude blocker is the Ollama-backed draft invocation itself,
  not the strict schema pass
- the runtime now has the right fallback mechanics, so the next Claude work
  should focus on the env transport and timeout/completion profile, not on
  reverting the strict final validation contract again

### OpenCode

- OpenCode is now past the original model-selection and generic-startup issues
- one live run (`dcd421` under the `Kyxk5V` smoke root) wrote a near-valid
  research artifact that failed YAML parsing
- another live run (`96b99b` under the `E95Fek` smoke root) timed out after
  drifting back into broad workspace exploration during research
- the research prompt now explicitly says the stage is read-only and must emit
  exactly one YAML Research document
- the prompt now also explicitly says not to perform the requested code change
  during research and not to expand into repository-wide exploration
- OpenCode tool guidance now warns that `read` output is display-rendered and
  must not be pasted back into `edit.oldString`
- the pre-stage retry loop now clears stale artifacts before retrying, so a bad
  first write cannot immediately satisfy the second attempt with old output
- the next likely runtime focus is the exact headless launch contract, because
  OpenCode's Ollama integration is config-injected first and plain model-flag
  changes are unlikely to resolve the remaining non-terminating runs on their
  own

Implication:

- OpenCode is no longer blocked on provider selection
- the remaining issue is host behavior under the research prompt: keeping it on
  the bounded tiny-repo task and getting it to terminate with one valid YAML
  document instead of drifting or writing malformed YAML

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
- tighter researcher prompts and stricter pre-stage artifact validation did not
  eliminate the completion failure
- the older append-task ambiguity is gone because the smoke task now uses a
  placeholder-replacement contract in `README.md`
- the latest preserved live Codex failure moved forward again: run `1d2e5f`
  under the `aBFDYI` smoke root completed research, plan, and native implement,
  then failed on malformed `review.yaml`

Implication:

- Codex is no longer blocked on provider selection or source-repo leakage in
  the local native path
- the next Codex fix is to harden reviewer normalization or the Codex review
  prompt so malformed `review.yaml` from the bounded smoke task no longer ends
  the run

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
