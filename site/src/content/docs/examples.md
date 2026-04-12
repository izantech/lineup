---
title: Examples
description: Real-world scenarios showing Lineup's multi-stage pipeline in practice.
---

Each scenario below demonstrates how Lineup decomposes a real task into stages, assigns models based on complexity, and produces actionable output.

---

## Feature development from a ticket

Input: a GitHub issue — "Add webhook retry logic with exponential backoff."

Lineup reads the issue, analyzes the current implementation, and breaks the work into stages: understand existing code, design retry strategy, implement, write tests, generate commit message. Triage assigns a fast model for context gathering and escalates to a more capable model for the design stage.

Stages run in parallel where dependencies allow. If tests fail mid-run, re-running resumes from the test stage with cached upstream results.

---

## Bug triage and fix

Input: "Intermittent 500 errors on the checkout endpoint" with a stack trace.

Triage evaluates whether this is a straightforward null check or a distributed systems issue and selects models accordingly. The pipeline moves through diagnosis, root cause analysis, and a proposed fix with a regression test.

On re-run with additional context (deployment logs, metrics), completed stages are skipped. Only the stages that need new information are re-executed.

---

## Security audit

Input: "Audit token handling in src/auth.ts."

The research stage maps the attack surface — token storage, logging exposure, timing vulnerabilities, memory lifecycle. The analysis stage produces a report with specific vulnerabilities, severity ratings, and code-level fixes.

Scoped audits avoid the cost of full-codebase security reviews. Re-running with clarifications ("that logging path is already redacted") adapts the analysis without restarting from scratch.

---

## Performance optimization

Input: profiler output identifying a hot function.

Lineup reads the function and its call chain, identifies the bottleneck (allocation patterns, algorithmic complexity, cache misses), and implements the most promising optimization with before/after benchmarks.

If the first optimization is insufficient, subsequent runs resume from the implementation stage to try alternative strategies.

---

## Test coverage expansion

Input: a function with 60% branch coverage.

Lineup maps uncovered branches — edge cases, error paths, boundary conditions — and generates tests that target those paths specifically. It reads existing tests first to avoid duplication.

Flaky or brittle tests trigger a re-run of the test-writing stage with that feedback. The goal is meaningful coverage, not percentage inflation.

---

## Codebase explanation

Input: "Explain src/pipeline/coordinator.ts for onboarding."

Lineup reads the file and its dependency graph, then generates a structured explanation: purpose, system integration, key functions, assumptions, and a concrete execution trace. Output is markdown, tailored to the specified audience level.

Follow-up questions can be run as separate Lineup tasks, each producing deeper explanations of specific subsystems.

---

## API feature implementation

Input: a design doc for a new `/health` endpoint, plus existing endpoint code as reference.

Lineup reads the design doc and existing conventions (response format, error handling, validation patterns), then implements the endpoint with tests. Test-writing runs in parallel with implementation where the dependency graph allows.

---

## Targeted refactor

Input: "Extract validation logic from `processOrder()` into a separate validator class."

Lineup reads the method, identifies the validation boundaries (inputs, outputs, side effects), designs the extracted class, updates the call site, and writes tests verifying behavioral equivalence.

Scope is intentionally narrow — one method, one extraction. Stages run tightly: extract, test, integrate.

---

## Documentation generation

Input: new API code that lacks documentation.

Lineup reads the new code and existing documentation to match style and depth. It generates docs covering parameters, usage, edge cases, and working examples. Output format adapts to the project's documentation system (Markdown, OpenAPI, etc.).

Re-running with review feedback triggers only the writing stage, not the full analysis.

---

[How It Works](/how-it-works/) · [Getting Started](/getting-started/)
