# Codebase Explanation

This walkthrough shows how the `explain-codebase` tactic produces a structured onboarding guide for an unfamiliar codebase. It uses the simplest possible tactic structure -- two stages, no variables, no gates -- and is the only example tactic that uses the **teacher** agent.

## The scenario

You've just joined a team that maintains a large TypeScript monorepo. The project has been in active development for two years, but documentation is sparse and outdated. You want to understand the overall architecture, key modules, and team conventions before diving into your first task.

You have the `explain-codebase` tactic in your project:

```yaml
# .lineup/tactics/explain-codebase.yaml
name: explain-codebase
description: |
  Get a guided tour of an unfamiliar codebase. Researches the project structure,
  architecture, key modules, and conventions, then produces a structured explanation
  designed for onboarding.

stages:
  - type: research
    agent: researcher
    prompt: |
      Explore the entire codebase at a high level: project structure, entry points,
      key modules, data flow, configuration, and dependency graph. Identify the
      architectural patterns in use (MVC, hexagonal, microservices, etc.) and any
      conventions encoded in linting rules, CI config, or contributing guides.
  - type: explain
    agent: teacher
    prompt: |
      Produce a structured onboarding guide based on the research findings. Cover:
      1. Project purpose and high-level architecture
      2. Directory structure and what each top-level folder contains
      3. Key modules and how they interact
      4. Data flow from input to output (request lifecycle, event pipeline, etc.)
      5. Conventions and patterns the team follows
      6. Where to start reading code for a new contributor
```

This is the minimal tactic shape: two stages, no variables to prompt for, no optional stages or approval gates. Execution runs straight through.

## Starting the pipeline

You type:

```bash
/lineup:kick-off explain-codebase
```

The orchestrator finds the tactic and begins immediately -- no variable prompts, no optional stage questions.

## Stage 1: Research

The researcher agent explores the codebase at a high level, guided by the custom prompt.

:::info Stage 1/2 -- Research

Exploring project structure and architecture...

Research complete. Key findings:

Project structure:
- TypeScript monorepo using Turborepo with 3 packages:
  - `packages/api/` -- Express REST API (main backend)
  - `packages/web/` -- Next.js frontend
  - `packages/shared/` -- Shared types, utilities, and validation schemas

Architecture:
- Backend follows layered architecture: routes -> controllers -> services -> repositories
- Frontend uses App Router with server components
- Shared package provides Zod schemas used by both API validation and form validation

Entry points:
- API: `packages/api/src/server.ts` -> `packages/api/src/routes/index.ts`
- Web: `packages/web/src/app/layout.tsx` (root layout)

Key modules:
- Authentication: `packages/api/src/services/auth/` (JWT + OAuth)
- Database: `packages/api/src/repositories/` (Prisma ORM)
- Event system: `packages/api/src/events/` (async job queue via BullMQ)
- UI components: `packages/web/src/components/` (Radix + Tailwind)

Conventions:
- Barrel exports in every module `index.ts`
- Zod schemas colocated with their routes in `packages/api/src/schemas/`
- ESLint strict mode with no-explicit-any
- Tests colocated with source: `*.test.ts` next to `*.ts`
- CI: GitHub Actions with lint, typecheck, test, build stages

:::

The findings are passed automatically to the next stage.

## Stage 2: Explain (teacher)

The teacher agent receives the research findings and produces a structured onboarding guide. This is the **explain** stage type, paired with the **teacher** agent -- a combination unique to explanation workflows.

:::tip Stage 2/2 -- Explain

Producing onboarding guide...

### Onboarding Guide

#### Project Purpose and Architecture

This is a full-stack TypeScript application built as a monorepo with three packages. The architecture separates concerns across layers:

Request -> Route -> Controller -> Service -> Repository -> Database

The frontend uses Next.js server components that call the API directly. A shared package provides type-safe schemas used by both sides.

#### Directory Structure

- `packages/api/` -- Backend REST API (Express)
  - `src/routes/` -- HTTP route definitions
  - `src/controllers/` -- Request/response handling
  - `src/services/` -- Business logic
  - `src/repositories/` -- Database access (Prisma)
  - `src/events/` -- Async job processing (BullMQ)
  - `src/schemas/` -- Zod validation schemas
- `packages/web/` -- Frontend (Next.js App Router)
  - `src/app/` -- Pages and layouts
  - `src/components/` -- UI components (Radix + Tailwind)
  - `src/hooks/` -- Custom React hooks
  - `src/lib/` -- Client utilities
- `packages/shared/` -- Shared between API and web
  - `src/types/` -- TypeScript type definitions
  - `src/schemas/` -- Zod schemas used by both packages
  - `src/utils/` -- Shared utility functions

#### Key Modules and Interactions

Authentication flows through three layers:
- Route (`packages/api/src/routes/auth.ts`)
- Service (`packages/api/src/services/auth/`)
- Repository (`packages/api/src/repositories/user.ts`)

The event system decouples long-running work:
- Service creates event -> BullMQ queue -> Worker processes async

#### Data Flow

A typical API request:
1. Express route matches the path
2. Auth middleware validates JWT, attaches user to request
3. Zod schema validates the request body
4. Controller extracts validated data, calls service
5. Service contains business logic, calls repository
6. Repository executes Prisma query
7. Response flows back up the chain

#### Conventions

- Every module has an `index.ts` that re-exports its public API
- Validation schemas live next to the routes that use them
- Tests are colocated: `auth.test.ts` sits next to `auth.ts`
- No explicit any -- the ESLint config enforces strict typing
- Commits follow conventional commit format

#### Where to Start Reading

1. `packages/shared/src/schemas/` -- understand the data shapes first
2. `packages/api/src/routes/index.ts` -- see what endpoints exist
3. `packages/api/src/routes/auth.ts` -- trace a complete request lifecycle
4. `packages/web/src/app/layout.tsx` -- understand the frontend structure

:::

## Final result

| Stage | Agent | Duration | What happened |
| ----- | ----- | -------- | ------------- |
| Research | researcher | ~30s | Explored project structure, architecture, and conventions |
| Explain | teacher | ~25s | Produced structured onboarding guide |

The output is a structured explanation in the conversation -- no files are created or modified. The teacher agent's output is designed for reading and learning, not for committing to the repository.

## What makes this tactic different

**Two stages, no friction.** This is the simplest tactic structure possible. No variables to fill in, no optional stages to decide on, no approval gates to pause at. You run it and get an answer.

**Teacher agent.** This is the only example tactic that uses the teacher agent and the `explain` stage type. The teacher is optimized for producing clear, pedagogical explanations rather than code or plans.

**Read-only workflow.** Neither the researcher nor the teacher can modify files. The entire tactic runs safely against any codebase without risk of changes.

## How it compares to `/lineup:explain`

The built-in `explain` tactic (invoked via `/lineup:explain`) is designed for focused questions about specific components or patterns. The `explain-codebase` tactic serves a different purpose -- broad onboarding rather than targeted explanation.

| | `/lineup:explain` | `explain-codebase` |
| - | ------------------- | -------------------- |
| **Scope** | One component, pattern, or decision | Entire codebase overview |
| **Research prompt** | Focuses on what the user asked about | Explores the whole project structure |
| **Teacher prompt** | Explains the specific topic | Produces a full onboarding guide |
| **When to use** | You know what you want to understand | You're starting from zero |

## When to use explain-codebase

This tactic fits best when:

- You're joining a new project and need to orient yourself quickly
- You're reviewing an open-source project before deciding whether to adopt it
- A team member needs to ramp up on a part of the codebase they haven't worked in
- You want a snapshot of the current architecture to share with stakeholders
