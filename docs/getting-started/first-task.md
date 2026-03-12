# Your First Task

This walkthrough takes about 5 minutes. You'll run a complete `/lineup:kick-off` pipeline on a simple task and see what each stage looks like.

## The task

We'll use a realistic example:

```bash
/lineup:kick-off Add input validation to the login form
```

Type that into a Claude Code session with Lineup installed. Here's what happens next.

## Stage 1: Clarify

The orchestrator analyzes your request and asks targeted questions to fill in gaps. You'll see something like:

::: info Stage 1/7 -- Clarify

I have a few questions before we begin:

1. What validation rules do you need?
   a) Email format + password length (minimum 8 chars)
   b) Email format + strong password (uppercase, lowercase, number, special char)
   c) Custom rules (please specify)

2. Where should validation errors appear?
   a) Inline below each field
   b) Summary at the top of the form
   c) Both inline and summary

:::

Pick the options that match your needs, or type a custom response. The orchestrator collects your answers and produces a requirements summary.

::: tip
If your request is already specific enough, the orchestrator will acknowledge that and move on without questions. You don't always get asked things here.
:::

## Stage 2: Research

The orchestrator spawns one or more **researcher** agents. These are read-only -- they explore your codebase without changing anything.

::: info Stage 2/7 -- Research

Spawning researcher to explore the login form implementation...

:::

The researcher digs through your files, finds the login form component, identifies existing patterns, checks for validation libraries already in use, and reports back with structured findings. You'll see a YAML summary of what it found: key files, functions, patterns, and any gaps.

You don't need to do anything during this stage -- just wait for the findings.

## Stage 3: Clarification Gate

The orchestrator reviews the research findings and checks for remaining ambiguities. If the research turned up something unexpected, you might see:

::: warning Stage 3/7 -- Clarification Gate

The research found that your project uses both Zod (in `/api`) and Yup (in `/web`).
Which validation library should the login form use?

   a) Zod (consistent with the API layer)
   b) Yup (consistent with other web forms)
   c) Native HTML5 validation (no library)
   d) Other (please specify)

:::

Answer the question and the orchestrator locks in the final requirements.

If the research was clean with no open questions, this stage is skipped automatically.

## Stage 4: Plan

The orchestrator spawns an **architect** agent to create an implementation plan based on everything gathered so far.

::: tip Stage 4/7 -- Plan

Here's the proposed implementation plan:

1. Create validation schema in `src/lib/validation/login.ts`
   - Email format validation using Zod
   - Password minimum length (8 chars) with strength rules

2. Update `src/components/LoginForm.tsx`
   - Add validation on form submit
   - Add inline error display below each field
   - Add aria-invalid attributes for accessibility

3. Add tests in `src/components/__tests__/LoginForm.test.tsx`
   - Test valid submission
   - Test email format rejection
   - Test password strength rejection

:::

::: warning Approval Gate

Do you approve this plan? (yes/no/suggest changes)

:::

This is the key checkpoint. **Read the plan carefully.** You can:
- **Approve** to move forward
- **Reject** to revise
- **Suggest changes** to adjust specific parts

Nothing gets implemented until you say yes.

## Stage 5: Implement

Once you approve, the orchestrator spawns **developer** agents to write the code.

::: info Stage 5/7 -- Implement

Spawning developer to implement the approved plan...

:::

The developer follows the plan exactly -- creating files, modifying components, adding tests. You'll see the changes appear in your project as they're made.

For larger plans, multiple developers may run in parallel on independent parts of the work.

## Stage 6: Verify

After implementation, the orchestrator spawns a **reviewer** agent to check the work.

::: info Stage 6/7 -- Verify

Spawning reviewer to validate the implementation...

:::

The reviewer runs tests, reviews the diff against the plan, and checks for regressions. You'll see a verification report:

::: tip Verification Report

- Build: **PASS**
- Tests: 3 run, 3 passed, 0 failed
- Plan compliance: All items implemented
- Status: **PASS**

:::

If anything fails, the reviewer flags it and the orchestrator can loop back to fix issues.

## Stage 7: Document (Optional)

Finally, the orchestrator asks if you want documentation generated:

::: warning Stage 7/7 -- Document (optional)

Would you like to generate documentation for these changes?
   a) Yes, generate documentation
   b) No, skip documentation

:::

If you choose yes, a **documenter** agent writes or updates relevant docs in your project. If you skip, the pipeline is done.

## What happened behind the scenes

Here's the flow of information through the pipeline:

0. **Triage** (invisible) -- the orchestrator analyzed your request and classified its complexity, identified affected areas, and produced search targets for researchers
1. **Clarify** produced a requirements summary
2. **Research** used the triage search targets as focused directives and produced structured findings (key files, patterns, gaps)
3. **Clarification Gate** resolved remaining ambiguities
4. **Plan** consumed the requirements + findings + triage assessment and produced an implementation plan
5. **Implement** consumed the plan and wrote code
6. **Verify** consumed the plan + implementation and validated everything
7. **Document** (if chosen) consumed the plan + implementation + review to write docs

Each agent received context from the previous stages as YAML documents -- structured, parseable output that flows through the pipeline. These documents are ephemeral: they exist in the conversation only and don't pollute your project with tool-specific artifacts.

## Not every task needs the full pipeline

For this walkthrough, we ran all 7 stages (plus Stage 0 Triage, which runs invisibly). In practice, the orchestrator can compress the pipeline based on task complexity:

- **Simple fix** (typo, one-line change): skips straight to implementation (Direct tier)
- **Moderate task** (clear scope, single module): runs Triage, Plan, Implement, Verify (Lightweight tier)
- **Complex task** (unclear scope, multi-file): runs the full pipeline (Full tier)

Triage always runs for Full and Lightweight tiers -- it informs downstream stages even when clarification and research are skipped. See [Pipeline Tiers](/concepts/pipeline-tiers) for guidance on when each tier applies.

## Next steps

Head to [Next Steps](/getting-started/next-steps) for a guide to where to go from here based on what you want to do.
