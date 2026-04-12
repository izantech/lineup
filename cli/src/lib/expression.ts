export type ExpressionContext = {
  stages: Record<string, { outputs: Record<string, unknown> }>;
  variables: Record<string, string>;
};

const TEMPLATE_RE = /\{\{\s*(stages\.[^\s|}]+(?:\.[^\s|}]+)*)\s*(?:\|\s*(\w+))?\s*\}\}/g;

function resolveRef(ref: string, ctx: ExpressionContext): unknown {
  // ref format: stages.<id>.outputs.<field>
  const parts = ref.trim().split(".");
  if (parts.length < 4 || parts[0] !== "stages" || parts[2] !== "outputs") {
    throw new Error(`Malformed template reference: {{ ${ref} }}`);
  }
  const stageId = parts[1];
  const field = parts.slice(3).join(".");
  const stage = ctx.stages[stageId];
  if (!stage) {
    throw new Error(`Unresolved template reference: stage '${stageId}' not found in context`);
  }
  if (!(field in stage.outputs)) {
    throw new Error(`Unresolved template reference: field '${field}' not found in stage '${stageId}' outputs`);
  }
  return stage.outputs[field];
}

function applyFilter(value: unknown, filter: string): unknown {
  if (filter === "length") {
    if (Array.isArray(value)) return value.length;
    return String(value).length;
  }
  throw new Error(`Unknown filter: '${filter}'`);
}

// Resolve a single {{ ref }} or {{ ref | filter }} token, returning a scalar string or number
function resolveToken(ref: string, filter: string | undefined, ctx: ExpressionContext): string | number {
  const value = resolveRef(ref, ctx);
  if (filter !== undefined) {
    const result = applyFilter(value, filter);
    return result as string | number;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

// Handle contains({{ ref }}, "value") or contains({{ ref | filter }}, "value")
function evaluateContains(expr: string, ctx: ExpressionContext): boolean {
  const containsRe = /^contains\(\s*\{\{\s*(stages\.[^\s|}]+(?:\.[^\s|}]+)*)\s*(?:\|\s*(\w+))?\s*\}\}\s*,\s*"([^"]*)"\s*\)$/;
  const m = containsRe.exec(expr.trim());
  if (!m) {
    throw new Error(`Malformed contains() expression: ${expr}`);
  }
  const ref = m[1];
  const filter = m[2];
  const searchValue = m[3];
  const value = resolveRef(ref, ctx);
  const resolved = filter !== undefined ? applyFilter(value, filter) : value;
  if (Array.isArray(resolved)) return resolved.includes(searchValue);
  return String(resolved).includes(searchValue);
}

function coerce(s: string): string | number {
  const trimmed = s.trim();
  if (trimmed !== "" && !isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function compareValues(left: string, op: string, right: string): boolean {
  const l = coerce(left);
  const r = coerce(right);
  if (typeof l === "number" && typeof r === "number") {
    if (op === "==") return l === r;
    if (op === "!=") return l !== r;
    if (op === ">") return l > r;
    if (op === "<") return l < r;
    if (op === ">=") return l >= r;
    if (op === "<=") return l <= r;
  } else {
    const ls = String(l);
    const rs = String(r);
    if (op === "==") return ls === rs;
    if (op === "!=") return ls !== rs;
    if (op === ">") return ls > rs;
    if (op === "<") return ls < rs;
    if (op === ">=") return ls >= rs;
    if (op === "<=") return ls <= rs;
  }
  throw new Error(`Unknown operator: '${op}'`);
}

// Evaluate a single clause (no boolean operators) — either contains(...) or a comparison
function evaluateClause(clause: string, ctx: ExpressionContext): boolean {
  const trimmed = clause.trim();

  if (trimmed.startsWith("contains(")) {
    return evaluateContains(trimmed, ctx);
  }

  // Resolve all {{ ... }} references in the clause to scalar values
  const resolved = trimmed.replace(TEMPLATE_RE, (_match, ref, filter) => {
    return String(resolveToken(ref, filter, ctx));
  });

  // Match comparison: <left> <op> <right>
  const cmpRe = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
  const m = cmpRe.exec(resolved.trim());
  if (!m) {
    throw new Error(`Malformed expression: ${clause}`);
  }
  return compareValues(m[1].trim(), m[2], m[3].trim());
}

// Split on top-level `and`/`or` keywords, respecting parentheses
function splitOnBoolean(expr: string): { parts: string[]; op: "and" | "or" } | null {
  // Try `or` first (lower precedence), then `and`
  for (const keyword of ["or", "and"] as const) {
    const re = new RegExp(`\\b${keyword}\\b`, "g");
    let depth = 0;
    let lastIndex = 0;
    const parts: string[] = [];
    let match;
    let found = false;

    re.lastIndex = 0;
    const chars = expr;
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === "(") depth++;
      else if (chars[i] === ")") depth--;
      else if (depth === 0) {
        re.lastIndex = i;
        match = re.exec(chars);
        if (match && match.index === i) {
          parts.push(expr.slice(lastIndex, i));
          lastIndex = i + keyword.length;
          found = true;
          i = lastIndex - 1;
        }
      }
    }
    if (found) {
      parts.push(expr.slice(lastIndex));
      return { parts, op: keyword };
    }
  }
  return null;
}

function evaluateInner(expr: string, ctx: ExpressionContext): boolean {
  const trimmed = expr.trim();

  // Handle `not <expr>`
  if (/^not\s+/i.test(trimmed)) {
    return !evaluateInner(trimmed.slice(4), ctx);
  }

  // Handle parentheses wrapping
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return evaluateInner(trimmed.slice(1, -1), ctx);
  }

  // Split on boolean operators
  const split = splitOnBoolean(trimmed);
  if (split) {
    if (split.op === "and") {
      return split.parts.every((p) => evaluateInner(p, ctx));
    }
    return split.parts.some((p) => evaluateInner(p, ctx));
  }

  return evaluateClause(trimmed, ctx);
}

/**
 * Evaluate a workflow expression against a context.
 *
 * Supports:
 * - Template references: `{{ stages.<id>.outputs.<field> }}`
 * - Pipe filter: `{{ stages.<id>.outputs.<field> | length }}`
 * - Comparisons: `==`, `!=`, `>`, `<`, `>=`, `<=`
 * - Boolean operators: `and`, `or`, `not`
 * - Function: `contains({{ ref }}, "value")`
 *
 * Returns `true` or `false`. Throws on malformed expressions or unresolved references.
 */
export function evaluateExpression(expr: string, ctx: ExpressionContext): boolean {
  return evaluateInner(expr.trim(), ctx);
}
