import { describe, expect, it } from "vitest";

import { readStatus } from "../src/lib/operations";

describe("status --json contract", () => {
  it("returns stable top-level shape", async () => {
    const result = await readStatus(["claude", "codex"]);

    expect(result).toHaveProperty("schema_version");
    expect(result).toHaveProperty("state_file");
    expect(result).toHaveProperty("hosts");

    const allowedHostKeys = new Set(["host", "installed", "version", "source", "last_action", "error"]);
    for (const host of Object.values(result.hosts)) {
      if (!host) {
        continue;
      }

      for (const key of Object.keys(host)) {
        expect(allowedHostKeys.has(key)).toBe(true);
      }
    }
  });
});
