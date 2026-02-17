# Bug Triage

This walkthrough shows a complete bug investigation and fix using the `bug-triage` tactic. The tactic uses variable prompting to accept a bug description, then runs a focused research-plan-implement-verify pipeline.

## The scenario

Users are reporting that login fails when their email address contains a `+` character (e.g., `user+tag@example.com`). The error message is "Invalid email format" even though the address is valid per RFC 5321.

You have the `bug-triage` tactic in your project:

```yaml
# .lineup/tactics/bug-triage.yaml
name: bug-triage
description: |
  Investigate and fix a reported bug. Researches the affected code path,
  plans a minimal fix, implements it, and verifies the fix with a regression test.

variables:
  - name: bug_description
    description: "Description of the bug or link to the issue"
    default: ""

stages:
  - type: research
    agent: researcher
    prompt: |
      Investigate the reported bug: ${bug_description}

      Find the affected code path, identify the root cause, check for related
      issues in the same area, and look for existing tests that should have
      caught this. Document the reproduction steps if possible.
  - type: plan
    agent: architect
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
```

## Starting the pipeline

You type:

```bash
/lineup:kick-off bug-triage
```

The orchestrator finds the tactic and sees it defines a `bug_description` variable. Before executing any stages, it prompts you:

:::warning Variable Input Required

This tactic requires input before starting.

`bug_description`: Description of the bug or link to the issue

:::

You type:

:::info User Input

Login fails with "Invalid email format" when the email contains a + character, e.g. user+tag@example.com. The address is valid per RFC 5321 but the login form rejects it.

:::

The orchestrator substitutes your input into the research prompt and begins.

## Stage 1: Research

The researcher agent receives the bug description embedded in its prompt and starts investigating the codebase.

:::info Stage 1/4 -- Research

Investigating: Login fails with "Invalid email format" when the email contains a + character...

Research complete. Key findings:

- Login form validation in `src/components/LoginForm.tsx` line 23
- Email regex: `/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/` -- this regex DOES allow + characters, so the client-side validation is not the issue
- Server-side validation in `src/api/auth/login.ts` line 41 uses a different check: `email.match(/^[a-zA-Z0-9._-]+@/)`
- The server regex is missing the + and % characters
- Root cause: server-side email regex is stricter than client-side, rejects valid addresses containing +
- Existing test in `src/api/auth/__tests__/login.test.ts` only tests simple@example.com -- no test for + addresses
- Related: the registration endpoint in `src/api/auth/register.ts` uses the same restrictive regex (line 38)

:::

The researcher identified the root cause (server-side regex mismatch) and found a related issue in the registration endpoint.

## Stage 2: Plan

The architect agent receives the research findings and plans a minimal fix.

:::tip Stage 2/4 -- Plan

Here is the proposed fix:

1. Extract email validation to a shared utility
   - Create `src/lib/validation/email.ts` with a single `isValidEmail` function
   - Use RFC 5321-compliant regex that allows +, %, and other valid characters
   - Export the regex for use in tests

2. Update server-side validation
   - `src/api/auth/login.ts`: replace inline regex with `isValidEmail` import
   - `src/api/auth/register.ts`: replace inline regex with `isValidEmail` import

3. Add regression tests
   - `src/lib/validation/__tests__/email.test.ts`: unit tests for the new utility covering standard addresses, + addresses, % addresses, and invalid formats
   - `src/api/auth/__tests__/login.test.ts`: add test case for user+tag@example.com
   - `src/api/auth/__tests__/register.test.ts`: add test case for user+tag@example.com

:::

:::warning Approval Gate

Do you approve this plan? (yes/no/suggest changes)

:::

The plan addresses the root cause (not just the symptom), fixes the related registration bug, and adds regression tests. You type **yes**.

## Stage 3: Implement

The developer agent implements the approved plan:

:::details Stage 3/4 -- Implement

Implementing the approved plan...

- Created `src/lib/validation/email.ts`
  - `isValidEmail` function with RFC 5321-compliant regex
  - Exported `EMAIL_REGEX` for test assertions
- Updated `src/api/auth/login.ts`
  - Replaced inline regex with `isValidEmail` import (line 41)
- Updated `src/api/auth/register.ts`
  - Replaced inline regex with `isValidEmail` import (line 38)
- Created `src/lib/validation/__tests__/email.test.ts`
  - 8 test cases: valid standard, valid +, valid %, valid subdomain, invalid missing @, invalid missing domain, invalid spaces, invalid empty
- Updated `src/api/auth/__tests__/login.test.ts`
  - Added test: "accepts email with + character"
- Updated `src/api/auth/__tests__/register.test.ts`
  - Added test: "accepts email with + character"

Implementation complete. 2 files created, 4 files modified.

:::

## Stage 4: Verify

The reviewer agent runs the test suite and checks the fix against the tactic's verification criteria:

:::tip Stage 4/4 -- Verify

Verification report:

- Build: **PASS**
- Tests: 47 run, 47 passed, 0 failed (10 new + 37 existing)
- Verification criteria:
  - Root cause addressed, not just symptom: **PASS** (shared utility replaces both inline regexes)
  - Regression test catches original bug: **PASS** (user+tag@example.com test added for login and registration)
  - No existing tests broken: **PASS**
  - Fix is minimal and scoped: **PASS** (only validation logic changed, no unrelated modifications)
- Status: **PASS**

:::

## Final result

| Stage | Agent | Duration | What happened |
| ----- | ----- | -------- | ------------- |
| Research | researcher | ~25s | Found root cause: server-side regex mismatch |
| Plan | architect | ~15s | Planned shared utility + regression tests |
| Implement | developer | ~40s | 2 files created, 4 files modified |
| Verify | reviewer | ~15s | All 47 tests pass |

The fix is in your working directory, ready for review. The bug-triage tactic ran four focused stages without clarification or documentation -- just investigation, planning, execution, and validation.

## Key patterns in this walkthrough

**Variable prompting** let you describe the bug before any stages ran. The `${bug_description}` substitution injected your description directly into the researcher's prompt, so the investigation was focused from the start.

**Root cause over symptom.** The researcher found that the client-side regex was fine and the server-side regex was the real problem. The plan addressed the root cause by extracting a shared utility rather than just patching the login regex.

**Related bug discovery.** The researcher found the same issue in the registration endpoint. The plan fixed both, preventing a second bug report.

**Minimal scope.** The tactic's verification criteria explicitly check that the fix is scoped to the affected code path. The developer didn't refactor unrelated code or add unnecessary changes.
