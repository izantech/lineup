# Targeted Refactor

This walkthrough shows a module refactor using the `targeted-refactor` tactic. The tactic uses two variables to scope the refactor precisely: `target_module` identifies which code to refactor, and `refactor_goal` defines what the refactor should achieve. Both variables are substituted into stage prompts so every agent works with the same scope and objective.

## The scenario

Your project's authentication module (`src/auth/`) has grown complex over time. It started as a single file but now has tangled dependencies between token generation, session management, and password hashing. You want to simplify its internal structure without changing the public API that the rest of the codebase depends on.

You have the `targeted-refactor` tactic in your project:

```yaml
# .lineup/tactics/targeted-refactor.yaml
name: targeted-refactor
description: |
  Refactor a specific module. Researches the module's current structure and
  dependencies, plans the refactor, implements it, and verifies no regressions.

variables:
  - name: target_module
    description: "Path to the module to refactor (e.g., src/auth/, lib/db.ts)"
    default: "src/"
  - name: refactor_goal
    description: "What should the refactor achieve?"
    default: "Improve readability and reduce complexity"

stages:
  - type: research
    agent: researcher
    prompt: |
      Analyze ${target_module} thoroughly: file structure, public API surface,
      internal dependencies, external consumers, and test coverage. Identify
      code smells, complexity hotspots, and coupling issues. Map which files
      import from this module so we understand the blast radius.
  - type: plan
    agent: architect
    prompt: |
      Plan the refactor of ${target_module} to ${refactor_goal}. Prioritize
      changes that reduce complexity without changing the public API. Define
      a safe execution order that keeps tests passing at each step.
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
    prompt: |
      Verify the refactor of ${target_module} did not break anything. Run the
      full test suite. Check that the public API surface is unchanged. Confirm
      the refactor goal was met: ${refactor_goal}.

verification:
  - "Public API of the module is unchanged"
  - "All existing tests pass"
  - "No new circular dependencies introduced"
  - "Code complexity is reduced (fewer lines, simpler control flow)"
```

## Starting the pipeline

You type:

```bash
/lineup:kick-off targeted-refactor
```

The orchestrator finds the tactic and sees it defines two variables. Before executing any stages, it prompts you for each one:

```text
This tactic requires input before starting.

target_module: Path to the module to refactor (e.g., src/auth/, lib/db.ts)
[default: src/]
>
```

You type:

```text
src/auth/
```

The orchestrator prompts for the second variable:

```text
refactor_goal: What should the refactor achieve?
[default: Improve readability and reduce complexity]
>
```

You type:

```text
Separate token, session, and password concerns into independent files with no cross-dependencies
```

The orchestrator substitutes both values into every stage prompt that references them and begins.

## Stage 1/4: Research

The researcher agent receives a prompt with `${target_module}` replaced by `src/auth/`. It analyzes the module's structure, public API, dependencies, and blast radius.

```text
Stage 1/4: Research

Analyzing src/auth/ thoroughly...

Research complete. Key findings:

- File structure:
  - src/auth/index.ts -- re-exports public API (login, logout, register,
    refreshToken, hashPassword, verifyPassword)
  - src/auth/auth.ts -- 340 lines, contains all logic in one file
  - src/auth/types.ts -- TypeScript interfaces for tokens and sessions
- Public API surface: 6 functions exported from index.ts
- Internal issues:
  - auth.ts has 3 concerns mixed: token generation (JWT), session
    management (Redis), and password hashing (bcrypt)
  - Token functions call session functions directly and vice versa,
    creating circular internal dependencies
  - hashPassword and verifyPassword are pure functions but import the
    Redis client because they share a file with session logic
  - Cyclomatic complexity of auth.ts: 24 (high)
- External consumers: 8 files import from src/auth/
  - src/routes/login.ts, src/routes/register.ts, src/routes/logout.ts
  - src/routes/refresh.ts, src/middleware/auth.ts
  - src/routes/__tests__/login.test.ts, register.test.ts, auth.test.ts
- Test coverage: 78% on auth.ts, but tests are fragile because mocking
  Redis for password tests (password functions don't use Redis)
- No circular dependencies at the module level, but internal coupling
  makes the file hard to modify safely
```

The researcher mapped the blast radius: 8 files import from `src/auth/`, all through the `index.ts` barrel export.

## Stage 2/4: Plan

The architect agent receives the research findings. Its prompt includes both substituted variables: plan the refactor of `src/auth/` to `Separate token, session, and password concerns into independent files with no cross-dependencies`.

