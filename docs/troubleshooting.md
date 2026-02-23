# Troubleshooting

Common issues and solutions when using Lineup. Each entry follows the pattern: **symptom**, **diagnosis**, **solution**.

## Plugin not found

**Symptom:** Running `/lineup:kick-off` gives "command not recognized" or "no such skill".

**Diagnosis:** The Claude host install is missing, stale, or failed to sync.

**Solution:**

Check current host status:

```bash
lineup status --host claude
```

Install or re-install Claude host assets:

```bash
lineup install --host claude
```

Force non-interactive recovery:

```bash
lineup install --host claude --yes
lineup update --host claude --version latest --yes
```

## Install/update fails with HTTP or release errors

**Symptom:** `lineup install` or `lineup update` fails with errors like `http_error`, `release_not_found`, or `release_manifest_missing`.

**Diagnosis:** The CLI could not resolve or download release artifacts from GitHub.

**Solution:**

1. Check your network connectivity and GitHub availability.
2. Retry with an explicit existing tag:

```bash
lineup install --host all --version <existing-tag> --yes
```

3. If `latest` fails, retry once GitHub API access is healthy.
4. See [CLI Manager Reference](/reference/cli) for the release resolution and cache model.

## Install/update fails with checksum mismatch

**Symptom:** Install/update fails with `checksum_mismatch`.

**Diagnosis:** Downloaded release archive digest did not match the manifest checksum.

**Solution:**

1. Remove the cached tag directory:

```bash
rm -rf ~/.lineup/cache/<tag>
```

2. Re-run install/update for that tag.

## Agent not recognized

**Symptom:** The orchestrator reports "no such agent" when trying to spawn `researcher`, `architect`, or another agent.

**Diagnosis:** Agent names are auto-namespaced by the plugin. They should appear as `lineup:researcher`, `lineup:architect`, etc. If the namespace is missing, the plugin manifest may not be loading correctly.

**Solution:**

1. Confirm `.claude-plugin/plugin.json` exists and contains `"name": "lineup"`.
2. Check that all agent files are present in the `agents/` directory: `researcher.md`, `architect.md`, `developer.md`, `reviewer.md`, `documenter.md`, `teacher.md`.
3. For customized installs, run `/lineup:configure` and choose **Reset** to restore default agent settings.

## Tactic not discovered

**Symptom:** Running `/lineup:kick-off my-tactic` says no tactic was found, even though the file exists.

**Diagnosis:** Tactics must be in `.lineup/tactics/` (with the leading dot), not `lineup/tactics/`. The directory name matters.

**Solution:**

Verify the directory structure:

<div class="file-tree">

- <span class="tree-folder">your-project/</span>
  - <span class="tree-folder">.lineup/</span> <span class="tree-comment">dot prefix required</span>
    - <span class="tree-folder">tactics/</span>
      - <span class="tree-file">my-tactic.yaml</span>

</div>

Also check:
- The file extension is `.yaml` (not `.yml`)
- The `name` field inside the YAML matches the filename without the extension
- The file is valid YAML (no syntax errors)

## Stage skipped unexpectedly

**Symptom:** You expected the full pipeline (Clarify, Research, Plan, Implement, Verify) but the orchestrator jumped straight to Plan or Implement.

**Diagnosis:** The orchestrator infers a [pipeline tier](/concepts/pipeline-tiers) from your request. If your description was specific enough, it may have selected the Lightweight tier (Plan, Implement, Verify) or Direct tier (just do it), skipping the earlier stages.

**Solution:**

Be explicit about wanting the full pipeline:

```bash
/lineup:kick-off Let's do the full pipeline. Add a caching layer to the API.
```

Or tell the orchestrator after it starts:

```bash
Actually, let's start with clarification and research on this one.
```

See [Choose a Pipeline Tier](/guides/choose-tier) for details on how the orchestrator decides.

## Context window exhaustion on large codebases

**Symptom:** The pipeline stalls, produces incomplete results, or the researcher's findings are truncated mid-way through.

**Diagnosis:** The researcher agent explored too many files and the conversation context filled up before downstream stages could run. This typically happens with broad requests on large codebases.

**Solution:**

Scope your request more narrowly. Instead of broad requests, target specific modules:

```bash
# Too broad -- researcher tries to explore everything
/lineup:kick-off Refactor the backend

# Scoped -- researcher focuses on one module
/lineup:kick-off Refactor the authentication middleware in src/auth/
```

