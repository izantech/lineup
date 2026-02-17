# Test Coverage

This walkthrough shows how the `add-missing-test-coverage` tactic finds and fills gaps in test coverage. The tactic uses two variables for targeting a specific module and setting a coverage goal, with one approval gate on the research stage.

## The scenario

Your team has a coverage target of 80% for all modules, but the authentication module has dropped to 52% after a recent feature push. You need to bring it back up without writing tests that just inflate the numbers -- the new tests should cover meaningful behavior.

You have the `add-missing-test-coverage` tactic in your project:

```yaml
# .lineup/tactics/add-missing-test-coverage.yaml
name: add-missing-test-coverage
description: |
  Find and fill gaps in test coverage. Researches the current coverage map,
  identifies untested code paths, plans which tests to add for maximum impact,
  implements them, and verifies the coverage target is met.

variables:
  - name: target_module
    description: "Module or directory to improve coverage for (e.g., src/auth/, lib/utils/)"
    default: "src/"
  - name: coverage_target
    description: "Target coverage percentage (e.g., 80%, 90%)"
    default: "80%"

stages:
  - type: research
    agent: researcher
    gate: approval
    prompt: |
      Analyze test coverage for ${target_module}. Identify:
      1. Current coverage percentage (line, branch, function)
      2. Specific uncovered code paths and branches
      3. Which untested areas carry the most risk (business logic, error handling,
         edge cases, integrations)
      4. Existing test patterns and frameworks used by the project
      5. Any test infrastructure gaps (missing fixtures, helpers, mocks)
      Prioritize uncovered areas by risk and impact.
  - type: plan
    agent: architect
    prompt: |
      Plan the tests needed to reach ${coverage_target} coverage for
      ${target_module}. For each test:
      1. Describe what code path or behavior it covers
      2. Classify as unit, integration, or edge-case test
      3. Note any test infrastructure needed (mocks, fixtures, factories)
      Order by coverage impact: tests that cover the most uncovered lines first.
      Avoid testing trivial getters/setters -- focus on meaningful behavior.
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
    prompt: |
      Verify the new tests: run the full test suite to confirm all tests pass
      (old and new). Re-run coverage analysis for ${target_module} and confirm
      progress toward the coverage target.

verification:
  - "All new tests pass"
  - "All existing tests still pass"
  - "Coverage for the target module meets or approaches the coverage target"
  - "Tests cover meaningful behavior, not just trivial accessors"
  - "Test names clearly describe what they verify"
  - "No test relies on implementation details that would break during refactoring"
```

## Starting the pipeline

You type:

```bash
/lineup:kick-off add-missing-test-coverage
```

The orchestrator prompts for two variables:

:::warning Variable Input Required

`target_module`: Module or directory to improve coverage for (e.g., `src/auth/`, `lib/utils/`)
1. `src/` (default)
2. Enter custom value

:::

