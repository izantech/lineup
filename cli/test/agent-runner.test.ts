import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});
