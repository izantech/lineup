# Agentic Workflow

## Pipeline Overview

```
     [USER REQUEST]
            │
            ▼
┌───────────────────────────────────────────────────────┐
│ 1. CLARIFY                                            │
│    Orchestrator interviews the user to refine         │
│    requirements before spawning any agents.           │
│    Skipped if the request is already specific.        │
└───────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────┐
│ 2. RESEARCH                                           │
│    One or more `researcher` agents explore the │
│    codebase, read docs, and gather context.           │
│    Run in parallel when researching independent       │
│    areas. Run sequentially when findings depend       │
│    on each other.                                     │
└───────────────────────────────────────────────────────┘
            │
            ▼
   [CLARIFICATION GATE]
    Orchestrator reviews research findings, identifies
    ambiguities (edge cases, scope boundaries, integration
    decisions), and asks the user to resolve them.
    Skipped if research yielded clear, complete answers.
            │
            ▼
┌───────────────────────────────────────────────────────┐
│ 3. PLAN                                               │
│    A `architect` agent reviews all findings    │
│    and produces an implementation plan with specific  │
│    files, changes, and acceptance criteria.           │
└───────────────────────────────────────────────────────┘
            │
            ▼
       [USER APPROVAL]
            │
            ▼
┌───────────────────────────────────────────────────────┐
│ 4. IMPLEMENT                                          │
│    One or more `developer` agents execute the  │
│    approved plan. Parallelize only when tasks         │
│    touch independent files/modules.                   │
└───────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────┐
│ 5. VERIFY                                             │
│    A `reviewer` agent validates the            │
│    implementation: runs tests, reviews the diff       │
│    against the plan, and flags issues before          │
│    presenting to the user.                            │
└───────────────────────────────────────────────────────┘
            │
            ▼
     [USER REVIEWS RESULT]
```

## Agent Roles

All roles below are implemented as custom subagents in the `agents/` directory.

| Role | Subagent | Model | Tools | Memory |
|------|----------|-------|-------|--------|
| Orchestrator | main agent (you) | — | All | — |
| Researcher | `researcher` | Haiku | Read-only + Web | user |
| Architect | `architect` | Opus | Read-only + Write | user |
| Developer | `developer` | Opus | All | user |
| Reviewer | `reviewer` | Opus | Read-only + Bash | user |

**Orchestrator** is the main coding agent session — it coordinates the pipeline but delegates all heavy work to subagents.

## Orchestrator Rules

**DO:**
- Clarify ambiguous requests before delegating
- After research, ask the user to resolve ambiguities before delegating to the architect
- Read files for quick context (a few files, targeted lookups)
- Spawn specialized subagents for heavy exploration and implementation
- Present findings, plans, and results to the user
- Track progress and ensure completion

**DON'T:**
- Implement code changes directly (delegate to `developer`)
- Do deep codebase exploration (delegate to `researcher`)
- Skip the workflow for non-trivial tasks without explicit user instruction

## When to Use This Workflow

**Full pipeline** (Clarify → Research → Clarification Gate → Plan → Implement → Verify):
- Complex changes affecting multiple files or modules
- Unclear requirements that need investigation
- Task requires understanding unfamiliar parts of the codebase
- You want to review a plan before execution

**Lightweight** (skip Research, go straight to Plan → Implement → Verify):
- Moderate tasks where the scope is understood
- Changes within a single module with clear patterns

**Direct implementation** (no pipeline):
- Simple, well-defined tasks (single file, clear scope)
- Bug fixes with obvious root cause
- Small documentation updates
- User gives explicit, detailed instructions

## Parallelization Rules

**Run agents in parallel when:**
- Researching independent areas of the codebase
- Implementing changes in independent files/modules
- Tasks have no data dependencies between them

**Run agents sequentially when:**
- One agent's output feeds into the next (Research → Architect)
- Changes in one file affect another (shared interfaces, imports)
- Order matters for correctness (schema changes before code changes)

## Context Management

- Start a fresh session (`/clear`) when switching to an unrelated task
- For long-running tasks, prefer multiple focused subagent calls over one massive session
- If the orchestrator context grows large, summarize findings inline and delegate remaining work to subagents
- Keep plan documents as external files so they survive context compaction

## Delegation Quick Reference

| Task Type | Subagent | Notes |
|-----------|----------|-------|
| Explore codebase, find patterns | `researcher` | Parallel for independent areas |
| Read docs, gather requirements | `researcher` | Use Haiku for simple lookups |
| Clarify ambiguities from research | Orchestrator | Ask user before delegating to architect |
| Create implementation plan | `architect` | Feed researcher outputs as context |
| Implement code changes | `developer` | Parallel for independent modules |
| Run tests, review diff | `reviewer` | After implementation, before presenting |
| Trivial file ops (move, rename) | `developer` | Simple tasks, no full pipeline needed |