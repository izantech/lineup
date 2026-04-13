import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CliError } from "../src/lib/errors";
import { generateHostFiles } from "../src/lib/generate";
import { describeClaudeProtocolBridge } from "../src/lib/host-claude";
import { describeCodexProtocolBridge } from "../src/lib/host-codex";
import { describeOpencodeProtocolBridge } from "../src/lib/host-opencode";
import { hostOptionToHosts, normalizeHostOption, resolveRequestedHosts } from "../src/lib/hosts";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

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

describe.each([
  ["claude", describeClaudeProtocolBridge, "/lineup:kick-off", "AskUserQuestion", "skills/kick-off/SKILL.md"],
  ["codex", describeCodexProtocolBridge, "$lineup-kick-off", "structured multiple-choice prompts", ".agents/skills/lineup-kick-off/SKILL.md"],
  ["opencode", describeOpencodeProtocolBridge, "/lineup-kick-off", "question", ".opencode/skills/lineup-kick-off/SKILL.md"]
] as const)("host protocol bridge for %s", (host, describeBridge, kickoffCommand, questionPrimitive, kickoffTarget) => {
  it("exposes JSON-RPC method coverage and host-native primitives", () => {
    const bridge = describeBridge(sourceRoot);

    expect(bridge.host).toBe(host);
    expect(bridge.transport).toBe("json-rpc-2.0");
    expect(bridge.framing).toBe("ndjson");
    expect(bridge.questionPrimitive).toBe(questionPrimitive);
    expect(bridge.commands.kickoff).toBe(kickoffCommand);
    expect(bridge.methodMap).toEqual({
      "agent/spawn": "spawn",
      "agent/output": "stream",
      "agent/done": "complete",
      "agent/cancel": "cancel",
      "gate/request": "question",
      "gate/respond": "respond",
      "pipeline/cancel": "cancel",
      "pipeline/complete": "complete"
    });
  });

  it("keeps generated host packaging valid", () => {
    const files = generateHostFiles(sourceRoot, host);
    const kickoffFile = files.find((file) => file.target === kickoffTarget);

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.content.includes("<!-- AUTO-GENERATED."))).toBe(true);
    expect(files.some((file) => file.target === kickoffTarget)).toBe(true);
    expect(kickoffFile?.content.startsWith("---")).toBe(true);
  });
});
