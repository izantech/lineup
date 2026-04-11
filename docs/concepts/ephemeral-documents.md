# Ephemeral Documents

Agents produce structured documents at every stage of the pipeline: research findings, implementation plans, code reviews, and more. These documents are **ephemeral by default** -- they exist in the conversation context and are never written to disk unless you choose to save them.

## Why ephemeral?

Lineup takes an ephemeral-first approach to keep your project clean:

- **No persistent `.lineup/` artifacts** cluttering your repository (tactics are the only user-created exception)
- **No tool-specific files** that your team has to understand or maintain
- **No stale documents** from previous runs hanging around in the file tree

The only files Lineup writes to your project are the actual code changes (from the developer agent) and documentation files (from the documenter agent, if you opt in). Everything else stays in the conversation.

During a pipeline run, Lineup may use two temporary directories under `.lineup/`:

- **`.lineup/.cache/`** -- stage result cache for `--from-stage` restarts (keyed by task prompt + triage hash)
- **`.lineup/.ephemeral/`** -- transient files for large intermediate outputs that exceed the ~2 KB snapshot threshold

Both are ephemeral. Cache files persist across runs to support restarts but are not repository artifacts. Ephemeral files are cleaned up automatically during Stage 6 (Verify) and pipeline cleanup. Neither directory needs to be tracked in version control.

## The YAML format

All agent output follows YAML schemas defined in the `templates/` directory. Using a structured format ensures documents are consistent, parseable, and easy for downstream agents to consume.

Every document includes these core fields:

| Field | Values | Description |
| ----- | ------ | ----------- |
| `type` | `research`, `plan`, `implementation`, `review`, `documentation`, `explanation` | Document type |
| `agent` | `researcher`, `architect`, `developer`, `reviewer`, `documenter`, `teacher` | Which agent produced it |
| `date` | `YYYY-MM-DD` | Creation date |
| `topic` | kebab-case string | Short topic label |
| `status` | varies by type | Document status |
| `pipeline_stage` | `2`, `4`, `5`, `6`, `7`, or `null` | Pipeline stage number |

Status values depend on the document type:

| Type | Possible statuses |
| ---- | ----------------- |
| Research | `complete` |
| Plan | `draft`, `approved`, `superseded` |
| Implementation | `complete` |
| Review | `PASS`, `FAIL`, `PASS_WITH_WARNINGS` |
| Documentation | `complete` |
| Explanation | `complete` |

Beyond these core fields, each document type has its own structure -- research findings include `what_found`, `how_it_works`, `constraints`, and `gaps`; plans include file lists and acceptance criteria; reviews include test results and pass/fail status.

## How context flows between agents

The orchestrator is responsible for passing documents between agents. When it delegates to a downstream agent, it includes the relevant upstream output in the prompt:

:::info Context Flow

Researcher findings → Architect (plan creation)
Architect plan → Developer (implementation)
Architect plan + Developer report → Reviewer (verification)
Architect plan + Developer report + Review report → Documenter (documentation)

:::

Each agent receives the structured YAML from previous stages as input context, uses it to inform its work, and produces its own YAML output for the next stage.

This chain means that every agent builds on verified, structured context rather than starting from scratch. The researcher's findings directly shape the architect's plan, which directly shapes the developer's implementation.

To optimize token usage, the orchestrator does not forward complete documents between stages. Instead, it creates **context snapshots** -- curated subsets containing only the sections each downstream agent needs. For example, the developer receives only the `changes`, `parallelization_strategy`, and `acceptance_criteria` sections of the plan, not the full approaches analysis. This keeps each agent's context focused and reduces cost without losing the information needed for the task.

## Document lifecycle

| Document | Produced by | Consumed by | Storage |
| -------- | ----------- | ----------- | ------- |
| Research findings | Researcher | Architect, Orchestrator | Conversation only |
| Implementation plan | Architect | Developer, Reviewer | Conversation only |
| Implementation report | Developer | Reviewer | Conversation only |
| Review report | Reviewer | User, Documenter | Conversation only |
| Documentation report | Documenter | User | Conversation only (but docs are written to project) |
| Explanation | Teacher | User | Conversation only |

Note that the documenter is the only agent whose *side effects* persist -- it writes documentation files to your project. But even the documenter's report (listing what it created) is ephemeral.

## When to save documents

All documents appear in your conversation as formatted YAML. If you want to keep one for future reference, you can copy it from the conversation and save it wherever you like.

Common reasons to save a document:
- **Plans** you want to reference later or share with your team
- **Research findings** that map out an unfamiliar part of the codebase
- **Explanations** that serve as onboarding material

Lineup never saves these automatically -- it's always your choice.

## Template schemas

Each document type has a corresponding template in the `templates/` directory:

| Template | Document type |
| -------- | ------------- |
| `templates/researcher.yaml` | Research findings |
| `templates/architect.yaml` | Implementation plan |
| `templates/developer.yaml` | Implementation report |
| `templates/reviewer.yaml` | Review report |
| `templates/documenter.yaml` | Documentation report |
| `templates/teacher.yaml` | Explanation |

These templates define the full structure that agents follow. For the complete field-by-field specification, see [Document Templates](/reference/templates).
