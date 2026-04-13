import { describe, expect, it } from "vitest";

import { repairJsonOutput, repairStructuredOutput, repairYamlOutput } from "../src/lib/llm-output-repair.js";
import { validateConstitutionYaml, validateProtocolJson } from "../src/lib/validation.js";

describe("llm output repair", () => {
  it("extracts fenced yaml before validation", () => {
    const raw = [
      "Here is the response:",
      "```yaml",
      "apiVersion: lineup/v3",
      "kind: Constitution",
      "request:",
      "  summary: Add native executor",
      "repository:",
      "  root: /repo",
      "scope:",
      "  areas:",
      "    - cli",
      "```",
      "Trailing commentary"
    ].join("\n");

    const repaired = repairYamlOutput(raw);
    expect(repaired.content).toContain("apiVersion: lineup/v3");
    expect(() => validateConstitutionYaml(repaired.content, "fixture/constitution.yaml")).not.toThrow();
  });

  it("extracts balanced json payloads before validation", () => {
    const raw = [
      "Answer:",
      "```json",
      '{ "jsonrpc": "2.0", "id": "req-1", "result": { "ok": true } }',
      "```",
      "Extra prose"
    ].join("\n");

    const repaired = repairJsonOutput(raw);
    expect(JSON.parse(repaired.content)).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      result: { ok: true }
    });
    expect(() => validateProtocolJson(JSON.parse(repaired.content), "fixture/protocol.json")).not.toThrow();
  });

  it("converts fenced json into yaml when yaml is expected", () => {
    const raw = [
      "```json",
      '{ "apiVersion": "lineup/v3", "kind": "Constitution", "request": { "summary": "Add native executor" }, "repository": { "root": "/repo" }, "scope": { "areas": ["cli"] } }',
      "```"
    ].join("\n");

    const repaired = repairYamlOutput(raw);
    expect(repaired.content).toContain("apiVersion: lineup/v3");
    expect(repaired.content).toContain("kind: Constitution");
    expect(() => validateConstitutionYaml(repaired.content, "fixture/constitution.yaml")).not.toThrow();
  });

  it("keeps invalid repaired output invalid", () => {
    const repaired = repairStructuredOutput(
      [
        "```json",
        '{ "jsonrpc": "2.0", "method": "unknown" }',
        "```"
      ].join("\n"),
      "json"
    );

    expect(() => validateProtocolJson(JSON.parse(repaired.content), "fixture/protocol.json")).toThrow();
  });
});
