import { describe, expect, it } from "vitest";

import { resolveExecutionOrder, validateWorkflowDag } from "../src/lib/workflow.js";
import type { WorkflowDefinition } from "../src/lib/types.js";

function makeWorkflow(stages: WorkflowDefinition["stages"]): WorkflowDefinition {
  return {
    apiVersion: "lineup/v1",
    kind: "Workflow",
    name: "test",
    stages
  };
}

describe("validateWorkflowDag", () => {
  it("accepts a valid linear DAG", () => {
    const workflow = makeWorkflow([
      { id: "a", type: "builtin" },
      { id: "b", type: "builtin", depends_on: ["a"] },
      { id: "c", type: "builtin", depends_on: ["b"] }
    ]);
    expect(() => validateWorkflowDag(workflow)).not.toThrow();
  });

  it("throws on dangling depends_on reference", () => {
    const workflow = makeWorkflow([
      { id: "a", type: "builtin" },
      { id: "b", type: "builtin", depends_on: ["nonexistent"] }
    ]);
    expect(() => validateWorkflowDag(workflow)).toThrow(/unknown stage/);
  });

  it("throws on cycle", () => {
    const workflow = makeWorkflow([
      { id: "a", type: "builtin", depends_on: ["b"] },
      { id: "b", type: "builtin", depends_on: ["a"] }
    ]);
    expect(() => validateWorkflowDag(workflow)).toThrow(/cycle/);
  });

  it("throws on input source referencing non-existent stage", () => {
    const workflow = makeWorkflow([
      {
        id: "a",
        type: "builtin",
        inputs: [{ source: "ghost", fields: ["x"] }]
      }
    ]);
    expect(() => validateWorkflowDag(workflow)).toThrow(/unknown input source/);
  });

  it("accepts root stages with empty depends_on", () => {
    const workflow = makeWorkflow([
      { id: "a", type: "builtin", depends_on: [] },
      { id: "b", type: "builtin", depends_on: [] }
    ]);
    expect(() => validateWorkflowDag(workflow)).not.toThrow();
  });
});

describe("resolveExecutionOrder", () => {
  it("resolves a linear DAG to 3 waves", () => {
    const workflow = makeWorkflow([
      { id: "a", type: "builtin" },
      { id: "b", type: "builtin", depends_on: ["a"] },
      { id: "c", type: "builtin", depends_on: ["b"] }
    ]);
    const waves = resolveExecutionOrder(workflow);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toContain("a");
    expect(waves[1]).toContain("b");
    expect(waves[2]).toContain("c");
  });

  it("resolves parallel stages correctly (diamond pattern)", () => {
    const workflow = makeWorkflow([
      { id: "a", type: "builtin" },
      { id: "b", type: "builtin", depends_on: ["a"] },
      { id: "c", type: "builtin", depends_on: ["a"] },
      { id: "d", type: "builtin", depends_on: ["b", "c"] }
    ]);
    const waves = resolveExecutionOrder(workflow);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toContain("a");
    expect(waves[1]).toContain("b");
    expect(waves[1]).toContain("c");
    expect(waves[2]).toContain("d");
  });

  it("places root stages in wave 1", () => {
    const workflow = makeWorkflow([
      { id: "x", type: "builtin" },
      { id: "y", type: "builtin" }
    ]);
    const waves = resolveExecutionOrder(workflow);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toContain("x");
    expect(waves[0]).toContain("y");
  });
});
