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

function parseScalarLiteral(text: string): string | number {
  const trimmed = text.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  if (quoted) {
    return quoted[2];
  }
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return trimmed;
}

// Resolve a single {{ ref }} or {{ ref | filter }} token, returning a scalar string or number.
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

function isWordBoundaryChar(ch: string | undefined): boolean {
  return ch === undefined || /\s|\(|\)/.test(ch);
}

// Split on top-level `and`/`or` keywords, respecting parentheses and quoted strings.
function splitOnTopLevelKeyword(expr: string, keyword: "and" | "or"): string[] | null {
  const lower = expr.toLowerCase();
  const parts: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let segmentStart = 0;
  let found = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];

    if (quote !== null) {
      if (ch === quote && expr[i - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      continue;
    }

    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || !lower.startsWith(keyword, i)) {
      continue;
    }

    const before = expr[i - 1];
    const after = expr[i + keyword.length];
    if (isWordBoundaryChar(before) && isWordBoundaryChar(after)) {
      parts.push(expr.slice(segmentStart, i).trim());
      segmentStart = i + keyword.length;
      i = segmentStart - 1;
      found = true;
    }
  }

  if (!found) {
    return null;
  }

  parts.push(expr.slice(segmentStart).trim());
  return parts;
}

function stripWrappingParens(expr: string): string {
  let trimmed = expr.trim();

  while (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    let depth = 0;
    let wrapsWholeExpression = true;
    let quote: "'" | '"' | null = null;

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];

      if (quote !== null) {
        if (ch === quote && trimmed[i - 1] !== "\\") {
          quote = null;
        }
        continue;
      }

      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }

      if (ch === "(") {
        depth++;
        continue;
      }

      if (ch === ")") {
        depth--;
        if (depth === 0 && i < trimmed.length - 1) {
          wrapsWholeExpression = false;
          break;
        }
      }
    }

    if (!wrapsWholeExpression || depth !== 0) {
      break;
    }

    trimmed = trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function evaluateContains(expr: string, ctx: ExpressionContext): boolean {
  const containsRe = /^contains\(\s*\{\{\s*(stages\.[^\s|}]+(?:\.[^\s|}]+)*)\s*(?:\|\s*(\w+))?\s*\}\}\s*,\s*(['"])(.*?)\3\s*\)$/;
  const m = containsRe.exec(expr.trim());
  if (!m) {
    throw new Error(`Malformed contains() expression: ${expr}`);
  }

  const ref = m[1];
  const filter = m[2];
  const searchValue = m[4];
  const value = resolveRef(ref, ctx);
  const resolved = filter !== undefined ? applyFilter(value, filter) : value;

  if (Array.isArray(resolved)) return resolved.includes(searchValue);
  return String(resolved).includes(searchValue);
}

function compareValues(left: string, op: string, right: string): boolean {
  const l = parseScalarLiteral(left);
  const r = parseScalarLiteral(right);

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

// Evaluate a single clause (no boolean operators) - either contains(...) or a comparison.
function evaluateClause(clause: string, ctx: ExpressionContext): boolean {
  const trimmed = stripWrappingParens(clause);

  if (trimmed.startsWith("contains(")) {
    return evaluateContains(trimmed, ctx);
  }

  // Resolve all {{ ... }} references in the clause to scalar values.
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

function evaluateInner(expr: string, ctx: ExpressionContext): boolean {
  const trimmed = stripWrappingParens(expr.trim());

  // Handle `not <expr>`
  if (/^not\s+/i.test(trimmed)) {
    const rest = trimmed.slice(3).trim();
    return !evaluateInner(rest, ctx);
  }

  const orParts = splitOnTopLevelKeyword(trimmed, "or");
  if (orParts) {
    return orParts.some((part) => evaluateInner(part, ctx));
  }

  const andParts = splitOnTopLevelKeyword(trimmed, "and");
  if (andParts) {
    return andParts.every((part) => evaluateInner(part, ctx));
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
