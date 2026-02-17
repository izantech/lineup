# API Feature

This walkthrough shows a complete API endpoint addition using the `api-feature` tactic. The tactic runs a focused pipeline with custom research and verification prompts tailored to API development: it researches existing API patterns, plans the endpoint specification with an approval gate, implements the feature, and verifies it against convention-specific criteria.

## The scenario

You're working on a Node.js API and need to add a health check endpoint. The endpoint should report the service status, database connectivity, and uptime so that load balancers and monitoring tools can check service health.

You have the `api-feature` tactic in your project:

```yaml
# .lineup/tactics/api-feature.yaml
name: api-feature
description: |
  Add a new API endpoint or service. Researches existing API conventions,
  plans the endpoint specification, implements it, and verifies with tests.

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus on existing API patterns: routing conventions, middleware stack,
      request/response schemas, authentication, error handling, and test
      structure. Identify the established patterns so the new endpoint
      follows them consistently.
  - type: plan
    agent: architect
    gate: approval
    prompt: |
      Design the new endpoint following the conventions found in research.
      Include: route path, HTTP method, request/response schemas, middleware
      chain, error responses, and test cases. Reference existing endpoints
      as models.
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
    prompt: |
      Verify the implementation matches the plan. Run the test suite and
      confirm the new endpoint follows the established API conventions.

verification:
  - "New endpoint follows existing routing conventions"
  - "Request and response schemas are validated"
  - "Error responses use the project's standard error format"
  - "Tests cover success, validation failure, and auth failure cases"
  - "No existing tests are broken"
```

## Starting the pipeline

You type:

```bash
/lineup:kick-off api-feature Add a GET /api/health endpoint that reports service status, database connectivity, and uptime
```

The orchestrator finds the `api-feature` tactic. This tactic has no variables, so the task description is passed as context and stages begin immediately.

## Stage 1/4: Research

The researcher agent receives a custom prompt focused on API patterns. Instead of a general codebase scan, it investigates routing conventions, middleware, schemas, and error handling.

:::info Stage 1/4 -- Research

Analyzing existing API patterns...

Research complete. Key findings:

- Routes defined in `src/routes/*.ts`, each exporting a Router
- All routes mounted in `src/routes/index.ts` with consistent `/api` prefix
- Request validation uses Zod schemas in `src/schemas/`
- Responses follow a standard envelope: `{ data, error, meta }`
- Error responses use `src/lib/errors.ts` with AppError class (status code, error code string, human-readable message)
- Auth middleware in `src/middleware/auth.ts` -- applied per-route, not globally
- Health-style endpoints: none exist yet, but `src/routes/status.ts` was deleted in a previous commit (git log shows it was removed as unused)
- Tests in `src/routes/__tests__/*.test.ts` using Vitest + supertest
- Database access through `src/lib/db.ts` with a `getPool()` export

:::

The custom research prompt kept the investigation focused on API conventions rather than exploring unrelated parts of the codebase.

## Stage 2/4: Plan

The architect agent receives the research findings and designs the endpoint. The custom plan prompt instructs it to include route path, HTTP method, schemas, middleware chain, error responses, and test cases.

:::tip Stage 2/4 -- Plan

Here is the proposed endpoint specification:

1. Create route handler in `src/routes/health.ts`
   - GET `/api/health` -- public endpoint, no auth middleware
   - Response schema: `{ data: { status, database, uptime } }`
     - status: `"healthy"` | `"degraded"` | `"unhealthy"`
     - database: `{ connected: boolean, latencyMs: number }`
     - uptime: number (seconds since process start)
   - If database ping fails: return status `"degraded"` with 200 (service is running but not fully operational)
   - If an unexpected error occurs: return standard AppError with 503 status

2. Create schema in `src/schemas/health.ts`
   - HealthResponseSchema using Zod for response type safety
   - Export TypeScript type for use in route handler

3. Register route in `src/routes/index.ts`
   - Mount health router at `/api/health`
   - No auth middleware (health checks must be unauthenticated)

4. Add tests in `src/routes/__tests__/health.test.ts`
   - GET `/api/health` returns 200 with healthy status
   - GET `/api/health` returns degraded when database is unreachable
   - Response matches HealthResponseSchema
   - Endpoint is accessible without authentication
   - Uptime value is a positive number

:::

:::warning Approval Gate

Do you approve this plan? (yes/no/suggest changes)

:::

The `gate: approval` on this stage pauses the pipeline. You review the specification, confirm the public endpoint is appropriate for health checks, and type **yes**.

## Stage 3/4: Implement

The developer agent implements the approved plan:

:::details Stage 3/4 -- Implement

Implementing the approved plan...

- Created `src/schemas/health.ts`
  - HealthResponseSchema with status, database, uptime fields
  - Exported HealthResponse type
- Created `src/routes/health.ts`
  - GET handler that pings database and reports status
  - Uses `getPool()` from `src/lib/db.ts` for connectivity check
  - Returns "degraded" status on database failure, not 503
  - Calculates uptime from `process.uptime()`
- Updated `src/routes/index.ts`
  - Imported and mounted health router at `/api/health`
  - No auth middleware applied (matches plan)
- Created `src/routes/__tests__/health.test.ts`
  - 5 test cases: healthy response, degraded on db failure, schema validation, no auth required, positive uptime

Implementation complete. 3 files created, 1 file modified.

:::

## Stage 4/4: Verify

The reviewer agent receives a custom verification prompt and checks the implementation against both the plan and the tactic's verification criteria.

:::tip Stage 4/4 -- Verify

Verification report:

- Build: **PASS**
- Tests: 22 run, 22 passed, 0 failed (5 new + 17 existing)
- Verification criteria:
  - New endpoint follows existing routing conventions: **PASS** (Router export pattern, `/api` prefix, mounted in `index.ts`)
  - Request and response schemas are validated: **PASS** (HealthResponseSchema validates response structure)
  - Error responses use the project's standard error format: **PASS** (503 case uses AppError class from `src/lib/errors.ts`)
  - Tests cover success, validation failure, and auth failure cases: **PASS** (healthy, degraded, schema check, no-auth access tested)
  - No existing tests are broken: **PASS**
- Status: **PASS**

:::

## Final result

| Stage | Agent | What happened |
| ----- | ----- | ------------- |
| Research | researcher | Mapped API conventions: routing, schemas, errors, middleware |
| Plan | architect | Specified endpoint with route, schema, error handling, tests |
| Implement | developer | 3 files created, 1 file modified |
| Verify | reviewer | All 22 tests pass, all verification criteria met |

The health check endpoint is in your working directory, ready for review. The api-feature tactic ran four stages with API-specific prompts at research, planning, and verification, keeping every stage focused on endpoint conventions.

## Key patterns in this walkthrough

**Custom research prompt.** The research stage has a targeted prompt that directs the researcher to focus on API patterns -- routing, middleware, schemas, error handling, and test structure. This avoids a generic codebase scan and produces findings the architect can act on immediately.

**Approval gate on planning.** The `gate: approval` on the plan stage pauses the pipeline so you can review the endpoint specification before any code is written. The architect's custom prompt ensures the plan includes route path, HTTP method, schemas, middleware chain, error responses, and test cases -- a complete specification you can evaluate.

**Convention consistency.** The tactic's verification criteria explicitly check that the new endpoint follows existing conventions (routing patterns, error format, schema validation). This catches drift before it reaches code review.

**Verification criteria as a checklist.** The `verification` block defines five specific checks. The reviewer uses these as a structured checklist rather than making subjective judgments about code quality. Each criterion maps to a concrete, observable property of the implementation.
