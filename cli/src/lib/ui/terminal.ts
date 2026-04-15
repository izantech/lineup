import process from "node:process";

export type TerminalCapabilities = {
  isTTY: boolean;
  supportsColor: boolean;
  supportsUnicode: boolean;
  width: number;
};

export type TerminalSymbols = {
  success: string;
  failure: string;
  warning: string;
  pending: string;
  running: string;
  bullet: string;
};

type TerminalStream = NodeJS.WriteStream;

function identity(value: string): string {
  return value;
}

export function detectTerminalCapabilities(
  stream: TerminalStream = process.stderr,
  env: NodeJS.ProcessEnv = process.env
): TerminalCapabilities {
  const isTTY = Boolean(stream.isTTY);
  const supportsColor = isTTY && env.NO_COLOR === undefined && env.TERM !== "dumb";
  const supportsUnicode = isTTY && env.LINEUP_ASCII !== "1" && env.TERM !== "dumb";
  const width = isTTY && typeof stream.columns === "number" && stream.columns > 0 ? stream.columns : 80;

  return {
    isTTY,
    supportsColor,
    supportsUnicode,
    width
  };
}

export function terminalSymbols(capabilities: TerminalCapabilities): TerminalSymbols {
  if (capabilities.supportsUnicode) {
    return {
      success: "✓",
      failure: "✗",
      warning: "!",
      pending: "•",
      running: "…",
      bullet: "•"
    };
  }

  return {
    success: "[ok]",
    failure: "[fail]",
    warning: "[!]",
    pending: "-",
    running: "...",
    bullet: "-"
  };
}

function color(code: number, enabled: boolean): (value: string) => string {
  if (!enabled) {
    return identity;
  }

  return (value: string): string => `\u001B[${code}m${value}\u001B[0m`;
}

export function terminalPalette(capabilities: TerminalCapabilities) {
  return {
    accent: color(36, capabilities.supportsColor),
    success: color(32, capabilities.supportsColor),
    warning: color(33, capabilities.supportsColor),
    failure: color(31, capabilities.supportsColor),
    dim: color(2, capabilities.supportsColor),
    strong: color(1, capabilities.supportsColor)
  };
}

export class LiveRegion {
  private readonly stream: TerminalStream;
  private readonly capabilities: TerminalCapabilities;
  private previousRowCount = 0;
  private lastSnapshot = "";

  constructor(stream: TerminalStream = process.stdout, capabilities = detectTerminalCapabilities(stream)) {
    this.stream = stream;
    this.capabilities = capabilities;
  }

  render(lines: string[]): void {
    const snapshot = `${lines.join("\n")}\n`;
    if (snapshot === this.lastSnapshot) {
      return;
    }

    if (!this.capabilities.isTTY) {
      this.stream.write(snapshot);
      this.lastSnapshot = snapshot;
      return;
    }

    this.clearRegion();
    for (const line of lines) {
      this.stream.write(`${line}\n`);
    }
    this.previousRowCount = lines.length;
    this.lastSnapshot = snapshot;
  }

  finish(lines?: string[]): void {
    if (lines) {
      this.render(lines);
    }
    this.previousRowCount = 0;
    this.lastSnapshot = "";
  }

  private clearRegion(): void {
    if (this.previousRowCount === 0) {
      return;
    }

    for (let index = 0; index < this.previousRowCount; index += 1) {
      this.stream.write("\u001B[1A\u001B[2K");
    }
  }
}
