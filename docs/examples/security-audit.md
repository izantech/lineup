# Security Audit

This walkthrough shows a complete dependency security audit using the `dependency-security-audit` tactic. The tactic demonstrates variables for configuring severity thresholds and package managers, plus two approval gates that let you review findings and approve the remediation plan before any changes are made.

## The scenario

Your team has received a security review request before a production release. You need to audit all npm dependencies for known vulnerabilities at high severity or above, plan upgrades for anything flagged, implement the upgrades, and verify nothing breaks.

You have the `dependency-security-audit` tactic in your project:

```yaml
# .lineup/tactics/dependency-security-audit.yaml
name: dependency-security-audit
description: |
  Audit project dependencies for known vulnerabilities and outdated packages.
  Researches the dependency tree, plans remediation prioritized by severity,
  implements upgrades and patches, and verifies no regressions.

variables:
  - name: minimum_severity
    description: "Minimum vulnerability severity to act on (low, moderate, high, critical)"
    default: "high"
  - name: package_manager
    description: "Package manager used by the project (npm, yarn, pnpm, pip, cargo, go)"
    default: "npm"

stages:
  - type: research
    agent: researcher
    gate: approval
    prompt: |
      Run a dependency audit using ${package_manager}. Catalog all known
      vulnerabilities at or above ${minimum_severity} severity. For each finding,
      record: package name, current version, vulnerability ID, severity, and
      whether a patched version exists. Also identify critically outdated
      packages (more than two major versions behind) even if no CVE exists.
  - type: plan
    agent: architect
    gate: approval
    prompt: |
      Create a remediation plan based on the audit findings. For each vulnerable
      or outdated dependency:
      1. Recommend upgrade, patch, or replacement
      2. Note breaking changes in the upgrade path
      3. Flag transitive dependencies that may resist upgrading
      Prioritize by severity and blast radius. Group safe upgrades into a single
      batch and isolate risky ones for individual attention.
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
    prompt: |
      Verify the dependency upgrades: re-run the audit to confirm vulnerabilities
      are resolved, run the full test suite, and check for runtime errors caused
      by breaking changes in upgraded packages.

verification:
  - "All vulnerabilities at or above the target severity are resolved"
  - "Dependency audit returns clean at the target severity threshold"
  - "All existing tests pass after upgrades"
  - "No new vulnerabilities introduced by the upgrades"
  - "Lock file is committed and consistent with package manifest"
```

## Starting the pipeline

You type:

```bash
/lineup:kick-off dependency-security-audit
```

The orchestrator finds the tactic and sees two variables. Before executing any stages, it prompts for each one:

:::warning Variable Input Required

`minimum_severity`: Minimum vulnerability severity to act on (low, moderate, high, critical)
1. high (default)
2. Enter custom value

:::

You accept the default **high**. Then:

:::warning Variable Input Required

`package_manager`: Package manager used by the project (npm, yarn, pnpm, pip, cargo, go)
1. npm (default)
2. Enter custom value

:::

Your project uses pnpm, so you type **pnpm**. The orchestrator substitutes both values into the stage prompts and begins.

## Stage 1: Research (approval gate)

The researcher agent runs the audit with the substituted variables.

:::info Stage 1/4 -- Research

Running dependency audit using pnpm...

Research complete. Audit findings:

Vulnerabilities at or above high severity:

| Package         | Current | Vuln ID         | Severity | Patched version |
| --------------- | ------- | --------------- | -------- | --------------- |
| jsonwebtoken    | 8.5.1   | CVE-2022-23529  | Critical | 9.0.0           |
| axios           | 0.21.4  | CVE-2023-45857  | High     | 1.6.0           |
| xml2js          | 0.4.23  | CVE-2023-0842   | High     | 0.5.0           |

Critically outdated packages (no CVE, but >2 major versions behind):
- webpack: 4.46.0 (current stable: 5.90.x)
- typescript: 4.9.5 (current stable: 5.3.x)

Transitive vulnerability:
- jsonwebtoken is a direct dependency
- axios is used directly and also pulled in by @octokit/rest
- xml2js is transitive via aws-sdk (not used directly)

:::

:::warning Approval Gate

Do you approve these findings? (yes/no)

:::

The `gate: approval` on the research stage pauses execution here. You review the findings, confirm they match your expectations, and type **yes**.

## Stage 2: Plan (approval gate)

The architect receives the audit findings and creates a remediation plan.

:::tip Stage 2/4 -- Plan

Creating remediation plan...

