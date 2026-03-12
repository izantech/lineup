# CLI 2.0 Pre-Release Validation Guide

Quick manual checks to run before tagging a release.
The install/update commands require a published GitHub release, so this guide
covers everything you can validate locally from the repo checkout.

## Prerequisites

```bash
cd cli
npm install
npm run build
```

## 1. Automated checks (CI parity)

Run the same checks CI will run. All five must pass:

```bash
npm run typecheck
npm test
npm run schema:check
npm run generate:check
npm run build
```

## 2. Dist smoke test

Validates the built dist entry-point boots, parses args, and returns valid
status JSON — all inside an isolated temp HOME:

```bash
npm run smoke:dist
```

## 3. Manual CLI smoke (built dist)

Run the built binary directly — this is the same code path end users hit.

```bash
LINEUP="node bin/lineup.mjs"
```

### Version

```bash
$LINEUP --cli-version
# Expected: 2.0.0
```

### Help

```bash
$LINEUP --help
# Expected: shows lineup description + install/update/uninstall/status commands

$LINEUP install --help
# Expected: shows --host, --version, --yes options
```

### Status

```bash
$LINEUP status --host all
# Expected: both claude and codex listed

$LINEUP status --host all --json
# Expected: JSON with schema_version, state_file, hosts.claude, hosts.codex

$LINEUP status --host claude
# Expected: only claude host listed
```

### Invalid host (error path)

```bash
$LINEUP status --host bogus
# Expected: exits 1 with "Invalid --host value: bogus"
```

## 4. Global link test (optional, in a temp project)

This simulates what an end user does after `npm install -g @izantech/lineup-cli`.

```bash
# from the cli/ directory
npm link

# move to a throwaway directory
cd $(mktemp -d)

# verify the binary is on PATH
lineup --cli-version
# Expected: 2.0.0

lineup --help
lineup status --host all --json

# cleanup
npm unlink -g @izantech/lineup-cli
```

## 5. Install dry-run (expects published release)

> Skip this step until a GitHub release tag exists. It will fail with an HTTP
> error because `resolveRelease` fetches from the GitHub API.

```bash
lineup install --host claude --version 2.0.0
```

If you need to test the install path before publishing, the unit tests in
`test/operations-lifecycle.test.ts` cover the full install/update/uninstall
flow with injected dependencies (no network).

## Checklist

- [ ] All 5 automated checks pass
- [ ] `smoke:dist` passes
- [ ] `--cli-version` prints `2.0.0`
- [ ] `status --host all --json` returns valid JSON with expected shape
- [ ] Invalid host is rejected
- [ ] (Optional) `npm link` → `lineup` binary works from PATH
