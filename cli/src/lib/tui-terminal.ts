import process from "node:process";

export type TuiTerminalCapabilities = {
  interactive: boolean;
  stdinTTY: boolean;
  stdoutTTY: boolean;
  term: string;
  ci: boolean;
  dumbTerminal: boolean;
  alternateScreen: boolean;
  degradedFallback: boolean;
};

export type TuiTerminalSnapshot = {
  stdinTTY?: boolean;
  stdoutTTY?: boolean;
  term?: string;
  ci?: boolean;
};

export function detectTuiTerminalCapabilities(terminal: TuiTerminalSnapshot = {}): TuiTerminalCapabilities {
  const stdinTTY = terminal.stdinTTY ?? Boolean(process.stdin.isTTY);
  const stdoutTTY = terminal.stdoutTTY ?? Boolean(process.stdout.isTTY);
  const term = (terminal.term ?? process.env.TERM ?? "").trim().toLowerCase();
  const ci = terminal.ci ?? Boolean(process.env.CI);
  const interactive = stdinTTY && stdoutTTY;
  const dumbTerminal = term === "dumb";
  const alternateScreen = interactive && !dumbTerminal && !ci;

  return {
    interactive,
    stdinTTY,
    stdoutTTY,
    term,
    ci,
    dumbTerminal,
    alternateScreen,
    degradedFallback: interactive && !alternateScreen
  };
}

export function shouldUseDegradedTuiFallback(terminal: TuiTerminalSnapshot = {}): boolean {
  return detectTuiTerminalCapabilities(terminal).degradedFallback;
}
