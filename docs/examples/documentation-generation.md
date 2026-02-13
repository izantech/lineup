# Documentation Generation

This walkthrough shows how the `brownfield-docs` tactic generates missing documentation for an existing codebase. The tactic skips clarification and code implementation, focusing entirely on identifying documentation gaps, planning what to write, and producing the docs.

## The scenario

You have a Node.js project with an authentication module that's grown over several months. The code works, but it has no documentation beyond a sparse top-level README. New team members struggle to understand how authentication flows through the system.

You have the `brownfield-docs` tactic in your project:

```yaml
# .lineup/tactics/brownfield-docs.yaml
name: brownfield-docs
description: |
  Generate missing documentation for an existing codebase. Skips clarification
  (docs are always needed) and implementation (no code changes). Focuses on finding
  documentation gaps, planning doc structure, and writing the docs.

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus on documentation gaps: missing READMEs, undocumented public APIs,
      stale architecture docs, missing setup guides. Catalog what exists and
      what is missing.
  - type: plan
    agent: architect
    prompt: |
      Create a documentation plan based on the research findings. Prioritize
      the most impactful gaps. Define what documents to create or update.
  - type: implement
    agent: documenter
```

Notice that the implement stage uses the **documenter** agent instead of the developer. This tactic writes documentation, not code.

## Starting the pipeline

You type:

```bash
/lineup:kick-off brownfield-docs Document the authentication module
```

The orchestrator finds the tactic and begins. There are no variables to prompt for and no optional stages, so execution starts immediately.

## Stage 1: Research

The researcher agent explores the codebase with a focus on documentation gaps.

```text
Stage 1/3: Research

Exploring documentation gaps in the authentication module...

Research complete. Key findings:

Existing documentation:
- README.md: mentions "JWT-based auth" in one sentence, no details
- No dedicated auth documentation

Authentication module structure:
- src/auth/middleware.ts -- JWT verification middleware, 3 exported functions
- src/auth/strategies/ -- local (password), OAuth (Google, GitHub), API key
- src/auth/tokens.ts -- token generation, refresh, and revocation
- src/auth/permissions.ts -- role-based access control with 4 roles
- src/auth/index.ts -- public API re-exports 12 functions

Documentation gaps:
- No overview of the authentication architecture or flow diagrams
- No API reference for the 12 exported functions
- No guide for adding a new OAuth provider (currently requires reading
  existing providers and inferring the pattern)
- No documentation of the role/permission model
- No setup guide for configuring OAuth credentials
- Environment variables AUTH_SECRET, OAUTH_GOOGLE_ID, OAUTH_GOOGLE_SECRET,
  OAUTH_GITHUB_ID, OAUTH_GITHUB_SECRET referenced but undocumented
```

## Stage 2: Plan

The architect agent receives the research findings and creates a documentation plan.

```text
Stage 2/3: Plan

Here is the proposed documentation plan, ordered by impact:

1. Create docs/auth/overview.md -- Authentication architecture
   - High-level flow: request -> middleware -> strategy -> token
   - Diagram of how the three strategies interact
   - When each strategy is used (web sessions vs API calls vs OAuth)

2. Create docs/auth/api-reference.md -- Public API reference
   - Document all 12 exported functions from src/auth/index.ts
   - Parameters, return types, and usage examples for each
   - Group by category: middleware, tokens, permissions

3. Create docs/auth/setup.md -- Setup and configuration guide
   - Required environment variables with descriptions and examples
   - OAuth provider configuration steps (Google, GitHub)
   - Local strategy password hashing configuration

4. Create docs/auth/permissions.md -- Role and permission model
   - The 4 roles and their hierarchy
   - How permissions are checked in route handlers
   - How to add a new role

5. Create docs/auth/adding-oauth-provider.md -- How to add a new provider
   - Step-by-step guide based on the existing Google/GitHub patterns
   - Required files, configuration, and callback setup

6. Update README.md -- Add auth section
   - Brief overview with links to the detailed docs above
   - Replace the one-sentence mention with a proper section

Do you approve this plan? (yes/no/suggest changes)
```

You type **yes**.

## Stage 3: Implement (documenter)

The documenter agent writes the planned documentation. Unlike the developer agent, the documenter focuses exclusively on creating and updating documentation files.

```text
Stage 3/3: Implement

Writing documentation based on the approved plan...

Created docs/auth/overview.md
  - Authentication architecture overview
  - Request flow explanation with all three strategies
  - Strategy selection logic

Created docs/auth/api-reference.md
  - 12 functions documented with signatures, parameters, return types
  - Usage examples for each function
  - Grouped into middleware (3), tokens (5), permissions (4)

Created docs/auth/setup.md
  - 5 environment variables documented with descriptions and examples
  - OAuth provider setup instructions for Google and GitHub
  - Password hashing configuration options

Created docs/auth/permissions.md
  - 4 roles documented: admin, editor, viewer, guest
  - Permission checking flow in route handlers
  - Guide for adding a new role

Created docs/auth/adding-oauth-provider.md
  - Step-by-step guide with 6 steps
  - Template files based on existing Google provider
  - Callback URL configuration

Updated README.md
  - Added Authentication section with overview and links

Documentation complete. 5 files created, 1 file updated.
```

## Final result

| Stage | Agent | Duration | What happened |
| ----- | ----- | -------- | ------------- |
| Research | researcher | ~30s | Cataloged existing docs and identified 6 gaps |
| Plan | architect | ~15s | Prioritized documentation by impact |
| Implement | documenter | ~60s | 5 files created, 1 file updated |

The documentation is in your project directory, ready to review. No code was modified -- only documentation files were created or updated.

## What makes this tactic different

**Three stages instead of seven.** The brownfield-docs tactic skips clarification (documentation is always useful), clarification gate (no ambiguity to resolve), verification (no code to test), and the optional documentation stage (the whole tactic *is* documentation).

**Documenter instead of developer.** The implement stage uses the documenter agent, which is tuned for writing human-readable documentation rather than code. It produces prose, API references, and guides rather than source files.

**No code changes.** The entire pipeline reads the codebase but only writes to documentation files. This makes it safe to run even on stable branches where code changes would be unwelcome.

## When to use brownfield-docs

This tactic fits best when:

- You're onboarding new team members and realize the docs are sparse
- You've just finished a major feature and need to document it before moving on
- A code review flagged missing documentation
- You're preparing a module for use by other teams

For ongoing documentation maintenance, consider running the tactic periodically as the codebase evolves. The researcher will pick up new gaps each time.