```text
Stage 2/4: Plan

Here is the proposed refactor plan:

Execution order (tests pass after each step):

1. Extract password functions
   - Create src/auth/password.ts with hashPassword, verifyPassword
   - These are pure functions with only a bcrypt dependency
   - Remove them from auth.ts, add import in auth.ts temporarily
   - Update index.ts to re-export from password.ts
   - Run tests -- should pass (public API unchanged)

2. Extract token functions
   - Create src/auth/token.ts with generateToken, refreshToken, verifyToken
   - Dependencies: JWT library only
   - Remove from auth.ts, update internal references
   - Update index.ts to re-export from token.ts
   - Run tests -- should pass

3. Extract session functions
   - Create src/auth/session.ts with createSession, destroySession,
     getSession
   - Dependencies: Redis client
   - auth.ts now only contains login/logout/register orchestration
   - Update index.ts to re-export from session.ts
   - Run tests -- should pass

4. Simplify auth.ts to orchestration only
   - Rename to src/auth/auth.ts (keep name, reduce to ~60 lines)
   - login, logout, register compose token + session + password
   - No direct Redis or bcrypt imports -- only imports from sibling files
   - Run tests -- should pass

5. Remove unnecessary test mocks
   - Password tests no longer need Redis mocks
   - Token tests no longer need Redis mocks
   - Update test files to remove stale mock setup

Do you approve this plan? (yes/no/suggest changes)
```

The plan defines a safe execution order where tests pass after each step, and it preserves the public API by keeping `index.ts` as the barrel export. You type **yes**.

## Stage 3/4: Implement

The developer agent follows the plan step by step:

```text
Stage 3/4: Implement

Implementing the approved plan...

Step 1: Extract password functions
  Created src/auth/password.ts
    - hashPassword and verifyPassword moved from auth.ts
    - Only dependency: bcrypt
  Updated src/auth/index.ts
    - Re-exports hashPassword, verifyPassword from password.ts

Step 2: Extract token functions
  Created src/auth/token.ts
    - generateToken, refreshToken, verifyToken moved from auth.ts
    - Only dependency: jsonwebtoken
  Updated src/auth/index.ts
    - Re-exports token functions from token.ts

Step 3: Extract session functions
  Created src/auth/session.ts
    - createSession, destroySession, getSession moved from auth.ts
    - Only dependency: Redis client
  Updated src/auth/index.ts
    - Re-exports session functions from session.ts

Step 4: Simplify auth.ts
  Updated src/auth/auth.ts
    - Reduced from 340 lines to 58 lines
    - login, logout, register now compose from sibling imports
    - No direct bcrypt, JWT, or Redis imports

Step 5: Clean up tests
  Updated src/routes/__tests__/auth.test.ts
    - Removed unnecessary Redis mock from password test cases
  Updated src/routes/__tests__/login.test.ts
    - Removed stale Redis mock setup

Implementation complete. 3 files created, 4 files modified.
```

## Stage 4/4: Verify

The reviewer agent receives a prompt with both variables substituted. It checks that `src/auth/` was not broken and that the refactor goal was met.

```text
Stage 4/4: Verify

Verification report:
- Build: PASS
- Tests: 31 run, 31 passed, 0 failed
- Verification criteria:
  - Public API of the module is unchanged: PASS
    (index.ts exports the same 6 functions, all 8 consumer files
    unchanged)
  - All existing tests pass: PASS
    (31 tests, 0 failures, 0 skipped)
  - No new circular dependencies introduced: PASS
    (password.ts, token.ts, session.ts have no cross-imports;
    auth.ts imports from siblings only)
  - Code complexity is reduced: PASS
    (auth.ts: 340 lines -> 58 lines, cyclomatic complexity: 24 -> 4;
    largest new file is session.ts at 85 lines with complexity 6)
- Status: PASS
```

## Final result

| Stage | Agent | What happened |
| ----- | ----- | ------------- |
| Research | researcher | Mapped module structure, found 3 tangled concerns in one 340-line file |
| Plan | architect | 5-step execution order, tests pass after each step |
| Implement | developer | 3 files created, 4 files modified, auth.ts reduced to 58 lines |
| Verify | reviewer | All 31 tests pass, public API unchanged, no circular dependencies |

The refactored module is in your working directory, ready for review. The public API surface is identical -- all 8 consumer files work without changes.

## Key patterns in this walkthrough

**Two variables for precise scoping.** The `target_module` and `refactor_goal` variables let you specify exactly what to refactor and why. Without variables, you would need to describe the scope and objective in a long task description and hope each agent interprets it correctly.

**Variable substitution in prompts.** Both `${target_module}` and `${refactor_goal}` appear in the research, plan, and verify stage prompts. The researcher analyzes `src/auth/` specifically. The architect plans toward the stated goal. The reviewer checks that the goal was met. Every agent works from the same substituted values.

**Safe execution order.** The plan defines five steps where tests pass after each one. This means if any step breaks something, the failure is isolated to that step. The developer follows this order, and the reviewer can verify that the incremental approach was respected.

**Public API preservation.** The tactic's verification criteria explicitly check that the module's public API is unchanged. The `index.ts` barrel export acts as a contract: as long as it exports the same functions with the same signatures, consumer files are unaffected. The reviewer confirms all 8 importing files work without modification.
