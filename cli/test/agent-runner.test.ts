import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRunner, normalizeCodexOutputSchema, parseLocalAgentStructuredOutput } from "../src/lib/agent-runner.js";

function writeFakeHostScript(filePath: string, content: string): void {
  writeFileSync(filePath, content, "utf8");
  chmodSync(filePath, 0o755);
}

describe("parseLocalAgentStructuredOutput", () => {
  let tempDir = "";
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("unwraps Claude YAML result envelopes that contain fenced JSON", () => {
    const raw = `type: result
subtype: success
result: >-
  \`\`\`json

  {
    "summary": "Add a second sentence to README.md.",
    "changes": [
      {
        "file": "README.md",
        "action": "append sentence",
        "reason": "Document the app"
      }
    ]
  }

  \`\`\`
`;

    expect(parseLocalAgentStructuredOutput(raw)).toEqual({
      summary: "Add a second sentence to README.md.",
      changes: [
        {
          file: "README.md",
          action: "append sentence",
          reason: "Document the app"
        }
      ]
    });
  });

  it("unwraps Claude JSON result envelopes that contain fenced JSON", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "```json\n{\"summary\":\"Add README text\",\"changes\":[{\"file\":\"README.md\",\"action\":\"append sentence\",\"reason\":\"Document the app\"}]}\n```"
    });

    expect(parseLocalAgentStructuredOutput(raw)).toEqual({
      summary: "Add README text",
      changes: [
        {
          file: "README.md",
          action: "append sentence",
          reason: "Document the app"
        }
      ]
    });
  });

  it("unwraps OpenCode JSON event streams that end with a structured text payload", () => {
    const raw = [
      JSON.stringify({
        type: "step_start",
        part: { type: "step-start" }
      }),
      JSON.stringify({
        type: "tool_use",
        part: { type: "tool", tool: "read" }
      }),
      JSON.stringify({
        type: "text",
        part: {
          type: "text",
          text: `what_found:
  key_files:
    - path: README.md
      description: Tiny smoke repo
how_it_works: Reads the bounded smoke files.
constraints: {}
gaps: {}
`
        }
      })
    ].join("\n");

    expect(parseLocalAgentStructuredOutput(raw)).toEqual({
      what_found: {
        key_files: [
          {
            path: "README.md",
            description: "Tiny smoke repo"
          }
        ]
      },
      how_it_works: "Reads the bounded smoke files.",
      constraints: {},
      gaps: {}
    });
  });

  it("skips permissive schemas for Codex structured output mode", () => {
    const rawSchema = JSON.stringify({
      type: "object",
      additionalProperties: true,
      properties: {
        summary: { type: "string" }
      }
    });

    expect(normalizeCodexOutputSchema(rawSchema)).toBeNull();
  });

  it("keeps strict schemas for Codex structured output mode", () => {
    const rawSchema = JSON.stringify({
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" }
      }
    });

    expect(normalizeCodexOutputSchema(rawSchema)).toBe(rawSchema);
  });

  it("adds explicit types to const-only properties for Codex structured output mode", () => {
    const rawSchema = JSON.stringify({
      type: "object",
      additionalProperties: false,
      properties: {
        apiVersion: { const: "lineup/v3" },
        kind: { const: "Plan" },
        attempts: { const: 1 },
        dryRun: { const: false },
        metadata: {
          type: "object",
          additionalProperties: false,
          properties: {
            labels: { const: ["alpha"] }
          }
        }
      }
    });

    expect(JSON.parse(normalizeCodexOutputSchema(rawSchema) ?? "null")).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        apiVersion: { type: "string", const: "lineup/v3" },
        kind: { type: "string", const: "Plan" },
        attempts: { type: "integer", const: 1 },
        dryRun: { type: "boolean", const: false },
        metadata: {
          type: "object",
          additionalProperties: false,
          properties: {
            labels: { type: "array", const: ["alpha"] }
          }
        }
      }
    });
  });

  it("returns as soon as Codex writes the expected artifact file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-codex-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeCodexPath = join(binDir, "codex");
    writeFileSync(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

let output = ''
const promptParts = []
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (arg === '-o') {
    output = process.argv[index + 1] ?? ''
    index += 1
    continue
  }
  promptParts.push(arg)
}

const prompt = promptParts.join(' ')
const match = prompt.match(/Create or overwrite (\\S+) with the final structured payload\\./)
if (match) {
  writeFileSync(match[1], \`type: research
agent: researcher
date: 2026-04-14
topic: test
status: complete
pipeline_stage: 2
how_it_works: artifact was written before codex exited
\`)
}
if (output) {
  writeFileSync(output, 'placeholder\\n')
}

process.on('SIGTERM', () => process.exit(0))
setTimeout(() => process.exit(0), 5_000)
`,
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("codex");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const startedAt = Date.now();
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      timeoutMs: 2_000
    });

    expect(Date.now() - startedAt).toBeLessThan(4_500);
    expect(result.content).toContain("how_it_works: artifact was written before codex exited");
  });

  it("returns as soon as Codex writes its direct output file even when the stage artifact is never written", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-codex-direct-output-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeCodexPath = join(binDir, "codex");
    writeFileSync(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

let output = ''
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (arg === '-o') {
    output = process.argv[index + 1] ?? ''
    index += 1
  }
}

if (output) {
  writeFileSync(output, \`type: research
agent: researcher
date: 2026-04-14
topic: test
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: codex wrote its direct output file before shutdown
constraints:
  host: codex
gaps:
  pending: []
\`)
}

process.on('SIGTERM', () => {})
setTimeout(() => process.exit(0), 10_000)
`,
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("codex");
    const startedAt = Date.now();
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: "Return a valid research artifact.",
      timeoutMs: 3_000
    });

    expect(Date.now() - startedAt).toBeLessThan(2_500);
    expect(result.content).toContain("how_it_works: codex wrote its direct output file before shutdown");
  });

  it("does not wait for Codex shutdown once the expected artifact file exists", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-codex-fast-return-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeCodexPath = join(binDir, "codex");
    writeFileSync(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

let output = ''
const promptParts = []
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (arg === '-o') {
    output = process.argv[index + 1] ?? ''
    index += 1
    continue
  }
  promptParts.push(arg)
}

const prompt = promptParts.join(' ')
const match = prompt.match(/Create or overwrite (\\S+) with the final structured payload\\./)
if (match) {
  writeFileSync(match[1], \`type: research
agent: researcher
date: 2026-04-14
topic: test
status: complete
pipeline_stage: 2
how_it_works: artifact was written before codex shutdown
\`)
}
if (output) {
  writeFileSync(output, 'placeholder\\n')
}

process.on('SIGTERM', () => {})
setTimeout(() => process.exit(0), 10_000)
`,
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("codex");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const startedAt = Date.now();
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      timeoutMs: 3_000
    });

    expect(Date.now() - startedAt).toBeLessThan(2_500);
    expect(result.content).toContain("how_it_works: artifact was written before codex shutdown");
  });

  it("writes a lifecycle trace file for local host invocations", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-trace-file-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeCodexPath = join(binDir, "codex");
    writeFakeHostScript(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

const prompt = process.argv.slice(2).join(' ')
const match = prompt.match(/Create or overwrite (\\S+) with the final structured payload\\./)
if (match) {
  writeFileSync(match[1], \`type: research
agent: researcher
date: 2026-04-14
topic: trace
status: complete
pipeline_stage: 2
how_it_works: trace file emitted during invocation
\`)
}

setTimeout(() => process.exit(0), 100)
`
    );

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("codex");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const tracePrefixPath = join(tempDir, "host", "research-codex");
    await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      timeoutMs: 2_000,
      tracePrefixPath
    });

    const trace = JSON.parse(readFileSync(`${tracePrefixPath}.trace.json`, "utf8")) as {
      command: string;
      completionReason: string;
      events: Array<{ type: string }>;
    };
    expect(trace.command).toBe("codex");
    expect(["expected_output", "exit"]).toContain(trace.completionReason);
    expect(trace.events.some((event) => event.type === "spawn")).toBe(true);
    expect(trace.events.some((event) => event.type === "close" || event.type === "artifact_detected")).toBe(true);
  });

  it("routes Codex agent stages to the configured Ollama model in full mode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-codex-ollama-model-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(tempDir, ".lineup"), { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup", "config.yaml"),
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: full\n`,
      "utf8"
    );

    const fakeCodexPath = join(binDir, "codex");
    writeFileSync(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

let output = ''
let model = ''
const promptParts = []
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (arg === '-o') {
    output = process.argv[index + 1] ?? ''
    index += 1
    continue
  }
  if (arg === '-m') {
    model = process.argv[index + 1] ?? ''
    index += 1
    continue
  }
  promptParts.push(arg)
}

const prompt = promptParts.join(' ')
const match = prompt.match(/Create or overwrite (\\S+) with the final structured payload\\./)
if (match) {
  writeFileSync(match[1], \`type: research
agent: researcher
date: 2026-04-14
topic: test
status: complete
pipeline_stage: 2
how_it_works: model=\${model}
\`)
}
if (output) {
  writeFileSync(output, 'placeholder\\n')
}
process.exit(0)
`,
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("codex");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      timeoutMs: 3_000
    });

    expect(result.content).toContain("how_it_works: model=local-qwen");
  });

  it("resolves Codex managed Ollama runs when the artifact appears before process exit", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-codex-ollama-managed-"));
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(homeDir, ".codex", "lineup"), { recursive: true });
    writeFileSync(
      join(homeDir, ".codex", "lineup", "ollama.yaml"),
      `enabled: true
model: local-qwen
scope: research
baseUrl: http://127.0.0.1:11434/v1
host_integration:
  enabled: true
  strategy: managed
`,
      "utf8"
    );

    const fakeCodexPath = join(binDir, "codex");
    writeFileSync(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

let output = ''
let prompt = ''
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (arg === '-o') {
    output = process.argv[index + 1] ?? ''
    index += 1
    continue
  }
  prompt += \`\${arg} \`
}

const match = prompt.match(/Create or overwrite (\\S+) with the final structured payload\\./)
const content = \`type: research
agent: researcher
date: 2026-04-14
topic: test
status: complete
pipeline_stage: research
how_it_works: managed profile wrote the artifact before codex shutdown
\`
if (output) {
  writeFileSync(output, content)
}
if (match) {
  writeFileSync(match[1], content)
}
process.on('SIGTERM', () => {})
setTimeout(() => process.exit(0), 10_000)
`,
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("codex");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const startedAt = Date.now();
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      timeoutMs: 3_000
    });

    expect(Date.now() - startedAt).toBeLessThan(2_500);
    expect(result.content).toContain("managed profile wrote the artifact before codex shutdown");
    expect(readFileSync(join(homeDir, ".codex", "config.toml"), "utf8")).toContain("[profiles.lineup-ollama]");
  });

  it("returns as soon as Claude writes the expected artifact file even if the process lingers", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-claude-fast-return-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeClaudePath = join(binDir, "claude");
    writeFakeHostScript(
      fakeClaudePath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

writeFileSync('research.yaml', \`summary: Claude wrote the artifact first
status: complete
how_it_works: the runner returned before this process exited
\`)

const linger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
  detached: true,
  stdio: 'ignore'
})
linger.unref()
process.exit(0)
`
    );

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("claude");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const startedAt = Date.now();
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      timeoutMs: 2_000
    });

    expect(Date.now() - startedAt).toBeLessThan(2_500);
    expect(result.content).toContain("how_it_works: the runner returned before this process exited");
  });

  it("uses the provided working directory for Ollama-backed Claude launches", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-claude-neutral-cwd-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(tempDir, ".lineup"), { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup", "config.yaml"),
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`,
      "utf8"
    );

    const cwdFile = join(tempDir, "captured-cwd.txt");
    const fakeOllamaPath = join(binDir, "ollama");
    writeFakeHostScript(
      fakeOllamaPath,
      `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const commandArgs = process.argv.slice(2)
const separatorIndex = commandArgs.indexOf('--')
const childArgs = separatorIndex >= 0 ? commandArgs.slice(separatorIndex + 1) : []
const child = spawnSync('claude', childArgs, {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env
})

if (child.stdout) {
  process.stdout.write(child.stdout)
}
if (child.stderr) {
  process.stderr.write(child.stderr)
}
process.exit(child.status ?? 0)
`
    );

    const fakeClaudePath = join(binDir, "claude");
    writeFakeHostScript(
      fakeClaudePath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

const cwdFile = process.env.LINEUP_TEST_CWD_FILE
if (cwdFile) {
  writeFileSync(cwdFile, process.cwd(), 'utf8')
}

const promptParts = process.argv.slice(2).join(' ')
const match = promptParts.match(/Create or overwrite (\\S+) with the final structured payload\\./)
if (match) {
  writeFileSync(match[1], \`type: research
agent: researcher
date: 2026-04-14
topic: neutral-cwd
status: complete
pipeline_stage: research
how_it_works: Claude ran from the requested working directory
\`)
}

process.exit(0)
`
    );

    const originalPath = process.env.PATH;
    const originalCwdFile = process.env.LINEUP_TEST_CWD_FILE;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    process.env.LINEUP_TEST_CWD_FILE = cwdFile;

    try {
      const runner = createLocalAgentRunner("claude");
      const expectedOutputPath = join(tempDir, "research.yaml");
      const result = await runner.invoke({
        projectRoot: tempDir,
        workingDirectory: tempDir,
        agent: "researcher",
        prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
        expectedOutputPath,
        timeoutMs: 2_000
      });

      expect(result.content).toContain("how_it_works: Claude ran from the requested working directory");
      const capturedCwd = readFileSync(cwdFile, "utf8");
      expect(capturedCwd).toBe(realpathSync(tempDir));
    } finally {
      process.env.PATH = originalPath;
      process.env.LINEUP_TEST_CWD_FILE = originalCwdFile;
    }
  });

  it("returns as soon as OpenCode writes the expected artifact file even if a background process lingers", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-opencode-fast-return-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeOpencodePath = join(binDir, "opencode");
    writeFakeHostScript(
      fakeOpencodePath,
      `#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

writeFileSync('research.yaml', \`summary: OpenCode wrote the artifact first
status: complete
how_it_works: a background process lingered after the main command exited
\`)

const linger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
  detached: true,
  stdio: 'ignore'
})
linger.unref()
`
    );

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("opencode");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const startedAt = Date.now();
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      timeoutMs: 2_000
    });

    expect(Date.now() - startedAt).toBeLessThan(2_500);
    expect(result.content).toContain("how_it_works: a background process lingered after the main command exited");
  });

  it("unwraps OpenCode JSON event streams into the final text payload when no artifact file is written", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-opencode-json-stream-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeOpencodePath = join(binDir, "opencode");
    writeFakeHostScript(
      fakeOpencodePath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'text', part: { type: 'text', text: 'what_found:\\n  key_files:\\n    - path: README.md\\n      description: Tiny smoke repo\\nhow_it_works: Reads the smoke repo.\\nconstraints: {}\\ngaps: {}\\n' } }) + '\\n')
