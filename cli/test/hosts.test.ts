import { describe, expect, it } from "vitest";

import { CliError } from "../src/lib/errors";
import { hostOptionToHosts, normalizeHostOption, resolveRequestedHosts } from "../src/lib/hosts";

describe("host selection", () => {
  it("normalizes known host options", () => {
    expect(normalizeHostOption("claude")).toBe("claude");
    expect(normalizeHostOption("CoDeX")).toBe("codex");
    expect(normalizeHostOption("opencode")).toBe("opencode");
    expect(normalizeHostOption("all")).toBe("all");
  });

  it("rejects invalid host option", () => {
    expect(() => normalizeHostOption("gemini")).toThrow(CliError);
  });

  it("expands all to all supported hosts", () => {
    expect(hostOptionToHosts("all")).toEqual(["claude", "codex", "opencode"]);
  });

  it("fails when host is omitted in non-interactive mode", async () => {
    await expect(resolveRequestedHosts(undefined, { interactive: false })).rejects.toThrow(CliError);
  });
});
