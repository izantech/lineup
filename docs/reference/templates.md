# Document Templates

This is the complete reference for Lineup's document template schemas. For a conceptual overview of how documents flow between agents, see [Ephemeral Documents](/concepts/ephemeral-documents).

## Overview

Templates define the YAML structure that agents follow when producing output. They are located in the plugin's `templates/` directory and serve as format references -- agents structure their conversation output according to these schemas, but no files are written to your project (except documentation files from the documenter agent).

Agents receive their output formatting instructions from two sources: the template schemas in `templates/` define the YAML structure, and the centralized instructions in `AGENTS.md` (sections "Agent Document Output Instructions" and "Agent Persistent Memory Instructions") define how agents present output and manage persistent memory.

| Template | Agent | Document type |
| -------- | ----- | ------------- |
| `templates/researcher.yaml` | Researcher | Research findings |
| `templates/architect.yaml` | Architect | Implementation plan |
| `templates/developer.yaml` | Developer | Implementation report |
| `templates/reviewer.yaml` | Reviewer | Review report |
| `templates/documenter.yaml` | Documenter | Documentation report |
| `templates/teacher.yaml` | Teacher | Explanation |

## Common fields

Every document includes these core fields:

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `type` | string | Yes | Document type identifier |
| `agent` | string | Yes | Agent that produced the document |
| `date` | string | Yes | Creation date in `YYYY-MM-DD` format |
| `topic` | string | Yes | Short topic label in kebab-case |
| `status` | string | Yes | Document status (varies by type) |
| `pipeline_stage` | integer or null | Yes | Pipeline stage number, or `null` for non-pipeline documents |

### Type values

| Value | Template | Agent |
| ----- | -------- | ----- |
| `research` | researcher.yaml | Researcher |
| `plan` | architect.yaml | Architect |
| `implementation` | developer.yaml | Developer |
| `review` | reviewer.yaml | Reviewer |
| `documentation` | documenter.yaml | Documenter |
| `explanation` | teacher.yaml | Teacher |

### Status values

| Document type | Valid statuses |
| ------------- | ------------- |
| Research | `complete` |
| Plan | `draft`, `approved`, `superseded` |
| Implementation | `complete` |
| Review | `PASS`, `FAIL`, `PASS_WITH_WARNINGS` |
| Documentation | `complete` |
| Explanation | `complete` |

### Pipeline stage values

| Value | Stage |
| ----- | ----- |
| `2` | Research |
| `4` | Plan |
| `5` | Implement |
| `6` | Verify |
| `7` | Document |
| `null` | Not part of the main pipeline (e.g., explanations) |

### Conditional fields

| Field | Type | Applies to | Description |
| ----- | ---- | ---------- | ----------- |
| `plan_ref` | string | `implementation`, `review` | Reference to the plan document. Required for implementation and review types. |

## Researcher template

**File:** `templates/researcher.yaml`

Research findings produced during the Research stage.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `what_found.key_files` | list | Files relevant to the research, with path, line range, and description |
| `what_found.classes` | list | Classes found, with name, relationships, and description |
| `what_found.functions` | list | Functions found, with name, file, lines, and description |
| `what_found.data_structures` | list | Data structures and patterns found |
| `how_it_works.execution_flow` | string | Step-by-step description of execution flow |
| `how_it_works.data_flow` | string | How data transforms through the system |
| `how_it_works.architectural_patterns` | list | Patterns found, with description and locations |
| `constraints.dependencies.external` | list | External dependency names and versions |
| `constraints.dependencies.internal` | list | Internal module or component dependencies |
| `constraints.limitations` | list | What the system does not handle |
| `constraints.edge_cases` | list | Edge cases, with condition and behavior |
| `gaps.unable_to_determine` | list | What could not be determined |
| `gaps.needs_investigation` | list | Questions needing further investigation, with context |

## Architect template

**File:** `templates/architect.yaml`

Implementation plans produced during the Plan stage.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `summary` | string | One-paragraph overview of what will be done and why |
| `approaches` | list | 2-3 competing approaches with strategy, pros, cons, and scope |
| `approaches[].name` | string | Approach name |
| `approaches[].strategy` | string | How the approach works |
| `approaches[].pros` | list | Advantages |
| `approaches[].cons` | list | Disadvantages |
| `approaches[].scope.files_changed` | integer | Estimated number of files changed |
| `approaches[].scope.lines_changed` | integer | Estimated number of lines changed |
| `recommendation.approach` | string | Name of the recommended approach |
| `recommendation.rationale` | string | Why this approach is recommended |
| `changes` | list | Ordered list of specific modifications |
| `changes[].file` | string | File path |
| `changes[].change` | string | Description of the modification |
| `changes[].rationale` | string | Why this change is needed |
| `parallelization_strategy.batches` | list | Parallel execution batches |
| `parallelization_strategy.batches[].batch_number` | integer | Batch sequence number |
| `parallelization_strategy.batches[].execution` | string | `parallel` or `sequential` |
| `parallelization_strategy.batches[].changes` | list | Change numbers in this batch |
| `parallelization_strategy.batches[].rationale` | string | Why these changes are grouped |
| `dependencies` | list | Order constraints between changes |
| `dependencies[].from_change` | integer | Change that depends on another |
| `dependencies[].to_change` | integer | Change that must complete first |
| `dependencies[].description` | string | Description of the dependency |
| `acceptance_criteria` | list | How to verify the implementation |
| `acceptance_criteria[].criterion` | string | What to check |
| `acceptance_criteria[].verified_by` | string | How to check it |
| `risks` | list | Potential issues |
| `risks[].risk` | string | Description of the risk |
| `risks[].mitigation` | string | How to handle it |
| `risks[].severity` | string | `low`, `medium`, `high`, or `critical` |