`
    );

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const runner = createLocalAgentRunner("opencode");
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: "Inspect the tiny smoke repo.",
      timeoutMs: 2_000
    });

    expect(result.content).toContain("what_found:");
    expect(result.content).toContain("how_it_works: Reads the smoke repo.");
  });

  it("falls back from a stalled Claude strict pass to a valid structured rewrite", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-claude-fallback-"));
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const fakeClaudePath = join(binDir, "claude");
    writeFakeHostScript(
      fakeClaudePath,
      `#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs'

const markerPath = './.claude-fallback-marker'
if (existsSync(markerPath)) {
  process.stdout.write(JSON.stringify({
    summary: 'Claude reformatted the draft',
    changes: [{ file: 'README.md', action: 'append sentence', reason: 'Strict fallback produced valid JSON' }]
  }))
  process.exit(0)
}

writeFileSync(markerPath, '1')

writeFileSync('research.yaml', 'summary: malformed draft from Claude\\nchanges: [\\n  file: README.md\\n  action: append sentence\\n')

process.stdout.write('type: result\\nsubtype: success\\nresult: not valid json\\n')
process.exit(0)
`
    );

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const schemaPath = join(tempDir, "output.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify(
        {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            changes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  file: { type: "string" },
                  action: { type: "string" },
                  reason: { type: "string" }
                },
                required: ["file", "action", "reason"]
              }
            }
          },
          required: ["summary", "changes"]
        },
        null,
        2
      ),
      "utf8"
    );

    const runner = createLocalAgentRunner("claude");
    const expectedOutputPath = join(tempDir, "research.yaml");
    const result = await runner.invoke({
      projectRoot: tempDir,
      workingDirectory: tempDir,
      agent: "researcher",
      prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
      expectedOutputPath,
      outputSchemaPath: schemaPath,
      timeoutMs: 2_000
    });

    expect(JSON.parse(result.content)).toEqual({
      summary: "Claude reformatted the draft",
      changes: [
        {
          file: "README.md",
          action: "append sentence",
          reason: "Strict fallback produced valid JSON"
        }
      ]
    });
  });

  it("uses the draft artifact directly for Ollama-backed Claude structured output runs when it is already parseable", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-claude-ollama-draft-first-"));
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(tempDir, ".lineup"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup", "config.yaml"),
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`,
      "utf8"
    );

    const promptLog = join(tempDir, "claude-prompts.log");
    const fakeClaudePath = join(binDir, "claude");
    writeFakeHostScript(
      fakeClaudePath,
      `#!/usr/bin/env node
import { existsSync, appendFileSync, writeFileSync } from 'node:fs'

const prompt = process.argv.slice(2).join(' ')
const hasJsonOutputFormat = process.argv.includes('--output-format') && process.argv.includes('json')
const logPath = process.env.LINEUP_TEST_PROMPT_LOG
if (logPath) {
  appendFileSync(logPath, \`PROMPT: \${prompt}\\nOUTPUT_FORMAT_JSON: \${hasJsonOutputFormat}\\n\`)
}

const markerPath = process.env.HOME ? \`\${process.env.HOME}/.claude-ollama-draft-first\` : '.claude-ollama-draft-first'

if (!existsSync(markerPath)) {
  if (!hasJsonOutputFormat) {
    process.stderr.write('draft pass should use JSON output mode\\n')
    process.exit(1)
  }

  writeFileSync(markerPath, '1')
  const match = prompt.match(/Create or overwrite (\\S+) with the final structured payload\\./)
  if (match) {
    writeFileSync(match[1], \`summary: draft first
changes:
  - file: README.md
    action: append sentence
    reason: Draft content was captured before strict formatting
\`)
  }
  process.exit(0)
}

process.stderr.write('strict formatter should not be used when the draft artifact is already parseable\\n')
process.exit(1)
`
    );

    const fakeOllamaPath = join(binDir, "ollama");
    writeFakeHostScript(
      fakeOllamaPath,
      `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const separatorIndex = args.indexOf('--')
const childArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : []
const child = spawnSync('claude', childArgs, {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env
})

if (child.stdout) {
  process.stdout.write(child.stdout)
}
if (child.stderr) {
  process.stderr.write(child.stderr)
}
process.exit(child.status ?? 0)
`
    );

    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalPromptLog = process.env.LINEUP_TEST_PROMPT_LOG;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.LINEUP_TEST_PROMPT_LOG = promptLog;

    try {
      const runner = createLocalAgentRunner("claude");
      const expectedOutputPath = join(tempDir, "research.yaml");
      const schemaPath = join(tempDir, "output.schema.json");
      writeFileSync(
        schemaPath,
        JSON.stringify(
          {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    file: { type: "string" },
                    action: { type: "string" },
                    reason: { type: "string" }
                  },
                  required: ["file", "action", "reason"]
                }
              }
            },
            required: ["summary", "changes"]
          },
          null,
          2
        ),
        "utf8"
      );

      const result = await runner.invoke({
        projectRoot: tempDir,
        workingDirectory: tempDir,
        agent: "researcher",
        prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
        expectedOutputPath,
        outputSchemaPath: schemaPath,
        timeoutMs: 2_000
      });

      expect(JSON.parse(result.content)).toEqual({
        summary: "draft first",
        changes: [
          {
            file: "README.md",
            action: "append sentence",
            reason: "Draft content was captured before strict formatting"
          }
        ]
      });

      const prompts = readFileSync(promptLog, "utf8");
      expect(prompts).toContain("Create or overwrite");
      expect(prompts.indexOf("Create or overwrite")).toBeGreaterThanOrEqual(0);
      expect(prompts).not.toContain("Convert the following draft into a JSON value that matches the provided schema.");
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      process.env.LINEUP_TEST_PROMPT_LOG = originalPromptLog;
    }
  });

  it("uses text draft mode for Ollama-backed Claude architect runs before local normalization", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-claude-ollama-architect-draft-"));
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(tempDir, ".lineup"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup", "config.yaml"),
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`,
      "utf8"
    );

    const promptLog = join(tempDir, "claude-prompts.log");
    const fakeClaudePath = join(binDir, "claude");
    writeFakeHostScript(
      fakeClaudePath,
      `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'

const prompt = process.argv.slice(2).join(' ')
const hasJsonOutputFormat = process.argv.includes('--output-format') && process.argv.includes('json')
const logPath = process.env.LINEUP_TEST_PROMPT_LOG
if (logPath) {
  appendFileSync(logPath, \`PROMPT: \${prompt}\\nOUTPUT_FORMAT_JSON: \${hasJsonOutputFormat}\\n\`)
}

if (hasJsonOutputFormat) {
  process.stderr.write('architect draft pass should use text output mode\\n')
  process.exit(1)
}

const match = prompt.match(/Create or overwrite (\\S+) with the final structured payload\\./)
if (match) {
  writeFileSync(match[1], \`summary: Architect draft
approaches:
  - name: Minimal
    description: Update README.md only
recommendation: Minimal
changes:
  - file: README.md
    change: Replace the placeholder
    rationale: Required by the smoke task
acceptance_criteria:
  - README updated
risks:
  - Small repo task might overfit the plan
\`)
}
process.exit(0)
`
    );

    const fakeOllamaPath = join(binDir, "ollama");
    writeFakeHostScript(
      fakeOllamaPath,
      `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const separatorIndex = args.indexOf('--')
const childArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : []
const child = spawnSync('claude', childArgs, {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env
})

if (child.stdout) {
  process.stdout.write(child.stdout)
}
if (child.stderr) {
  process.stderr.write(child.stderr)
}
process.exit(child.status ?? 0)
`
    );

    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalPromptLog = process.env.LINEUP_TEST_PROMPT_LOG;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.LINEUP_TEST_PROMPT_LOG = promptLog;

    try {
      const runner = createLocalAgentRunner("claude");
      const expectedOutputPath = join(tempDir, "plan.yaml");
      const schemaPath = join(tempDir, "output.schema.json");
      writeFileSync(
        schemaPath,
        JSON.stringify(
          {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    file: { type: "string" },
                    change: { type: "string" },
                    rationale: { type: "string" }
                  },
                  required: ["file", "change", "rationale"]
                }
              }
            },
            required: ["summary", "changes"]
          },
          null,
          2
        ),
        "utf8"
      );

      const result = await runner.invoke({
        projectRoot: tempDir,
        workingDirectory: tempDir,
        agent: "architect",
        prompt: `Create or overwrite ${expectedOutputPath} with the final structured payload.`,
        expectedOutputPath,
        outputSchemaPath: schemaPath,
        timeoutMs: 2_000
      });

      expect(JSON.parse(result.content)).toEqual({
        summary: "Architect draft",
        approaches: [
          {
            name: "Minimal",
            description: "Update README.md only"
          }
        ],
        recommendation: "Minimal",
        changes: [
          {
            file: "README.md",
            change: "Replace the placeholder",
            rationale: "Required by the smoke task"
          }
        ],
        acceptance_criteria: ["README updated"],
        risks: ["Small repo task might overfit the plan"]
      });

      const prompts = readFileSync(promptLog, "utf8");
      expect(prompts).toContain("OUTPUT_FORMAT_JSON: false");
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      process.env.LINEUP_TEST_PROMPT_LOG = originalPromptLog;
    }
  });

  it("uses JSON draft mode for Ollama-backed Claude developer runs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-claude-ollama-developer-draft-"));
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(tempDir, ".lineup"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup", "config.yaml"),
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`,
      "utf8"
    );

    const promptLog = join(tempDir, "claude-prompts.log");
    const fakeClaudePath = join(binDir, "claude");
    writeFakeHostScript(
      fakeClaudePath,
      `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'

const prompt = process.argv.slice(2).join(' ')
const hasJsonOutputFormat = process.argv.includes('--output-format') && process.argv.includes('json')
const logPath = process.env.LINEUP_TEST_PROMPT_LOG
if (logPath) {
  appendFileSync(logPath, \`PROMPT: \${prompt}\\nOUTPUT_FORMAT_JSON: \${hasJsonOutputFormat}\\n\`)
}

if (!hasJsonOutputFormat) {
  process.stderr.write('developer draft pass should use json output mode\\n')
  process.exit(1)
}

process.stdout.write(JSON.stringify({
  status: 'complete',
  summary: 'Updated README.md in the smoke repo.',
  changes_made: [
    {
      file: 'README.md',
      description: 'Replaced the smoke placeholder with the validation sentence.',
      task_id: 'CHANGE-001'
    }
  ],
  issues_encountered: []
}))
`
    );

    const fakeOllamaPath = join(binDir, "ollama");
    writeFakeHostScript(
      fakeOllamaPath,
      `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const separatorIndex = args.indexOf('--')
const childArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : []
const child = spawnSync('claude', childArgs, {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env
})

if (child.stdout) {
  process.stdout.write(child.stdout)
}
if (child.stderr) {
  process.stderr.write(child.stderr)
}
process.exit(child.status ?? 0)
`
    );

    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalPromptLog = process.env.LINEUP_TEST_PROMPT_LOG;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.LINEUP_TEST_PROMPT_LOG = promptLog;

    try {
      const runner = createLocalAgentRunner("claude");
      const schemaPath = join(tempDir, "implementation-output.schema.json");
      writeFileSync(
        schemaPath,
        JSON.stringify(
          {
            type: "object",
            additionalProperties: false,
            properties: {
              status: { type: "string" },
              summary: { type: "string" },
              changes_made: { type: "array" },
              issues_encountered: { type: "array" }
            },
            required: ["status", "summary", "changes_made", "issues_encountered"]
          },
          null,
          2
        ),
        "utf8"
      );

      const result = await runner.invoke({
        projectRoot: tempDir,
        workingDirectory: tempDir,
        agent: "developer",
        prompt: "Return the implementation result as structured JSON only.",
        outputSchemaPath: schemaPath,
        timeoutMs: 2_000
      });

      expect(JSON.parse(result.content)).toEqual({
        status: "complete",
        summary: "Updated README.md in the smoke repo.",
        changes_made: [
          {
            file: "README.md",
            description: "Replaced the smoke placeholder with the validation sentence.",
            task_id: "CHANGE-001"
          }
        ],
        issues_encountered: []
      });

      const prompts = readFileSync(promptLog, "utf8");
      expect(prompts).toContain("OUTPUT_FORMAT_JSON: true");
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      process.env.LINEUP_TEST_PROMPT_LOG = originalPromptLog;
    }
  });

  it("falls back to the Claude env transport when the Ollama wrapper exits without output", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-claude-ollama-empty-wrapper-"));
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(tempDir, ".lineup"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      join(tempDir, ".lineup", "config.yaml"),
      `ollama:\n  enabled: true\n  model: qwen3-coder:30b\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: launch\n`,
      "utf8"
    );

    const fakeClaudePath = join(binDir, "claude");
    writeFakeHostScript(
      fakeClaudePath,
      `#!/usr/bin/env node
if (process.env.ANTHROPIC_AUTH_TOKEN === 'ollama') {
  process.stdout.write('hi\\n')
}
process.exit(0)
`
    );

    const fakeOllamaPath = join(binDir, "ollama");
    writeFakeHostScript(
      fakeOllamaPath,
      `#!/usr/bin/env node
process.exit(0)
`
    );

    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
      const runner = createLocalAgentRunner("claude");
      const result = await runner.invoke({
        projectRoot: tempDir,
        workingDirectory: tempDir,
        agent: "researcher",
        prompt: "Reply with just hi",
        timeoutMs: 2_000
      });

      expect(result.content.trim()).toBe("hi");
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    }
  });
});
