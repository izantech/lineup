import { afterEach, describe, expect, it, vi } from "vitest"

import { formatCliErrorMessage, printCliError } from "../src/cli"
import { CliError } from "../src/lib/errors"

describe("CLI error formatting", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it("does not print a CliError that was already reported by the human pipeline", () => {
    const writes: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    })

    printCliError(new CliError("Run abc123 failed.", { alreadyReported: true }))

    expect(writes).toEqual([])
  })
})