You type: **src/auth/**

:::warning Variable Input Required

`coverage_target`: Target coverage percentage (e.g., 80%, 90%)
1. 80% (default)
2. Enter custom value

:::

You accept the default **80%**. The orchestrator substitutes both values and begins.

## Stage 1: Research (approval gate)

The researcher analyzes test coverage for the authentication module.

:::info Stage 1/4 -- Research

Analyzing test coverage for `src/auth/`...

Research complete. Coverage analysis:

Current coverage for `src/auth/`:
- Lines:     52% (156/300)
- Branches:  38% (29/76)
- Functions: 61% (22/36)

Test framework: Vitest with @testing-library for component tests

Existing test files:
- `src/auth/__tests__/login.test.ts` (12 tests, covers login happy path)
- `src/auth/__tests__/register.test.ts` (8 tests, covers registration happy path)

Uncovered code paths (prioritized by risk):

HIGH RISK (business logic + error handling):
1. `src/auth/services/token.ts` -- refresh token rotation (0% covered)
   - Token refresh, expiration checks, rotation logic
   - Lines 45-98: `refresh()`, `isExpired()`, `rotate()`
2. `src/auth/middleware/auth.ts` -- error branches (30% covered)
   - Missing: expired token, malformed token, missing header, revoked token
   - Lines 28-52: catch blocks and edge cases
3. `src/auth/services/password.ts` -- rate limiting (0% covered)
   - Failed attempt tracking, account lockout logic
   - Lines 60-95: `checkRateLimit()`, `incrementFailedAttempts()`, `lockAccount()`

MEDIUM RISK (integration + edge cases):
4. `src/auth/services/oauth.ts` -- provider callback handling (40% covered)
   - Missing: token exchange failure, duplicate email, provider down
   - Lines 30-65: `handleCallback()` error paths
5. `src/auth/services/permissions.ts` -- role hierarchy edge cases (55% covered)
   - Missing: inherited permissions, role change propagation
   - Lines 20-45: `hasPermission()` with inherited roles

LOW RISK:
6. `src/auth/utils/validation.ts` -- input sanitization (70% covered)
   - Missing: unicode edge cases, SQL injection patterns
   - Lines 15-30: `sanitizeInput()` edge cases

Test infrastructure gaps:
- No token factory for creating test JWTs with specific claims
- No mock for the rate limiter (tests would need real timing)
- OAuth tests mock the HTTP client but not the token exchange

:::

:::warning Approval Gate

Do you approve these findings? (yes/no)

:::

The research identifies exactly where coverage is weakest and why it matters. You type **yes**.

## Stage 2: Plan

The architect plans tests ordered by coverage impact. Note that this stage has no approval gate -- the plan proceeds directly to implementation.

:::tip Stage 2/4 -- Plan

Planning tests for 80% coverage target...

Test Plan (28% coverage gap to close, ordered by coverage impact):

Infrastructure first:
- Create `src/auth/__tests__/helpers/token-factory.ts` -- Factory for generating test JWTs with configurable claims and expiration
- Create `src/auth/__tests__/helpers/rate-limit-mock.ts` -- Mock that replaces timing-dependent rate limiter with controllable state

Tests to add:

1. Token refresh and rotation (12 lines, +4% coverage) -- [unit]
   - `src/auth/__tests__/token.test.ts`
   - refreshes a valid token and returns new access + refresh pair
   - rejects an expired refresh token
   - rotates refresh token on use (old token becomes invalid)
   - rejects a previously-rotated (replayed) refresh token

2. Auth middleware error branches (10 lines, +3.3% coverage) -- [unit]
   - `src/auth/__tests__/auth-middleware.test.ts`
   - rejects request with missing Authorization header
   - rejects request with malformed token (not valid JWT)
   - rejects request with expired token
   - rejects request with revoked token
   - sets req.user on valid token

3. Password rate limiting (12 lines, +4% coverage) -- [unit]
   - `src/auth/__tests__/password-rate-limit.test.ts`
   - allows login after fewer than 5 failed attempts
   - locks account after 5 failed attempts
   - rejects login on locked account with correct password
   - resets failed count after successful login
   - unlocks account after 15 minute lockout period

4. OAuth callback error handling (8 lines, +2.7% coverage) -- [integration]
   - `src/auth/__tests__/oauth-callback.test.ts`
   - handles token exchange failure from provider
   - handles duplicate email (existing account with same email)
   - handles provider timeout gracefully

5. Permission hierarchy edge cases (6 lines, +2% coverage) -- [unit]
   - `src/auth/__tests__/permissions.test.ts`
   - admin inherits editor and viewer permissions
   - editor inherits viewer but not admin permissions
   - role change revokes previously-inherited permissions

6. Input sanitization edge cases (4 lines, +1.3% coverage) -- [unit]
   - `src/auth/__tests__/validation.test.ts`
   - sanitizes unicode control characters
   - strips SQL injection patterns from input
   - preserves valid unicode (accented names, CJK characters)

Total: 22 new tests across 6 test files + 2 helper files
Projected coverage: ~82% lines, ~68% branches, ~86% functions

:::

## Stage 3: Implement

The developer creates the test infrastructure and writes the tests.

:::details Stage 3/4 -- Implement

Implementing test plan...

Infrastructure:
- Created `src/auth/__tests__/helpers/token-factory.ts`
  - `createTestToken(claims, options)` -- generates JWTs with configurable expiration, roles, and custom claims
  - `createExpiredToken()` -- shortcut for expired JWT
  - `createRevokedToken()` -- creates token and adds ID to revocation list
- Created `src/auth/__tests__/helpers/rate-limit-mock.ts`
  - `MockRateLimiter` class with controllable state
  - `setFailedAttempts()`, `setLocked()`, `advanceTime()` methods

Tests:
- Created `src/auth/__tests__/token.test.ts` (4 tests)
- Created `src/auth/__tests__/auth-middleware.test.ts` (5 tests)
- Created `src/auth/__tests__/password-rate-limit.test.ts` (5 tests)
- Created `src/auth/__tests__/oauth-callback.test.ts` (3 tests)
- Created `src/auth/__tests__/permissions.test.ts` (3 tests)
- Updated `src/auth/__tests__/validation.test.ts` (3 tests added)

Implementation complete. 7 files created, 1 file updated. 23 new tests.

:::

## Stage 4: Verify

The reviewer runs all tests and re-checks coverage.

:::tip Stage 4/4 -- Verify

Verification report:
- Build: **PASS**
- Tests: 43 run, 43 passed, 0 failed (23 new + 20 existing)

Coverage for `src/auth/` (before -> after):
- Lines:     52% -> 83%  (+31%)
- Branches:  38% -> 69%  (+31%)
- Functions: 61% -> 89%  (+28%)

- Verification criteria:
  - All new tests pass: **PASS**
  - All existing tests still pass: **PASS**
  - Coverage meets target (80% lines): **PASS** (83%)
  - Tests cover meaningful behavior: **PASS** (token rotation, rate limiting, error handling -- no trivial tests)
  - Test names describe what they verify: **PASS** (e.g., "rejects request with expired token", "locks account after 5 failed attempts")
  - No tests rely on implementation details: **PASS** (tests use public APIs, token factory abstracts JWT internals)
- Status: **PASS**

Note: Branch coverage is at 69%, below the 80% line coverage target. Remaining uncovered branches are mostly in OAuth provider-specific error paths that would require integration test infrastructure not currently available.

:::

## Final result

| Stage | Agent | Duration | User action |
| ----- | ----- | -------- | ----------- |
| Research | researcher | ~25s | Reviewed coverage gaps, approved |
| Plan | architect | ~15s | Read the test plan |
| Implement | developer | ~50s | Waited |
| Verify | reviewer | ~20s | Reviewed coverage results |

**Files created:** 7 new files (6 test files, 1 test helper updated, 2 helpers created). Line coverage went from 52% to 83%, exceeding the 80% target.

## Key patterns in this walkthrough

**Risk-prioritized research.** The researcher doesn't just list uncovered lines -- it categorizes them by risk (high, medium, low). Untested token rotation and rate limiting are higher priority than untested input sanitization edge cases because the consequences of bugs there are more severe.

**Coverage-impact ordering.** The plan orders tests by how many uncovered lines they address, not by how easy they are to write. This ensures you reach the coverage target with the minimum number of well-chosen tests.

**Test infrastructure first.** The plan identifies missing test helpers (token factory, rate limiter mock) before listing the tests that need them. The developer creates infrastructure first, then writes tests that use it.

**Meaningful tests, not line inflation.** The tactic's verification criteria explicitly check that tests cover meaningful behavior. None of the tests are trivial getters or setters -- they test token rotation, account lockout, permission inheritance, and error handling.

**Single approval gate.** Unlike the security audit tactic, this tactic only gates the research stage. The plan flows directly to implementation because the research approval already validated which areas to focus on.

## When to use add-missing-test-coverage

This tactic fits best when:

- A module has fallen below your team's coverage threshold
- You're hardening a critical module before a release
- You want tests that cover real risk, not just lines of code
- You need test infrastructure (factories, mocks) built alongside the tests
- You want a repeatable process that identifies gaps before writing tests
