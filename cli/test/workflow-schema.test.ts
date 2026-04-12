import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { parseWorkflowYaml } from "../src/lib/validation.js";

describe("parseWorkflowYaml", () => {
  it("parses a valid minimal workflow", () => {
    const yaml = `
apiVersion: lineup/v3
kind: Workflow
name: test-workflow
stages:
  - id: triage
    type: builtin
    description: "Classify task"
`;
    const result = parseWorkflowYaml(yaml, "test");
    expect(result.name).toBe("test-workflow");
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].type).toBe("builtin");
  });

  it("parses the canonical v3 workflow with conditional approach hints", () => {
    const workflowPath = fileURLToPath(new URL("../../.lineup-core/workflows/full-pipeline.yaml", import.meta.url));
    const yaml = readFileSync(workflowPath, "utf8");
    const result = parseWorkflowYaml(yaml, workflowPath);

    expect(result.apiVersion).toBe("lineup/v3");
    expect((result.stages.find((stage) => stage.id === "plan") as { conditional_approach?: unknown } | undefined)?.conditional_approach).toBeDefined();
    expect(result.stages.find((stage) => stage.id === "document")?.outputs).toBeDefined();
  });

  it("rejects missing apiVersion", () => {
    const yaml = `
kind: Workflow
name: test
stages:
  - id: a
    type: builtin
`;
    expect(() => parseWorkflowYaml(yaml, "test")).toThrow();
  });

  it("rejects unknown stage type", () => {
    const yaml = `
apiVersion: lineup/v3
kind: Workflow
name: test
stages:
  - id: a
    type: unknown
`;
    expect(() => parseWorkflowYaml(yaml, "test")).toThrow();
  });

  it("requires agent field for agent stage type", () => {
    const yaml = `
apiVersion: lineup/v3
kind: Workflow
name: test
stages:
  - id: a
    type: agent
    description: "no agent specified"
`;
    expect(() => parseWorkflowYaml(yaml, "test")).toThrow();
  });

  it("parses a workflow with all stage types", () => {
    const yaml = `
apiVersion: lineup/v3
kind: Workflow
name: full-test
stages:
  - id: triage
    type: builtin
  - id: clarify
    type: reasoning
    depends_on: [triage]
  - id: research
    type: agent
    agent: researcher
    depends_on: [triage]
  - id: approve
    type: approval
    depends_on: [research]
`;
    const result = parseWorkflowYaml(yaml, "test");
    expect(result.stages).toHaveLength(4);
  });
});