Remediation Plan

Batch 1 -- Safe upgrades (no breaking changes expected):
- axios: 0.21.4 -> 1.6.2
  - Minor API differences in error handling, but your usage is standard.
  - Also resolves the transitive copy from @octokit/rest.
- xml2js: 0.4.23 -> 0.5.0
  - This is transitive via aws-sdk. Upgrade aws-sdk to latest v3 which bundles its own XML parser. If aws-sdk is not directly used, consider removing it entirely.

Batch 2 -- Breaking changes (individual attention):
- jsonwebtoken: 8.5.1 -> 9.0.0
  - Breaking: `verify()` no longer accepts the complete callback signature.
  - The second argument changed from `(err, decoded)` to `(err, payload)`.
  - Affected files: `src/middleware/auth.ts`, `src/services/token.ts`
  - Migration: update callback signatures, add explicit type annotations.

Deferred (not security-related):
- webpack 4 -> 5: significant migration, recommend separate task
- typescript 4.9 -> 5.3: recommend separate task after tests are green

:::

:::warning Approval Gate

Do you approve this plan? (yes/no)

:::

Again, the approval gate pauses. You read the plan, see that the webpack and TypeScript upgrades are correctly deferred, and type **yes**.

## Stage 3: Implement

The developer agent implements the approved remediation plan.

:::details Stage 3/4 -- Implement

Implementing remediation plan...

Batch 1:
- Updated `pnpm-lock.yaml`
- axios: 0.21.4 -> 1.6.2 (updated import in 3 files for error type changes)
- Removed aws-sdk (confirmed unused -- only transitive dependency origin)
- xml2js vulnerability resolved by removing aws-sdk

Batch 2:
- Updated `package.json`: jsonwebtoken 8.5.1 -> 9.0.0
- Updated `src/middleware/auth.ts`:
  - Changed `verify()` callback from `(err, decoded)` to `(err, payload)`
  - Added `JwtPayload` type import
- Updated `src/services/token.ts`:
  - Same callback signature update
  - Updated token options to use new API
- Updated `pnpm-lock.yaml`

Implementation complete. 5 files modified, 0 files created.

:::

## Stage 4: Verify

The reviewer re-runs the audit and the test suite.

:::tip Stage 4/4 -- Verify

Verification report:
- Dependency audit (`pnpm audit --severity high`): 0 vulnerabilities found
- Build: **PASS**
- Tests: 89 run, 89 passed, 0 failed
- Verification criteria:
  - All vulnerabilities at or above high severity resolved: **PASS**
  - Dependency audit returns clean at high threshold: **PASS**
  - All existing tests pass after upgrades: **PASS**
  - No new vulnerabilities introduced: **PASS**
  - Lock file consistent with package manifest: **PASS**
- Status: **PASS**

:::

## Final result

| Stage | Agent | Duration | User action |
| ----- | ----- | -------- | ----------- |
| Research | researcher | ~20s | Reviewed findings, approved |
| Plan | architect | ~15s | Reviewed remediation plan, approved |
| Implement | developer | ~45s | Waited |
| Verify | reviewer | ~15s | Reviewed results |

**Files modified:** 5 files (package.json, pnpm-lock.yaml, 2 source files, 1 import cleanup). All changes are in your working directory, ready for `git diff`.

## Key patterns in this walkthrough

**Two variables.** The `minimum_severity` and `package_manager` variables let the same tactic work across different projects and risk tolerances. A team running a routine check might use `moderate`; a pre-release audit might use `high` or `critical`.

**Two approval gates.** Both the research and plan stages require explicit approval before proceeding. This is critical for security work -- you want to validate the findings before planning, and validate the plan before anyone starts upgrading packages. The gates give you two checkpoints to catch issues: "are these the right vulnerabilities?" and "is this the right fix?".

**Verification criteria.** The five verification items in the tactic's `verification` field give the reviewer agent specific things to check. The reviewer doesn't just run tests -- it re-runs the audit to confirm the vulnerabilities are actually resolved.

**Deferred work.** The architect correctly separated security-critical upgrades from nice-to-have modernization. The webpack and TypeScript upgrades would have added risk and scope without addressing any vulnerabilities.

## When to use dependency-security-audit

This tactic fits best when:

- You need to audit before a production release or compliance review
- A vulnerability scanner has flagged your project and you need to remediate
- You're inheriting a project with an outdated dependency tree
- You want a structured, reviewable process for dependency upgrades rather than blindly running `npm audit fix`
