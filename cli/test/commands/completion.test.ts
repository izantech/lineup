import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCompletionCommand } from "../../src/commands/completion.js";

let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("completion command", () => {
  it("generates bash completion with complete -F", async () => {
    await runCompletionCommand({ shell: "bash" });
    const output = stdout.join("");
    expect(output).toContain("complete -F");
    expect(output).toContain("_lineup_completions");
  });

  it("generates zsh completion with #compdef", async () => {
    await runCompletionCommand({ shell: "zsh" });
    const output = stdout.join("");
    expect(output).toContain("#compdef");
    expect(output).toContain("_lineup");
  });

  it("generates fish completion with complete -c lineup", async () => {
    await runCompletionCommand({ shell: "fish" });
    const output = stdout.join("");
    expect(output).toContain("complete -c lineup");
    expect(output).toContain("__fish_use_subcommand");
  });

  it("throws CliError for unsupported shell", async () => {
    await expect(
      runCompletionCommand({ shell: "powershell" })
    ).rejects.toThrow(/Unsupported shell: powershell/);
  });
});
