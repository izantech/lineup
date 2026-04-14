import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRunner, normalizeCodexOutputSchema, parseLocalAgentStructuredOutput } from "../src/lib/agent-runner.js";

describe("parseLocalAgentStructuredOutput", () => {
  let tempDir = "";
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
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
});
