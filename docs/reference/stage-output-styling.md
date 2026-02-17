# Stage Output Styling

This is the reference for how pipeline stage outputs are displayed in example pages. When writing a new example, use these conventions so that stage outputs render consistently with left-border accents, monospace titles, and color-coded PASS/FAIL indicators.

## Container mapping

Each type of pipeline output maps to a specific VitePress container:

| Output type | Container | Why |
| ----------- | --------- | --- |
| Research findings | `:::info` | Neutral/informational -- presents facts without a value judgment |
| Plan proposals | `:::tip` | Positive/constructive -- proposes what will be done |
| Implementation reports | `:::details` | Collapsible -- implementation details are verbose and often skimmed |
| Verification (PASS) | `:::tip` | Green accent reinforces success |
| Verification (FAIL) | `:::danger` | Red accent signals failure |
| Approval gates | `:::warning` | Yellow accent draws attention to a required user decision |
| Variable prompts | `:::warning` | Same as approval gates -- the pipeline is paused waiting for input |
| User input | `:::info` | Shows what the user typed, presented as neutral information |
| Documentation reports | `:::details` | Collapsible, same rationale as implementation reports |

## Container title format

Every container title follows the pattern `Stage N/M -- Stage Name`:

```md
:::info Stage 1/4 -- Research
```

For optional stages, append `(optional)`:

```md
:::warning Stage 1/5 -- Research (optional)
```

Approval gates and variable prompts use a descriptive title instead:

```md
:::warning Approval Gate
:::warning Variable Input Required
```

## Formatting rules

Content inside containers follows these conventions:

1. **Start at column 0.** No indentation for the first level of content inside the container.

2. **Empty line after the title.** The VitePress container syntax requires a blank line between the opening `:::type Title` line and the body content.

3. **Bold for PASS/FAIL.** Use `**PASS**` and `**FAIL**` for verification results. Inside `:::tip` containers, bold text renders in green; inside `:::danger` containers, bold text renders in red.

4. **Inline code for paths.** File paths, commands, and code references use backtick inline code: `` `src/routes/health.ts` ``.

5. **Bullet lists for findings.** Research findings and implementation reports use unordered lists (`-`) with sub-items indented two spaces.

6. **Tables for structured data.** Use Markdown tables when presenting tabular data like vulnerability lists or coverage metrics.

7. **No code fences inside containers.** Do not nest `` ``` `` code blocks inside containers. Use inline code for short references and bullet lists for longer output.

## Examples

### Research output

Before (plain text block):

````md
```text
Research complete. Key findings:
- Routes defined in src/routes/*.ts
- Validation uses Zod schemas in src/schemas/
- Tests use Vitest with supertest
```
````

After (info container):

```md
:::info Stage 1/4 -- Research

Research complete. Key findings:

- Routes defined in `src/routes/*.ts`
- Validation uses Zod schemas in `src/schemas/`
- Tests use Vitest with supertest

:::
```

### Verification (PASS)

Before:

````md
```text
Build: PASS
Tests: 22 run, 22 passed, 0 failed
Status: PASS
```
````

After:

```md
:::tip Stage 4/4 -- Verify

Verification report:

- Build: **PASS**
- Tests: 22 run, 22 passed, 0 failed
- Status: **PASS**

:::
```

### Verification (FAIL)

A failing verification uses `:::danger` instead of `:::tip`:

```md
:::danger Stage 4/4 -- Verify

Verification report:

- Build: **PASS**
- Tests: 22 run, 19 passed, 3 failed
  - `src/routes/__tests__/auth.test.ts`: 2 failures
  - `src/services/__tests__/token.test.ts`: 1 failure
- Status: **FAIL**

:::
```

## CSS overview

The custom styles in `.vitepress/theme/custom.css` apply three visual enhancements to the default VitePress containers:

| Enhancement | What it does |
| ----------- | ------------ |
| Left-border accent | Adds a 4px colored left border to all container types, with colors matching each type's semantic meaning (blue for info, green for tip, yellow for warning, red for danger, gray for details) |
| Monospace uppercase titles | Renders the `.custom-block-title` in monospace font at 13px with `text-transform: uppercase`, giving stage headers a terminal-like appearance |
| PASS/FAIL color indicators | Bold text inside `:::tip` containers renders in green (`--vp-c-success-1`); bold text inside `:::danger` containers renders in red (`--vp-c-danger-1`) |

These overrides affect all containers site-wide, but they are designed with example pages in mind. The left-border and monospace titles also improve readability of containers used in guide and concept pages.
