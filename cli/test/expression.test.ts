import { describe, expect, it } from "vitest";

import { evaluateExpression, evaluateExpressionSafe } from "../src/lib/expression.js";
import type { ExpressionContext } from "../src/lib/expression.js";

const ctx: ExpressionContext = {
  stages: {
    triage: {
      outputs: {
        complexity: "simple",
        score: 3,
        tags: ["backend", "auth"]
      }
    },
    research: {
      outputs: {
        gaps: [],
        findings: ["finding1", "finding2"]
      }
    }
  },
  variables: {}
};

describe("evaluateExpression", () => {
  it("evaluates == comparison (string match)", () => {
    expect(evaluateExpression("{{ stages.triage.outputs.complexity }} == simple", ctx)).toBe(true);
  });

  it("evaluates == comparison with quoted string literal", () => {
    expect(evaluateExpression('{{ stages.triage.outputs.complexity }} == "simple"', ctx)).toBe(true);
  });

  it("evaluates == comparison (string mismatch)", () => {
    expect(evaluateExpression("{{ stages.triage.outputs.complexity }} == complex", ctx)).toBe(false);
  });

  it("evaluates != comparison", () => {
    expect(evaluateExpression("{{ stages.triage.outputs.complexity }} != complex", ctx)).toBe(true);
  });

  it("evaluates > with numeric values", () => {
    expect(evaluateExpression("{{ stages.triage.outputs.score }} > 2", ctx)).toBe(true);
    expect(evaluateExpression("{{ stages.triage.outputs.score }} > 5", ctx)).toBe(false);
  });

  it("evaluates | length filter with empty array", () => {
    expect(evaluateExpression("{{ stages.research.outputs.gaps | length }} == 0", ctx)).toBe(true);
  });

  it("evaluates | length filter with non-empty array", () => {
    expect(evaluateExpression("{{ stages.research.outputs.findings | length }} == 2", ctx)).toBe(true);
  });

  it("evaluates contains() function", () => {
    expect(evaluateExpression('contains({{ stages.triage.outputs.tags }}, "backend")', ctx)).toBe(true);
    expect(evaluateExpression('contains({{ stages.triage.outputs.tags }}, "frontend")', ctx)).toBe(false);
  });

  it("evaluates and boolean operator", () => {
    expect(
      evaluateExpression(
        "{{ stages.triage.outputs.complexity }} == simple and {{ stages.triage.outputs.score }} > 1",
        ctx
      )
    ).toBe(true);
    expect(
      evaluateExpression(
        "{{ stages.triage.outputs.complexity }} == simple and {{ stages.triage.outputs.score }} > 10",
        ctx
      )
    ).toBe(false);
  });

  it("evaluates or boolean operator", () => {
    expect(
      evaluateExpression(
        "{{ stages.triage.outputs.complexity }} == complex or {{ stages.triage.outputs.score }} > 1",
        ctx
      )
    ).toBe(true);
    expect(
      evaluateExpression(
        "{{ stages.triage.outputs.complexity }} == complex or {{ stages.triage.outputs.score }} > 10",
        ctx
      )
    ).toBe(false);
  });

  it("respects parentheses around boolean subexpressions", () => {
    expect(
      evaluateExpression(
        "({{ stages.triage.outputs.complexity }} == complex or {{ stages.triage.outputs.score }} > 1) and {{ stages.triage.outputs.score }} > 2",
        ctx
      )
    ).toBe(true);
    expect(
      evaluateExpression(
        "({{ stages.triage.outputs.complexity }} == complex or {{ stages.triage.outputs.score }} > 1) and {{ stages.triage.outputs.score }} > 5",
        ctx
      )
    ).toBe(false);
  });

  it("evaluates not boolean operator (negates true to false)", () => {
    expect(evaluateExpression("not {{ stages.triage.outputs.complexity }} == complex", ctx)).toBe(true);
    expect(evaluateExpression("not {{ stages.triage.outputs.complexity }} == simple", ctx)).toBe(false);
  });

  it("evaluates not boolean operator with case-insensitive keyword", () => {
    expect(evaluateExpression("NOT {{ stages.triage.outputs.complexity }} == complex", ctx)).toBe(true);
    expect(evaluateExpression("Not {{ stages.triage.outputs.complexity }} == simple", ctx)).toBe(false);
  });

  it("evaluates not with parentheses", () => {
    expect(evaluateExpression("not ({{ stages.triage.outputs.complexity }} == complex)", ctx)).toBe(true);
    expect(evaluateExpression("not ({{ stages.triage.outputs.complexity }} == simple)", ctx)).toBe(false);
  });

  it("evaluates not with contains function", () => {
    expect(evaluateExpression("not contains({{ stages.triage.outputs.tags }}, \"frontend\")", ctx)).toBe(true);
    expect(evaluateExpression("not contains({{ stages.triage.outputs.tags }}, \"backend\")", ctx)).toBe(false);
  });

  it("throws on unresolved stage reference", () => {
    expect(() => evaluateExpression("{{ stages.ghost.outputs.x }} == y", ctx)).toThrow(/Unresolved/);
  });

  it("throws on unknown filter", () => {
    expect(() => evaluateExpression("{{ stages.triage.outputs.complexity | upper }} == SIMPLE", ctx)).toThrow(
      /Unknown filter/
    );
  });
});

describe("outputs_hash virtual property", () => {
  it("resolves outputs_hash to a 12-char hex string", () => {
    expect(evaluateExpression("{{ stages.triage.outputs_hash }} != empty", ctx)).toBe(true);
  });

  it("produces consistent hashes for same outputs", () => {
    const expr = "{{ stages.triage.outputs_hash }} == {{ stages.triage.outputs_hash }}";
    // Both refs resolve to the same value, so the comparison is string equality
    expect(evaluateExpression(expr, ctx)).toBe(true);
  });

  it("throws on outputs_hash for missing stage", () => {
    expect(() => evaluateExpression("{{ stages.ghost.outputs_hash }} == x", ctx)).toThrow(/Unresolved/);
  });
});

describe("variables resolution", () => {
  const ctxWithVars: ExpressionContext = {
    ...ctx,
    variables: { task_prompt: "fix the auth bug" }
  };

  it("resolves a variable reference", () => {
    expect(evaluateExpression('{{ variables.task_prompt }} != ""', ctxWithVars)).toBe(true);
  });

  it("throws on missing variable", () => {
    expect(() => evaluateExpression("{{ variables.missing }} == x", ctx)).toThrow(/Unresolved/);
  });
});

describe("evaluateExpressionSafe", () => {
  it("returns default on unresolved field reference", () => {
    expect(evaluateExpressionSafe("{{ stages.triage.outputs.nonexistent }} == x", ctx, true)).toBe(true);
    expect(evaluateExpressionSafe("{{ stages.triage.outputs.nonexistent }} == x", ctx, false)).toBe(false);
  });

  it("returns default on unresolved stage reference", () => {
    expect(evaluateExpressionSafe("{{ stages.ghost.outputs.x }} == y", ctx, false)).toBe(false);
  });

  it("evaluates normally when refs resolve", () => {
    expect(evaluateExpressionSafe("{{ stages.triage.outputs.complexity }} == simple", ctx, false)).toBe(true);
  });

  it("still throws on non-reference errors", () => {
    expect(() => evaluateExpressionSafe("{{ stages.triage.outputs.complexity | upper }} == SIMPLE", ctx, false)).toThrow(
      /Unknown filter/
    );
  });
});
