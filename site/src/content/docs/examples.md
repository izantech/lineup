---
title: Examples
description: Real-world scenarios showing Lineup's multi-stage pipeline in practice.
---

Each scenario below demonstrates how Lineup decomposes a real task into stages, assigns models based on complexity, and produces actionable output.

---

## Feature development from a ticket

Input: a GitHub issue — "Add webhook retry logic with exponential backoff."

```bash
lineup run "Implement webhook retry logic with exponential backoff per #142"
```

Triage classifies this as moderate (multi-file, clear scope), assigns Sonnet to the architect and Haiku to developers. The pipeline researches the existing webhook dispatch code, plans the retry strategy with backoff parameters, and implements across the handler, config, and test files.

```bash
lineup show abc123                          # stage breakdown and timing
lineup artifacts show plan --run abc123     # inspect the retry design
```

If the implementation misses a test case, re-running skips triage and research:

```bash
lineup resume abc123 --retry-failed
```

---

## Bug triage and fix

Input: "Intermittent 500 errors on the checkout endpoint" with a stack trace.

```bash
lineup run "Fix intermittent 500 errors on POST /checkout — NullReferenceError at OrderService.validate (order.ts:87)"
```

Triage evaluates whether this is a straightforward null check or a distributed systems issue and selects models accordingly. The pipeline moves through diagnosis, root cause analysis, and a proposed fix with a regression test.

On re-run with additional context (deployment logs, metrics), completed stages are skipped:

```bash
lineup run "Fix the checkout 500 — also consider the race condition in inventory lock (see deploy logs from 04-12)" --from-stage 2
```

---

## Security audit

Input: "Audit token handling in src/auth.ts."

```bash
lineup run "Audit token handling in src/auth.ts"
```

The research stage maps the attack surface — token storage, logging exposure, timing vulnerabilities, memory lifecycle. The analysis stage produces a report with specific vulnerabilities, severity ratings, and code-level fixes.

A tactic narrows the pipeline to security-specific stages:

```bash
lineup tactic list                          # check available tactics
lineup run "Audit token handling in src/auth.ts" --tactic security-review
```

Scoped audits avoid the cost of full-codebase security reviews. Re-running with clarifications adapts the analysis without restarting from scratch.

---

## Performance optimization

Input: profiler output identifying a hot function.

```bash
lineup run "Optimize allocations in parseEventBatch() — profiler shows 40% of heap from this call path"
```

Lineup reads the function and its call chain, identifies the bottleneck (allocation patterns, algorithmic complexity, cache misses), and implements the most promising optimization with before/after benchmarks.

If the first optimization is insufficient, subsequent runs try alternative strategies from the implementation stage:

```bash
lineup resume abc123 --retry-failed --max-retries 5
```

---

## Test coverage expansion

Input: a function with 60% branch coverage.

```bash
lineup run "Expand test coverage for src/pipeline/scheduler.ts — currently at 60% branch coverage"
```

Lineup maps uncovered branches — edge cases, error paths, boundary conditions — and generates tests that target those paths specifically. It reads existing tests first to avoid duplication.

Inspect the execution waves to see how test tasks were parallelized:

```bash
lineup waves --run abc123
```

```
Execution Waves (4 tasks → 2 waves)

  Wave 1 (3 parallel)
    TEST-001  Edge case: empty batch input
    TEST-002  Error path: malformed schedule entry
    TEST-003  Boundary: max concurrent tasks

  Wave 2
    TEST-004  Integration: scheduler + executor round-trip

  Max parallelism: 3
```

---

## Codebase explanation

Input: "Explain src/pipeline/coordinator.ts for onboarding."

```bash
lineup run "Explain src/pipeline/coordinator.ts for onboarding a new team member" --tactic explain
```

Lineup reads the file and its dependency graph, then generates a structured explanation: purpose, system integration, key functions, assumptions, and a concrete execution trace. Output is markdown, tailored to the specified audience level.

```bash
lineup artifacts show plan --run abc123     # the structured explanation
```

---

## API feature implementation

Input: a design doc for a new `/health` endpoint, plus existing endpoint code as reference.

```bash
lineup run "Implement the /health endpoint per docs/design/health-check.md — follow conventions in src/routes/status.ts" --implement-method task
```

Lineup reads the design doc and existing conventions (response format, error handling, validation patterns), then implements the endpoint with tests. Using `--implement-method task` isolates each change — the route handler, schema, and tests are implemented in separate agent sessions with no cross-task context leaks.

```bash
lineup waves --run abc123 --compact         # verify task isolation
lineup show abc123 --json | jq '.stages[]'  # stage-level timing
```

---

## Targeted refactor

Input: "Extract validation logic from `processOrder()` into a separate validator class."

```bash
lineup run "Extract validation logic from processOrder() in src/orders/processor.ts into a ValidatorClass"
```

Lineup reads the method, identifies the validation boundaries (inputs, outputs, side effects), designs the extracted class, updates the call site, and writes tests verifying behavioral equivalence.

For refactors touching many files, limit parallel developer agents:

```bash
lineup run "Extract validation logic from processOrder()" --max-parallel 2
```

---

## Documentation generation

Input: new API code that lacks documentation.

```bash
lineup run "Generate documentation for the new endpoints in src/routes/v2/"
```

Lineup reads the new code and existing documentation to match style and depth. It generates docs covering parameters, usage, edge cases, and working examples.

Re-running with review feedback triggers only the writing stage, skipping research and planning:

```bash
lineup run "Regenerate docs for src/routes/v2/ — address review feedback on error examples" --from-stage 6
```

---

## Unattended pipeline runs

For CI or batch workflows, skip interactive gates and set a timeout:

```bash
lineup run "Run full test suite analysis" --approve-plan --gate-timeout 300 --json
```

The `--approve-plan` flag auto-approves the plan gate. `--gate-timeout 300` marks the run as `blocked` after 5 minutes instead of waiting indefinitely — resume it later with `lineup resume`.

Monitor progress programmatically:

```bash
lineup show abc123 --watch                  # poll every 2s until complete
lineup history --status failed --limit 5    # recent failures
```

---

## Failure recovery and retry

A pipeline run fails at the verify stage because a test assertion is wrong.

```bash
lineup history                              # identify the failed run
lineup logs abc123                          # read the failure output
lineup resume abc123 --retry-failed         # retry from the failed stage
```

The resume command re-executes only the failed stage and its dependents. Completed stages (research, plan, implementation of passing tasks) are preserved. After 3 failed attempts (configurable with `--max-retries`), the resume command rejects.

For large implementations, `--implement-method task` isolates each developer agent session to a single task. If one task fails, retrying re-runs only that task:

```bash
lineup run "Implement the billing module redesign" --implement-method task --json
lineup waves --run abc123                   # inspect which wave the failure occurred in
lineup resume abc123 --retry-failed --skip-task CHANGE-003
```

Replay a completed run as a chronological narrative for debugging:

```bash
lineup replay abc123
```

---

[How It Works](/how-it-works/) · [Getting Started](/getting-started/)
