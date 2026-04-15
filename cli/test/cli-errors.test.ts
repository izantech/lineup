import { describe, expect, it } from "vitest"

import { formatCliErrorMessage } from "../src/cli"

describe("CLI error formatting", () => {
  it("adds a friendly hint when the run subcommand is repeated", () => {
    const message = formatCliErrorMessage(
      new Error("error: too many arguments for 'run'. Expected 1 argument but got 2."),
      [
        "node",
        "lineup",
        "run",
        "--host",
        "ollama",
        "--runner",
        "codex",
        "run",
        "Add a 'run' command"
      ]
    )

    expect(message).toContain("too many arguments for 'run'")
    expect(message).toContain("Hint: did you mean `lineup run --host ollama --runner codex \"Add a 'run' command\"`?")
  })
})
