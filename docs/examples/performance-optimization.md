# Performance Optimization

This walkthrough shows a complete profiling and optimization cycle using the `performance-profiling-cycle` tactic. The tactic uses three variables -- the most of any example tactic -- to specify the target component, what metric to optimize, and what improvement to aim for. Two approval gates checkpoint the research and plan stages.

## The scenario

Your API's user search endpoint is taking over 800ms to respond under load, and the product team wants it under 200ms. You know the bottleneck is somewhere in the search handler, but you haven't profiled it yet.

You have the `performance-profiling-cycle` tactic in your project:

```yaml
# .lineup/tactics/performance-profiling-cycle.yaml
name: performance-profiling-cycle
description: |
  Profile a component, identify bottlenecks, and implement targeted optimizations.
  Researches current performance characteristics, plans optimizations with expected
  impact, implements the changes, and verifies measurable improvement.

variables:
  - name: target_component
    description: "Component or code path to profile (e.g., API handler, database queries, build pipeline)"
    default: ""
  - name: optimization_target
    description: "What metric to optimize (e.g., response time, memory usage, bundle size, build time)"
    default: "response time"
  - name: improvement_goal
    description: "Target improvement (e.g., 50% faster, under 200ms, below 500KB)"
    default: ""

stages:
  - type: research
    agent: researcher
    gate: approval
    prompt: |
      Profile ${target_component} to establish a performance baseline. Identify:
      1. Current metrics for ${optimization_target}
      2. Hot code paths and bottlenecks
      3. Resource usage patterns (CPU, memory, I/O, network)
      4. Existing performance tests or benchmarks
      5. Quick wins vs. structural changes needed
      Document specific numbers so improvement can be measured.
  - type: plan
    agent: architect
    gate: approval
    prompt: |
      Plan targeted optimizations for ${target_component} to improve
      ${optimization_target}. For each optimization:
      1. Describe the change and expected impact
      2. Estimate effort vs. payoff
      3. Note any trade-offs (readability, memory vs. speed, etc.)
      Order by impact-to-effort ratio. Include a benchmark strategy to verify
      each optimization delivers the expected improvement.
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
    prompt: |
      Verify the performance optimizations: re-run profiling to measure actual
      improvement against the baseline from research. Confirm the test suite
      passes and the optimizations do not degrade other quality attributes.

verification:
  - "Baseline metrics are documented before optimization"
  - "Measurable improvement toward the optimization target is demonstrated"
  - "The improvement goal is met or progress is clearly documented"
  - "All existing tests pass"
  - "No readability or maintainability regressions in optimized code"
  - "Benchmarks or profiling commands are documented for future use"
```

## Starting the pipeline

You type:

```bash
/lineup:kick-off performance-profiling-cycle
```

The orchestrator prompts for three variables:

:::warning Variable Input Required

`target_component`: Component or code path to profile (e.g., API handler, database queries, build pipeline)

:::

You type: **src/routes/users/search.ts and its downstream service calls**

:::warning Variable Input Required

`optimization_target`: What metric to optimize (e.g., response time, memory usage, bundle size, build time)
1. response time (default)
2. Enter custom value

:::

You accept the default **response time**.

:::warning Variable Input Required

`improvement_goal`: Target improvement (e.g., 50% faster, under 200ms, below 500KB)

:::

You type: **under 200ms at p95**

The orchestrator substitutes all three values and begins execution.

## Stage 1: Research (approval gate)

The researcher profiles the search endpoint and establishes a performance baseline.

:::info Stage 1/4 -- Research

Profiling `src/routes/users/search.ts` and downstream calls...

Research complete. Performance baseline:

Current metrics (response time, 100 concurrent requests):
- p50: 420ms
- p95: 830ms
- p99: 1,200ms

Hot code paths (time breakdown for a single request):
1. Database query (Prisma findMany with joins): 380ms average
   - Full table scan on users table (no index on search columns)
   - Eager-loading 3 relations: profile, roles, preferences
2. Response serialization: 180ms average
   - Serializing full user objects with all relations
   - No field filtering -- returns everything regardless of what's needed
3. Input validation + middleware: 15ms average
   - Not a bottleneck

Resource usage:
- Memory spikes to 450MB during search (loading full relation graphs)
- CPU usage normal
- No caching layer -- every search hits the database

Existing benchmarks: None found.

Quick wins:
- Add database index on `users.name` and `users.email` (search columns)
- Select only needed fields instead of full user objects
- Add response pagination (currently returns all matches)

Structural changes:
- Add a search-specific query with minimal joins
- Implement Redis caching for repeated searches

:::

:::warning Approval Gate

Do you approve these findings? (yes/no)

:::

The baseline numbers are concrete: p95 at 830ms against a goal of under 200ms. You type **yes**.

## Stage 2: Plan (approval gate)

The architect creates an optimization plan ordered by impact-to-effort ratio.

:::tip Stage 2/4 -- Plan

Planning optimizations for response time...

Optimization Plan (ordered by impact/effort):

1. Add database indexes -- [Est. impact: -200ms, Effort: low]
   - `CREATE INDEX idx_users_name ON users(name)`
   - `CREATE INDEX idx_users_email ON users(email)`
   - Trade-off: slightly slower writes (negligible for this table size)
   - Expected p95 after: ~630ms

