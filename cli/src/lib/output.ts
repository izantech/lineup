export type OutputFormat = "table" | "json";

export function resolveOutputFormat(raw?: string): OutputFormat {
  return raw === "json" ? "json" : "table";
}

export function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function printTableLine(text: string): void {
  process.stdout.write(`${text}\n`);
}
