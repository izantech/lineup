import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CliError } from "../src/lib/errors";
import {
  validateConfigYaml,
  validateConstitutionYaml,
  validatePipelineStateJson,
  validatePlanYaml,
  validateProtocolJson,
  parseRestrictedYaml,
  parseRestrictedYamlDocuments,
  validateReviewYaml,
  validateSpecYaml,
  validateHostAdapter,
  validateInstallerState,
  validateTasksJson,
  validateTacticYaml
} from "../src/lib/validation";

describe("schema validation", () => {
  it("validates opencode.json against host adapter schema", () => {
    const filePath = fileURLToPath(new URL("../../.lineup-core/hosts/opencode.json", import.meta.url));
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    expect(() => validateHostAdapter(payload, filePath)).not.toThrow();
  });

  it("rejects invalid host adapter json", () => {
    const invalid = {
      host: "claude"
    };

    expect(() => validateHostAdapter(invalid, "fixture/host.json")).toThrow(CliError);
  });

  it("rejects invalid state json", () => {
    const invalid = {
      schema_version: 1,
      updated_at: null,
      hosts: {
        claude: {
          installed: true,
          last_action: "install"
        }
      }
    };

    expect(() => validateInstallerState(invalid, "fixture/state.json")).toThrow(CliError);
  });

  it("rejects tactic YAML anchors and aliases", () => {
    const anchored = "name: sample\ndescription: x\nstages: &s []\nverification: *s\n";
    expect(() => parseRestrictedYaml(anchored, "fixture/tactic.yaml")).toThrow(CliError);
  });

  it("rejects malformed tactic YAML", () => {
    const malformed = "name: sample\ndescription: bad\nstages:\n  - type: research\n    agent: researcher\nverification\n  - check\n";
    expect(() => validateTacticYaml(malformed, "fixture/tactic.yaml")).toThrow(CliError);
  });

  it("parses a single restricted YAML document", () => {
    const content = "name: sample\ndescription: x\nstages: []\nverification: []\n";
    expect(parseRestrictedYamlDocuments(content, "fixture/tactic.yaml")).toEqual([
      {
        name: "sample",
        description: "x",
        stages: [],
        verification: []
      }
    ]);
  });

  it("parses multiple restricted YAML documents", () => {
    const content = "---\nname: first\ndescription: one\nstages: []\nverification: []\n---\nname: second\ndescription: two\nstages: []\nverification: []\n";
    expect(parseRestrictedYamlDocuments(content, "fixture/tactic.yaml")).toEqual([
      {
        name: "first",
        description: "one",
        stages: [],
        verification: []
      },
      {
        name: "second",
        description: "two",
        stages: [],
        verification: []
      }
    ]);
  });

  it("rejects anchors, aliases, and tags in multi-document YAML", () => {
    const anchored = "---\nname: first\ndescription: one\nstages: &s []\nverification: []\n---\nname: second\ndescription: two\nstages: []\nverification: *s\n";
    const tagged = "---\nname: sample\ndescription: x\nstages: []\nverification: []\n---\n!custom\nname: other\ndescription: y\nstages: []\nverification: []\n";

    expect(() => parseRestrictedYamlDocuments(anchored, "fixture/tactic.yaml")).toThrow(CliError);
    expect(() => parseRestrictedYamlDocuments(tagged, "fixture/tactic.yaml")).toThrow(CliError);
  });

  it("allows exclamation marks inside block scalar content", () => {
    const content = `type: explanation
agent: teacher
date: 2026-04-15
topic: explain
status: complete
pipeline_stage: explain
raw_output: |-
  if (tactic.verification && !hasVerifyStage) {
    return true
  }
`;

    expect(() => parseRestrictedYamlDocuments(content, "fixture/teacher.yaml")).not.toThrow();
  });

  it("rejects malformed multi-document YAML", () => {
    const malformed = "---\nname: first\ndescription: one\nstages: []\nverification: []\n---\nname: second\ndescription: two\nstages:\n  - type: research\n    agent: researcher\nverification\n  - check\n";
    expect(() => parseRestrictedYamlDocuments(malformed, "fixture/tactic.yaml")).toThrow(CliError);
  });

  it("validates v3 artifact schemas with lineage metadata", () => {
    const constitution = `
apiVersion: lineup/v3
kind: Constitution
request:
  summary: "Add native executor"
repository:
  root: "/repo"
scope:
  areas: ["cli"]
`;
    const spec = `
apiVersion: lineup/v3
kind: Spec
what_found:
  key_files:
    - path: "/repo/cli/src/lib/validation.ts"
      description: "Current validator"
how_it_works:
  execution_flow: "Load, parse, validate"
  data_flow: "YAML -> JSON schema"
  architectural_patterns:
    - pattern: "AJV"
      description: "Single validator stack"
constraints:
  dependencies:
    external: ["ajv"]
    internal: ["validation.ts"]
  limitations: ["No v2 compatibility"]
  edge_cases:
    - condition: "Missing apiVersion"
      behavior: "Reject"
gaps:
  unable_to_determine: []
  needs_investigation: []
`;
    const plan = `
apiVersion: lineup/v3
kind: Plan
status: draft
summary: "Implement v3"
approaches:
  - name: "native"
    strategy: "Use the new engine"
recommendation:
  approach: "native"
  rationale: "Matches RFC"
changes:
  - file: "cli/src/lib/validation.ts"
    change: "Add schemas"
    rationale: "Needed for v3"
acceptance_criteria:
  - criterion: "Validation passes"
risks:
  - risk: "Schema drift"
    mitigation: "Test coverage"
`;
    const review = `
apiVersion: lineup/v3
kind: Review
status: PASS
summary: "Looks good"
issues: []
test_results:
  test_suite:
    status: pass
`;
    const config = `
apiVersion: lineup/v3
kind: Config
engine:
  default: native
model_aliases:
  developer: codex-mini-latest
providers:
  ollama:
    enabled: true
    base_url: "http://localhost:11434"
    model: "llama3.2"
    compress_output: true
`;
    const tasks = {
      apiVersion: "lineup/v3",
      kind: "Tasks",
      plan_hash: "abc123",
      git_tree_sha: "def456",
      compiled_at: "2026-04-12T00:00:00.000Z",
      tasks: [
        {
          id: "V3-02",
          title: "Add schemas",
          wave: 1,
          status: "todo",
          depends_on: ["V3-00"],
          agent: "developer",
          write_scope: ["cli/schemas/"]
        }
      ]
    };
    const protocolRequest = {
      jsonrpc: "2.0",
      id: "req-1",
      method: "agent/spawn",
      params: { role: "developer" }
    };
    const protocolResponse = {
      jsonrpc: "2.0",
      id: "req-1",
      result: { ok: true }
    };
    const pipelineState = {
      apiVersion: "lineup/v3",
      kind: "PipelineState",
      run_id: "run-123",
      status: "running",
      git_tree_sha: "def456",
      stage_state: {
        plan: {
          status: "running",
          updated_at: "2026-04-12T00:00:00.000Z",
          last_message: "Drafting the plan",
          attempt: 1,
          max_attempts: 2
        }
      },
      pending_gate: {
        request_id: "7",
        stage_id: "plan-approval",
        gate_type: "approval",
        question: "Approve the generated plan?",
        choices: ["approve", "reject"],
        default_choice: "approve",
        created_at: "2026-04-12T00:00:00.000Z",
        expires_at: "2026-04-12T00:05:00.000Z"
      },
      artifact_hashes: {
        constitution: "hash-1",
        spec: "hash-2"
      },
      updated_at: "2026-04-12T00:00:00.000Z"
    };

    expect(() => validateConstitutionYaml(constitution, "fixture/constitution.yaml")).not.toThrow();
    expect(() => validateSpecYaml(spec, "fixture/spec.yaml")).not.toThrow();
    expect(() => validatePlanYaml(plan, "fixture/plan.yaml")).not.toThrow();
    expect(() => validateReviewYaml(review, "fixture/review.yaml")).not.toThrow();
    expect(() => validateConfigYaml(config, "fixture/config.yaml")).not.toThrow();
    expect(() => validateTasksJson(tasks, "fixture/tasks.json")).not.toThrow();
    expect(() => validateProtocolJson(protocolRequest, "fixture/protocol.json")).not.toThrow();
    expect(() => validateProtocolJson(protocolResponse, "fixture/protocol.json")).not.toThrow();
    expect(() => validatePipelineStateJson(pipelineState, "fixture/pipeline-state.json")).not.toThrow();
  });

  it("rejects versioned v3 artifacts that are missing apiVersion or kind", () => {
    const invalidYaml = `
kind: Constitution
request:
  summary: "Missing apiVersion"
repository:
  root: "/repo"
scope: {}
`;

    expect(() => validateConstitutionYaml(invalidYaml, "fixture/constitution.yaml")).toThrow(/Constitution/);
    expect(() => validatePlanYaml("apiVersion: lineup/v3\nkind: Plan\nsummary: x\napproaches: []\nrecommendation: { approach: x, rationale: y }\nchanges: []\nacceptance_criteria: []\nrisks: []\n", "fixture/plan.yaml")).toThrow(/Plan/);
    expect(() => validateTasksJson({ kind: "Tasks", tasks: [] }, "fixture/tasks.json")).toThrow(/Tasks/);
    expect(() => validateProtocolJson({ jsonrpc: "2.0", method: "unknown" }, "fixture/protocol.json")).toThrow(/Protocol/);
    expect(() => validatePipelineStateJson({ apiVersion: "lineup/v3", kind: "PipelineState", run_id: "run-1", status: "running", artifact_hashes: {}, updated_at: "not-a-date" }, "fixture/pipeline-state.json")).toThrow(/Pipeline state/);
  });
});
