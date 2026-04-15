import { describe, expect, it } from "vitest";

import { detectTuiTerminalCapabilities, shouldUseDegradedTuiFallback } from "../../src/lib/tui-terminal.js";

describe("tui terminal capabilities", () => {
  it("detects a normal interactive alternate-screen terminal", () => {
    const capabilities = detectTuiTerminalCapabilities({
      stdinTTY: true,
      stdoutTTY: true,
      term: "xterm-256color",
      ci: false
    });

    expect(capabilities.interactive).toBe(true);
    expect(capabilities.alternateScreen).toBe(true);
    expect(capabilities.degradedFallback).toBe(false);
  });

  it("marks interactive dumb terminals as degraded fallback eligible", () => {
    const capabilities = detectTuiTerminalCapabilities({
      stdinTTY: true,
      stdoutTTY: true,
      term: "dumb",
      ci: false
    });

    expect(capabilities.interactive).toBe(true);
    expect(capabilities.alternateScreen).toBe(false);
    expect(capabilities.degradedFallback).toBe(true);
    expect(shouldUseDegradedTuiFallback({ stdinTTY: true, stdoutTTY: true, term: "dumb" })).toBe(true);
  });

  it("does not treat non-interactive shells as fallback eligible", () => {
    const capabilities = detectTuiTerminalCapabilities({
      stdinTTY: false,
      stdoutTTY: false,
      term: "xterm-256color",
      ci: false
    });

    expect(capabilities.interactive).toBe(false);
    expect(capabilities.degradedFallback).toBe(false);
  });
});
