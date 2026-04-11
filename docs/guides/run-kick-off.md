# Run Kick-off

This guide walks through every way to use `/lineup:kick-off` and what to expect at each stage of the pipeline.

## Basic usage

The most common pattern: type the command followed by a description of what you want done.

```bash
/lineup:kick-off Refactor the authentication module to use JWT tokens
```

The orchestrator reads your description, decides which [pipeline tier](/concepts/pipeline-tiers) to use, and starts the appropriate stages.

## With a tactic name

If your project has [tactics](/concepts/tactics) defined, you can run a specific one by name:

```bash
/lineup:kick-off brownfield-docs
```

The orchestrator looks for `brownfield-docs.yaml` in your project's `.lineup/tactics/` directory and the plugin's built-in `tactics/` directory. If found, it runs the tactic's stage sequence instead of the default pipeline.

## Menu mode (no arguments)

Run the command with no arguments to see what's available:

```bash
/lineup:kick-off
```

If your project has tactics defined, the orchestrator presents a selection menu:

:::info Tactic Selection Menu

This project has tactics defined. Which workflow would you like to run?

  1. brownfield-docs -- Generate missing documentation for an existing codebase
  2. api-feature -- Full pipeline with API-focused research and testing
  3. Run the default pipeline (Triage -> Clarify -> Research -> ... -> Document?)
  4. Other (please specify)

:::

Pick a number or type a custom response. Options 3 and 4 are always present at the bottom.

If no tactics exist, the orchestrator prompts you to describe your task directly.

## What happens before the stages

Every time you run `/lineup:kick-off`, the orchestrator runs an initialization sequence before the first stage begins:

1. **Agent configuration** -- reads your override files from `~/.claude/lineup/agents/` (if any) and merges them with plugin defaults. If you customized agent models or tools via `/lineup:configure`, those customizations are applied here.
2. **Memory migration** -- checks if any agent has global memory that should be migrated to project-scoped memory. This is a one-time operation per project, and it runs silently if there is nothing to migrate.
3. **Tactic discovery** -- scans `.lineup/tactics/` (your project) and the plugin's `tactics/` directory for available tactics. This is what powers the menu mode selection and tactic-by-name invocation.

You will not see explicit output from this phase unless there is a warning (e.g., a malformed override file or a version mismatch). It happens automatically in the background.

## What to expect at each stage

### Stage 0: Triage

Before any visible stage begins, the orchestrator performs a fast, lightweight analysis of your request. No agent is spawned -- this is pure orchestrator reasoning.

**What it produces:** A triage assessment containing `affected_areas`, `complexity` (simple/moderate/complex), `search_targets` (specific directories, file patterns, and questions for researchers), and `independent_areas` (groups that can be planned in parallel).

**What you see:** Nothing -- triage is not shown as a separate approval gate. It feeds directly into the stages that follow. Its output drives research scoping (search targets become researcher directives), conditional approach analysis in planning (simple tasks get 1 approach, moderate/complex get 2-3), and parallel architect spawning when 2+ independent areas are detected.

**How it's counted:** Stage progress reports show "Stage N/7" -- triage is Stage 0 and does not count toward the 7-stage total.

### Stage 1: Clarify

The orchestrator analyzes your request and asks structured questions to fill in gaps. You'll see multiple-choice questions with 3-5 options each, plus a free-text option.

:::info Stage 1/7 -- Clarify

Stage 1/7: Clarify

1. What validation rules do you need?
   a) Email format + password length (minimum 8 chars)
   b) Email format + strong password
   c) Custom rules (please specify)

:::

**What you do:** Pick the options that match your needs, or type a custom answer. Related questions are batched together so you answer them all at once.

**When it's skipped:** If your request is already specific and unambiguous, the orchestrator moves on without questions.

### Stage 2: Research

One or more researcher agents explore your codebase. They're read-only, so nothing gets modified. You'll see them spawned and working through relevant files.

**What you do:** Nothing. Wait for the findings.

### Stage 3: Clarification Gate

The orchestrator reviews research findings and checks for remaining ambiguities. If the research uncovered something unexpected, you'll get follow-up questions.

:::warning Stage 3/7 -- Clarification Gate

