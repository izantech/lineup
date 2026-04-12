export type StructuredOutputFormat = "yaml" | "json";

export type RepairResult = {
  content: string;
  changed: boolean;
  notes: string[];
};

function normalizeRawText(raw: string): string {
  return raw.replace(/\uFEFF/g, "").replace(/\r\n?/g, "\n");
}

function finalize(content: string, original: string, notes: string[]): RepairResult {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  return {
    content: normalized,
    changed: normalized !== original,
    notes
  };
}

function extractFencedBlock(raw: string, preferredLanguage?: string): { content: string; note: string } | null {
  const fencePattern = /```([A-Za-z0-9_-]+)?[^\n]*\n([\s\S]*?)```/g;
  const matches: Array<{ language: string | undefined; body: string }> = [];

  for (const match of raw.matchAll(fencePattern)) {
    matches.push({ language: match[1], body: match[2] });
  }

  if (matches.length === 0) {
    return null;
  }

  const preferred = matches.find((match) => match.language === preferredLanguage) ?? matches[0];
  return {
    content: preferred.body.trim(),
    note: preferred.language
      ? `extracted ${preferred.language} fenced block`
      : "extracted fenced block"
  };
}

function extractBalancedJsonSnippet(raw: string): { content: string; note: string } | null {
  const starts = [raw.indexOf("{"), raw.indexOf("[")].filter((index) => index >= 0);
  if (starts.length === 0) {
    return null;
  }

  const start = Math.min(...starts);
  const open = raw[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: raw.slice(start, index + 1).trim(),
          note: "extracted balanced JSON payload"
        };
      }
    }
  }

  return null;
}

function repairJsonText(raw: string): RepairResult {
  const normalized = normalizeRawText(raw).trim();
  const fenced = extractFencedBlock(normalized, "json");
  if (fenced) {
    return finalize(fenced.content, normalized, [fenced.note]);
  }

  const balanced = extractBalancedJsonSnippet(normalized);
  if (balanced) {
    return finalize(balanced.content, normalized, [balanced.note]);
  }

  return finalize(normalized, normalized, []);
}

function repairYamlText(raw: string): RepairResult {
  const normalized = normalizeRawText(raw).trim();
  const fenced = extractFencedBlock(normalized, "yaml") ?? extractFencedBlock(normalized, "yml");
  if (fenced) {
    return finalize(fenced.content, normalized, [fenced.note]);
  }

  const apiVersionIndex = normalized.search(/^apiVersion:/m);
  if (apiVersionIndex >= 0) {
    const extracted = normalized.slice(apiVersionIndex).trim();
    return finalize(extracted, normalized, ["trimmed leading prose before apiVersion"]);
  }

  const kindIndex = normalized.search(/^kind:/m);
  if (kindIndex >= 0) {
    const extracted = normalized.slice(kindIndex).trim();
    return finalize(extracted, normalized, ["trimmed leading prose before kind"]);
  }

  return finalize(normalized, normalized, []);
}

export function repairStructuredOutput(raw: string, format: StructuredOutputFormat): RepairResult {
  if (format === "json") {
    return repairJsonText(raw);
  }

  return repairYamlText(raw);
}

export function repairJsonOutput(raw: string): RepairResult {
  return repairJsonText(raw);
}

export function repairYamlOutput(raw: string): RepairResult {
  return repairYamlText(raw);
}