The researcher follows a [context-efficient protocol](/concepts/context-efficiency#the-research-protocol) (map with Glob, scan with Grep, read only targeted sections), but it works best when given clear boundaries. For very large codebases:

- **Scope the research area**: Mention specific directories or modules in your request. The orchestrator passes this to the researcher as a focus boundary.
- **Use a tactic**: Create a tactic with a custom research prompt that specifies exactly which areas to explore and which to ignore.
- **Split the task**: Break the work into smaller, independent parts and run the pipeline on each.
- **Skip research**: If you already know the codebase, say "Skip research" or "I know this codebase well, go straight to planning."

## Agent memory conflicts between projects

**Symptom:** An agent applies patterns or conventions from a different project. For example, the developer uses a testing framework you don't use, or the architect references an API pattern from another codebase.

**Diagnosis:** This typically happens when agents are configured with `memory: user` instead of the default `memory: project`. User-scoped memory is stored in `~/.claude/agent-memory/<agent>/` and is shared across all projects, so patterns learned in one project may be applied to another.

**Solution:**

If you changed agents to `memory: user`, consider switching back to the default `memory: project` so knowledge stays isolated per project. Run `/lineup:configure` and set memory scope to `project`.

Alternatively, be explicit in your task description about which patterns to follow: "Use Vitest for testing, not Jest" or "Follow the existing Express middleware pattern in this project."

## Built-in tactic not found

**Symptom:** Running `/lineup:kick-off explain` or `/lineup:explain` reports that the `explain` tactic was not found.

**Diagnosis:** Claude host assets are outdated or corrupted, so built-in tactic files are missing from the active install.

**Solution:**

Refresh the Claude host install from the latest release:

```bash
lineup update --host claude --version latest --yes
```

Then verify status:

```bash
lineup status --host claude
```

If needed, reinstall:

```bash
lineup install --host claude --yes
```

## VitePress build errors (for contributors)

**Symptom:** Running `npx vitepress build` in the `docs/` directory fails with dead link errors or missing pages.

**Diagnosis:** VitePress has strict dead link checking. If the sidebar in `docs/.vitepress/config.mts` references a page that doesn't exist yet, the build fails.

**Solution:**

Check which links are broken from the build error output. Common causes:

- A page was added to the sidebar config but not yet created
- A page was renamed or moved but the sidebar link wasn't updated
- An internal link in a Markdown file points to a page that doesn't exist

Fix by either creating the missing page or updating the link. To build:

```bash
cd /path/to/lineup/docs && npx vitepress build
```

## Explain skill doesn't work

**Symptom:** Running `/lineup:explain` does nothing, produces an error, or runs the wrong workflow.

**Diagnosis:** The explain skill is an alias that runs `/lineup:kick-off explain`, which resolves to the built-in `explain` tactic. If any link in this chain is broken, the skill won't work.

**Solution:**

Check each part of the chain:

1. **Skill exists:** Verify your install reports healthy status with `lineup status --host claude`, and confirm canonical template `.lineup-core/skills/explain/core.md` exists in source.
2. **Tactic exists:** Verify `tactics/explain.yaml` is present in the plugin directory.
3. **No conflicting override:** If your project has `.lineup/tactics/explain.yaml`, the project version takes precedence over the built-in. Check that the project version is valid.
4. **Kick-off works:** Test with `/lineup:kick-off explain How does authentication work?` to bypass the explain skill and invoke the tactic directly.

If `/lineup:kick-off explain` works but `/lineup:explain` doesn't, the issue is in the skill alias definition for your current host install. Re-run `lineup update --host claude --version latest --yes`.

## Customizations lost after update

**Symptom:** Agent settings (model, tools, memory) reverted to defaults after
updating Lineup.

**Diagnosis:** Direct edits to generated plugin files are not persisted across
updates. The CLI refreshes generated host assets during update/install.

**Solution:**

Run `/lineup:configure` to re-apply your preferred settings. Customizations are
stored in `~/.claude/lineup/agents/` and survive future updates when managed
through overrides.

## Override file issues

**Symptom:** An agent is using unexpected settings despite your customization,
or the configurator shows a version mismatch warning.

**Diagnosis:** The override file in `~/.claude/lineup/agents/` may reference
settings from an older plugin version.

**Solution:**

1. Run `/lineup:configure` to review current effective settings.
2. The configurator marks overridden fields with `*` so you can see what's
   customized vs default.
3. Use **Reset** to clear all overrides and start fresh if needed.
4. You can also manually inspect or delete files in `~/.claude/lineup/agents/`.
