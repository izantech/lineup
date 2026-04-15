import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("source CLI entrypoint", () => {
  it("executes through the npm dev script", () => {
    const cliDir = path.resolve(__dirname, "..");
    const output = execFileSync("npm", ["run", "dev", "--", "--cli-version"], {
      cwd: cliDir,
      encoding: "utf8"
    });

    expect(output).toContain("3.0.0");
  });
});
