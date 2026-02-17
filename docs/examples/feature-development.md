# Feature Development

This walkthrough shows a complete `/lineup:kick-off` run using the `full-feature` tactic. You'll see what happens at each stage, what the user decides, and what the final result looks like.

## The scenario

You're working on a Node.js API and need to add an endpoint for user preferences. Users should be able to read and update their notification settings, theme, and language. You have the `full-feature` tactic in your project:

```yaml
# .lineup/tactics/full-feature.yaml
name: full-feature
description: |
  End-to-end feature development with user control over each phase. Research
  is optional (skip if you already know the codebase), the plan requires
  explicit approval, and documentation is opt-in after verification.

stages:
  - type: research
    agent: researcher
    optional: true
  - type: plan
    agent: architect
    gate: approval
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
  - type: document
    agent: documenter
    optional: true
```

## Starting the pipeline

You type:

```bash
/lineup:kick-off full-feature Add a REST endpoint for user preferences (read and update notification settings, theme, language)
```

The orchestrator finds the `full-feature` tactic and begins executing its stages.

## Stage 1: Research (optional)

Because research is marked `optional: true`, the orchestrator asks first:

:::warning Stage 1/5 -- Research (optional)

Would you like to run the Research stage? (yes/no)

:::

You're new to this part of the codebase, so you type **yes**. The orchestrator spawns a researcher agent.

The researcher explores the project and reports back with structured findings:

:::info Stage 1/5 -- Research

Research complete. Key findings:

- Existing endpoints follow REST conventions in `src/routes/*.ts`
- User model defined in `src/models/user.ts` with a preferences JSONB column already present
- Validation uses Zod schemas in `src/schemas/`
- Authentication middleware in `src/middleware/auth.ts` extracts user ID from JWT
- Tests use Vitest with supertest for HTTP assertions
- No existing preferences endpoint -- this is a new addition
- Similar endpoint: `src/routes/profile.ts` (good model to follow)

:::

The findings flow automatically to the next stage as context.

## Stage 2: Plan (approval gate)

The orchestrator spawns an architect agent, which receives the research findings and your requirements.

:::tip Stage 2/5 -- Plan

Here is the proposed implementation plan:

1. Create Zod schema in `src/schemas/preferences.ts`
   - Define PreferencesSchema with fields: notifications (object with email, push, sms booleans), theme (enum: light, dark, system), language (ISO 639-1 string)
   - Define UpdatePreferencesSchema as a partial version for PATCH

2. Create route handler in `src/routes/preferences.ts`
   - GET `/api/users/:id/preferences` -- return current preferences
   - PATCH `/api/users/:id/preferences` -- update specific fields
   - Apply auth middleware, verify user owns the resource
   - Follow the same pattern as `src/routes/profile.ts`

3. Register routes in `src/routes/index.ts`
   - Import and mount preferences router

4. Add tests in `src/routes/__tests__/preferences.test.ts`
   - GET returns default preferences for new user
   - GET returns saved preferences
   - PATCH updates individual fields without overwriting others
   - PATCH rejects invalid theme value
   - PATCH rejects unauthenticated request
   - PATCH rejects request for another user's preferences

:::

:::warning Approval Gate

Do you approve this plan? (yes/no/suggest changes)

:::

The `gate: approval` on this stage means the orchestrator pauses here. You read the plan, notice it looks solid, and type **yes**.

## Stage 3: Implement

With the plan approved, the orchestrator spawns a developer agent. The developer follows the plan step by step:

:::details Stage 3/5 -- Implement

Implementing the approved plan...

- Created `src/schemas/preferences.ts`
  - PreferencesSchema with notifications, theme, language fields
  - UpdatePreferencesSchema (partial) for PATCH validation
- Created `src/routes/preferences.ts`
  - GET `/api/users/:id/preferences` handler
  - PATCH `/api/users/:id/preferences` handler
  - Auth middleware applied, ownership check included
- Updated `src/routes/index.ts`
  - Imported and mounted preferences router at `/api/users`
- Created `src/routes/__tests__/preferences.test.ts`
  - 6 test cases covering success, validation, auth, and ownership

Implementation complete. 3 files created, 1 file modified.

:::

## Stage 4: Verify

The orchestrator spawns a reviewer agent, which receives both the plan and the implementation report. The reviewer runs the test suite and checks the implementation against the plan's criteria:

:::tip Stage 4/5 -- Verify

Verification report:

- Build: **PASS**
- Tests: 14 run, 14 passed, 0 failed (6 new + 8 existing)
- Plan compliance: All 4 items implemented as specified
- Verification criteria:
  - Feature works as described: **PASS**
  - All new code has test coverage: **PASS**
  - No existing tests broken: **PASS**
  - Code follows existing project conventions: **PASS**
- Status: **PASS**

:::

Everything passes. The pipeline continues.

## Stage 5: Document (optional)

Documentation is marked `optional: true`, so the orchestrator asks:

:::warning Stage 5/5 -- Document (optional)

Would you like to generate documentation for these changes? (yes/no)

:::

You type **yes**. The documenter agent reviews the implementation and writes documentation:

:::details Documentation Report

Documentation complete.

- Updated `docs/api/preferences.md`
  - GET `/api/users/:id/preferences` endpoint reference
  - PATCH `/api/users/:id/preferences` endpoint reference
  - Request/response examples
  - Authentication requirements

:::

## Final result

The pipeline finishes. Here's what happened across all five stages:

| Stage | Agent | Duration | User action |
| ----- | ----- | -------- | ----------- |
| Research | researcher | ~30s | Opted in |
| Plan | architect | ~20s | Approved the plan |
| Implement | developer | ~45s | Waited |
| Verify | reviewer | ~15s | Reviewed results |
| Document | documenter | ~20s | Opted in |

**Files created:** 4 new files, 1 modified, plus 1 documentation file. All changes are in your working directory, uncommitted, ready for you to review with `git diff`.

## What you could have done differently

- **Skipped research** by typing "no" at Stage 1, if you already knew the codebase conventions. The architect would plan based on your description alone.
- **Rejected the plan** by typing "no" or suggesting changes like "use PUT instead of PATCH" at Stage 2. The architect would revise and present a new plan.
- **Skipped documentation** by typing "no" at Stage 5, if the endpoint is self-documenting or you prefer to write docs yourself.

The `full-feature` tactic gives you control at three points: before research, after planning, and before documentation. The `optional` and `gate: approval` fields make this possible without any extra configuration.