2. Optimize query -- select only needed fields -- [Est. impact: -150ms, Effort: low]
   - Replace findMany with select-specific query
   - Only load profile relation (drop roles, preferences from search results)
   - Trade-off: search results won't include role/preference data (not needed for search result cards)
   - Expected p95 after: ~480ms

3. Add pagination (limit 20, cursor-based) -- [Est. impact: -200ms, Effort: medium]
   - Limit result set to 20 per page
   - Use cursor-based pagination for stable ordering
   - Trade-off: clients need to handle pagination
   - Expected p95 after: ~280ms

4. Add Redis cache for repeated queries -- [Est. impact: -150ms, Effort: medium]
   - Cache search results for 30 seconds
   - Invalidate on user create/update
   - Trade-off: stale results for up to 30 seconds after changes
   - Expected p95 after: ~130ms (cache hit), ~280ms (cache miss)

Benchmark strategy:
- Run k6 load test (100 concurrent users, 30s duration) before and after
- Measure p50, p95, p99 after each optimization to validate impact
- Save k6 script at `tests/performance/search-benchmark.js`

:::

:::warning Approval Gate

Do you approve this plan? (yes/no)

:::

The plan shows a clear path from 830ms to under 200ms through four incremental optimizations. You type **yes**.

## Stage 3: Implement

The developer implements the optimizations in the order specified.

:::details Stage 3/4 -- Implement

Implementing performance optimizations...

1. Database indexes:
   - Created `prisma/migrations/20240315_search_indexes/migration.sql`
   - Added `idx_users_name` and `idx_users_email` indexes

2. Optimized query:
   - Updated `src/services/user-search.ts`
   - Replaced `findMany({ include: { profile, roles, preferences } })` with `findMany({ select: { id, name, email, avatar, profile: { select: { bio } } } })`

3. Pagination:
   - Updated `src/routes/users/search.ts`
     - Added cursor and limit query parameters
     - Default limit: 20, max: 100
   - Updated `src/services/user-search.ts`
     - Added cursor-based pagination to query
   - Updated `src/schemas/user-search.ts`
     - Added pagination params to request schema
     - Added pagination metadata to response schema

4. Redis cache:
   - Updated `src/services/user-search.ts`
     - Added 30-second cache with search query as key
     - Cache invalidation on user create/update hooks
   - Updated `src/services/user.ts`
     - Added cache invalidation calls in `create()` and `update()`

5. Benchmark:
   - Created `tests/performance/search-benchmark.js`
     - k6 script with 100 virtual users, 30s duration
     - Measures p50, p95, p99 response times
     - Outputs comparison table

Implementation complete. 6 files modified, 2 files created.

:::

## Stage 4: Verify

The reviewer runs the benchmarks and the test suite.

:::tip Stage 4/4 -- Verify

Verification report:

Performance results (k6, 100 concurrent users, 30s):
- Before:  p50=420ms  p95=830ms  p99=1200ms
- After:   p50=45ms   p95=120ms  p99=190ms
- Change:  -89%       -86%       -84%

- Build: **PASS**
- Tests: 62 run, 62 passed, 0 failed (4 new pagination tests)
- Verification criteria:
  - Baseline metrics documented before optimization: **PASS**
  - Measurable improvement demonstrated: **PASS** (p95: 830ms -> 120ms)
  - Improvement goal met (under 200ms at p95): **PASS** (120ms)
  - All existing tests pass: **PASS**
  - No readability or maintainability regressions: **PASS**
  - Benchmarks documented for future use: **PASS** (`tests/performance/search-benchmark.js`)
- Status: **PASS**

:::

## Final result

| Stage | Agent | Duration | User action |
| ----- | ----- | -------- | ----------- |
| Research | researcher | ~30s | Reviewed baseline, approved |
| Plan | architect | ~20s | Reviewed optimization plan, approved |
| Implement | developer | ~50s | Waited |
| Verify | reviewer | ~25s | Reviewed benchmark results |

**Files modified:** 6 files modified, 2 files created (migration, benchmark script). The p95 response time dropped from 830ms to 120ms -- well under the 200ms goal.

## Key patterns in this walkthrough

**Three variables.** The `target_component`, `optimization_target`, and `improvement_goal` variables make this tactic reusable across different performance scenarios. The same tactic could target bundle size, memory usage, or build time just by changing the variable values.

**Measurable baseline.** The research stage establishes concrete numbers (p50, p95, p99) before any changes are made. Without a baseline, you can't prove improvement. The verification stage re-runs the same measurements to demonstrate the delta.

**Ordered by impact-to-effort.** The plan explicitly ranks optimizations by their expected payoff relative to implementation effort. This ensures you get the biggest wins first and can stop early if the goal is met partway through.

**Trade-off documentation.** Each optimization in the plan notes its trade-offs: slower writes, stale cache, clients handling pagination. These are decisions the user approves at the gate, not surprises discovered later.

**Benchmark artifact.** The k6 benchmark script is committed to the repository so the team can re-run it in the future. The verification criteria explicitly check that profiling commands are documented for reuse.

## When to use performance-profiling-cycle

This tactic fits best when:

- A specific component or endpoint is not meeting performance requirements
- You need documented evidence of improvement (before/after metrics)
- You want a structured approach instead of ad-hoc optimization attempts
- The team needs to review and approve the optimization plan before implementation
- You want benchmark scripts committed for regression detection
