import { describe, expect, it } from "vitest";

import { generatePassthroughConfig, generateTfConfig } from "../src/lib/tf-config.js";
import type { TfGeneratorContext } from "../src/lib/tf-config.js";
import type { WorkflowDefinition } from "../src/lib/types.js";

const workflow: WorkflowDefinition = {
  apiVersion: "lineup/v1",
  kind: "Workflow",
  name: "test-workflow",
  stages: [
    { id: "plan", type: "agent", agent: "architect" },
    { id: "dev", type: "agent", agent: "developer", depends_on: ["plan"] },
    { id: "review", type: "agent", agent: "reviewer", depends_on: ["dev"] }
  ]
};

const baseCtx: TfGeneratorContext = {
  workflow,
  projectRoot: "/projects/myapp",
  runId: "run-001",
  adaptersDir: "/tmp/adapters",
  promptsDir: "/tmp/prompts",
  host: "claude"
};

describe("generateTfConfig", () => {
  it("contains runner, planner, worker, and validator sections", () => {
    const config = generateTfConfig(baseCtx);
    expect(config).toMatch(/^runner:/m);
    expect(config).toMatch(/^planner:/m);
    expect(config).toMatch(/^worker:/m);
    expect(config).toMatch(/^validator:/m);
  });

  it("all adapter paths are absolute", () => {
    const config = generateTfConfig(baseCtx);
    const pathLines = config.match(/args: \[".+"\]/g) ?? [];
    for (const line of pathLines) {
      const match = line.match(/"([^"]+)"/);
      if (match) {
        expect(match[1]).toMatch(/^\//);
      }
    }
  });

  it("applies model overrides", () => {
    const ctx: TfGeneratorContext = {
      ...baseCtx,
      modelOverrides: { planner: "claude-opus-4-6", worker: "claude-haiku-4-5-20251001", validator: "claude-sonnet-4-6" }
    };
    const config = generateTfConfig(ctx);
    expect(config).toContain("claude-opus-4-6");
    expect(config).toContain("claude-haiku-4-5-20251001");
  });

  it("uses default concurrency of 4 and max_retries of 2", () => {
    const config = generateTfConfig(baseCtx);
    expect(config).toMatch(/max_retries: 2/);
    expect(config).toMatch(/concurrency: 4/);
  });

  it("respects custom concurrency and max_retries", () => {
    const ctx: TfGeneratorContext = { ...baseCtx, concurrency: 8, maxRetries: 5 };
    const config = generateTfConfig(ctx);
    expect(config).toMatch(/concurrency: 8/);
    expect(config).toMatch(/max_retries: 5/);
  });
});

describe("generatePassthroughConfig", () => {
  it("uses passthrough-planner.sh as the planner adapter path", () => {
    const config = generatePassthroughConfig(baseCtx, "/tmp/approved.yaml");
    expect(config).toContain("passthrough-planner.sh");
  });

  it("contains runner, planner, worker, and validator sections", () => {
    const config = generatePassthroughConfig(baseCtx, "/tmp/approved.yaml");
    expect(config).toMatch(/^runner:/m);
    expect(config).toMatch(/^planner:/m);
    expect(config).toMatch(/^worker:/m);
    expect(config).toMatch(/^validator:/m);
  });

  it("embeds APPROVED_MANIFEST_PATH in planner env", () => {
    const config = generatePassthroughConfig(baseCtx, "/tmp/approved.yaml");
    expect(config).toContain("APPROVED_MANIFEST_PATH");
  });

  it("uses default concurrency of 4 and max_retries of 2", () => {
    const config = generatePassthroughConfig(baseCtx, "/tmp/approved.yaml");
    expect(config).toMatch(/max_retries: 2/);
    expect(config).toMatch(/concurrency: 4/);
  });
});