Stage 3/7: Clarification Gate

The research found that your project uses both Zod and Yup.
Which validation library should the new code use?

   a) Zod (consistent with the API layer)
   b) Yup (consistent with other web forms)
   c) Other (please specify)

:::

**What you do:** Answer any questions that come up.

**When it's skipped:** If the research was clean with no open questions, you won't see this stage at all.

### Stage 4: Plan

An architect agent creates an implementation plan. The orchestrator presents it and **waits for your approval**.

**What you do:** Read the plan carefully. Then:
- **Approve** -- type "yes" or "approve" to move forward
- **Reject** -- type "no" to send the architect back for revision
- **Suggest changes** -- describe what you want adjusted

This is the key checkpoint. Nothing gets implemented until you say yes.

### Stage 5: Implement

Developer agents write code following the approved plan. You'll see changes appearing in your project files.

**What you do:** Wait. For larger plans, multiple developers may run in parallel on independent parts.

### Stage 6: Verify

A reviewer agent runs tests, reviews the diff against the plan, and checks for regressions. You'll see a verification report with pass/fail status.

**What you do:** Review the results. If something fails, the orchestrator can loop back to fix issues.

### Stage 7: Document (Optional)

The orchestrator asks if you want documentation generated:

:::warning Stage 7/7 -- Document (optional)

Would you like to generate documentation for these changes?
   a) Yes, generate documentation
   b) No, skip documentation

:::

**What you do:** Choose yes or no. If yes, a documenter agent writes or updates docs in your project. If no, the pipeline is done.

## How to respond to prompts

Throughout the pipeline, the orchestrator uses structured prompts called **AskUserQuestion**. These always follow the same pattern:

- A question with context
- Numbered options (usually 3-5)
- A free-text option at the end

You can respond by:
- Typing a number or letter (`1`, `a`)
- Typing the option text (`Zod`)
- Typing a free-text answer if none of the options fit

## How to skip optional stages

When a tactic defines a stage as `optional: true`, the orchestrator asks before running it:

:::warning Optional Stage

Would you like to run the Research stage? (yes/no)

:::

Type "no" or "skip" to skip the stage. Execution continues with the next stage in the sequence.

The default pipeline also has built-in skipping logic:
- Clarify is skipped when the request is already specific
- Clarification Gate is skipped when research yields no open questions
- Document is always opt-in at the end

## How to approve or reject plans

After the Plan stage (and after any stage with `gate: approval`), the orchestrator pauses and waits for explicit approval. You can:

- **Approve:** "yes", "approve", "looks good", "go ahead"
- **Reject:** "no", "reject" -- the stage re-runs for revision
- **Modify:** Describe specific changes -- "Change step 2 to use PostgreSQL instead of MySQL"

The orchestrator won't proceed until you explicitly approve.

## Restarting from a specific stage

If a pipeline run was interrupted or you want to re-run later stages without repeating earlier work, use `--from-stage`:

```bash
/lineup:kick-off Refactor the auth module --from-stage 4
```

This loads cached outputs from stages 0 through 3 and begins execution at stage 4 (Plan). Stage outputs are cached in `.lineup/.cache/` during each run, keyed by a hash of the task prompt and triage assessment.

If a required cache file is missing, the orchestrator reports which stage is missing and suggests a lower restart point:

```
Cannot restart from stage 4: cached output for stage 2 is missing.
Run the full pipeline first, or use --from-stage 2.
```

Cache files are ephemeral -- they are cleaned up at the end of every successful pipeline run. Cache from interrupted runs persists until the next successful completion.

## Choosing what to type

| What you want to do | What to type |
| -------------------- | ------------ |
| Run the full pipeline on a task | `/lineup:kick-off <task description>` |
| Run a specific tactic | `/lineup:kick-off <tactic-name>` |
| See available tactics and choose | `/lineup:kick-off` |
| Restart from a specific stage | `/lineup:kick-off <task> --from-stage N` |
| Force the full pipeline on a specific task | `/lineup:kick-off <task>` then say "let's do the full pipeline" |
| Force a lighter pipeline | `/lineup:kick-off <task>` then say "skip research, I know this codebase" |