## Developer template

**File:** `templates/developer.yaml`

Implementation reports produced during the Implement stage.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `plan_ref` | string | Reference to the architect's plan document |
| `changes_made` | list | Files modified |
| `changes_made[].file` | string | File path |
| `changes_made[].description` | string | What was changed |
| `changes_made[].lines_modified` | string | Line range modified |
| `issues_encountered` | list | Problems found during implementation |
| `issues_encountered[].issue` | string | Description of the problem |
| `issues_encountered[].resolution` | string | How it was resolved |
| `issues_encountered[].impact` | string | `none`, `minor`, `moderate`, or `significant` |
| `verification.build.command` | string | Build command run |
| `verification.build.result` | string | `success` or `failure` |
| `verification.build.output` | string | Build output summary |
| `verification.tests.command` | string | Test command run |
| `verification.tests.result` | string | `success` or `failure` |
| `verification.tests.tests_run` | integer | Number of tests run |
| `verification.tests.tests_passed` | integer | Number of tests passed |
| `verification.tests.tests_failed` | integer | Number of tests failed |
| `verification.linting.command` | string | Lint command run |
| `verification.linting.result` | string | `success` or `failure` |
| `verification.linting.issues_found` | integer | Number of lint issues found |

## Reviewer template

**File:** `templates/reviewer.yaml`

Review reports produced during the Verify stage.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `plan_ref` | string | Reference to the architect's plan document |
| `summary` | string | One-paragraph assessment of the implementation |
| `issues` | list | Issues found during review |
| `issues[].severity` | string | `critical`, `warning`, or `suggestion` |
| `issues[].confidence` | integer | 75-100 (only issues >= 75 confidence are reported) |
| `issues[].file` | string | File path |
| `issues[].line` | integer | Line number |
| `issues[].description` | string | What is wrong and why it matters |
| `issues[].fix` | string | Recommended fix |
| `test_results.test_suite.status` | string | `pass` or `fail` |
| `test_results.test_suite.tests_run` | integer | Number of tests run |
| `test_results.test_suite.tests_passed` | integer | Number of tests passed |
| `test_results.test_suite.tests_failed` | integer | Number of tests failed |
| `test_results.coverage.available` | boolean | Whether coverage data is available |
| `test_results.coverage.percentage` | number | Coverage percentage |
| `test_results.coverage.uncovered_areas` | list | File paths and line ranges not covered |

### Confidence scoring

The reviewer rates each issue from 0 to 100. Only issues scoring 75 or above are included in the report:

| Score | Meaning |
| ----- | ------- |
| 0 | False positive or pre-existing issue |
| 25 | Might be real, might be false positive |
| 50 | Real issue but minor or unlikely in practice |
| 75 | Verified real issue -- will impact functionality or violates conventions |
| 100 | Confirmed critical issue, will happen frequently |

## Documenter template

**File:** `templates/documenter.yaml`

Documentation reports produced during the Document stage.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `summary` | string | One-paragraph overview of documentation created or updated |
| `documentation_created` | list | Documentation files written |
| `documentation_created[].file` | string | File path |
| `documentation_created[].type` | string | `readme`, `api`, `guide`, `inline`, or `changelog` |
| `documentation_created[].description` | string | What the document covers |
| `documentation_created[].action` | string | `created` or `updated` |
| `documentation_gaps` | list | Areas still needing documentation |
| `documentation_gaps[].area` | string | Area description |
| `documentation_gaps[].priority` | string | `high`, `medium`, or `low` |
| `documentation_gaps[].suggestion` | string | What should be documented and where |
| `conventions_followed` | list | Documentation conventions observed and applied |

## Teacher template

**File:** `templates/teacher.yaml`

Explanations produced by the explain workflow.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `learning_objectives` | list | What the user will understand after the explanation |
| `prerequisites` | list | Concepts the user should already know |
| `prerequisites[].concept` | string | Prerequisite concept name |
| `prerequisites[].description` | string | Brief description of what the user should know |
| `explanation.overview` | string | High-level summary of the topic |
| `explanation.sections` | list | Structured explanation sections |
| `explanation.sections[].title` | string | Section heading |
| `explanation.sections[].content` | string | Detailed explanation |
| `explanation.sections[].code_examples` | list | Code snippets from the codebase |
| `explanation.sections[].code_examples[].file` | string | Source file path |
| `explanation.sections[].code_examples[].lines` | string | Line range |
| `explanation.sections[].code_examples[].description` | string | What the code demonstrates |
| `explanation.sections[].key_takeaways` | list | Key points from the section |
| `further_exploration` | list | Related topics to explore next |
| `further_exploration[].topic` | string | Topic name |
| `further_exploration[].relevance` | string | Why this might be interesting |

## Document lifecycle

All documents are ephemeral -- they exist in the conversation context only. The orchestrator passes them between agents as structured input. No files are written to the project directory, with the sole exception of the documenter agent, which writes documentation files as a side effect of its work (the report itself is still ephemeral).

For more on how context flows between agents, see [Ephemeral Documents](/concepts/ephemeral-documents).
