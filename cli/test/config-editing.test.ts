import { describe, expect, it } from "vitest";

import {
  CONFIG_FIELD_DEFINITIONS,
  applyFieldValue,
  formatDraftYaml,
  getConfigFieldsForSection,
  getDraftValidationErrors,
  getDraftValue
} from "../src/commands/config-editing.js";
import type { LineupConfigFile } from "../src/lib/config.js";

describe("config editing helpers", () => {
  it("defines editable fields for models, agents, and ollama", () => {
    expect(getConfigFieldsForSection("models").map((field) => field.path)).toEqual([
      "models.haiku",
      "models.sonnet",
      "models.opus"
    ]);
    expect(getConfigFieldsForSection("agents").some((field) => field.path === "agents.researcher.model")).toBe(true);
    expect(getConfigFieldsForSection("ollama").some((field) => field.path === "ollama.host_integration.strategy")).toBe(true);
    expect(getConfigFieldsForSection("review")).toEqual([]);
    expect(CONFIG_FIELD_DEFINITIONS.length).toBeGreaterThan(10);
  });

  it("applies explicit values and unsets inherited values", () => {
    const field = CONFIG_FIELD_DEFINITIONS.find((entry) => entry.path === "ollama.model");
    if (!field) {
      throw new Error("expected ollama.model field");
    }

    const withValue = applyFieldValue({}, field, "qwen3-coder:30b");
    expect(getDraftValue(withValue, "ollama.model")).toBe("qwen3-coder:30b");

    const withoutValue = applyFieldValue(withValue, field, undefined);
    expect(getDraftValue(withoutValue, "ollama.model")).toBeUndefined();
    expect(withoutValue.ollama).toBeUndefined();
  });

  it("reports validation errors for invalid explicit values", () => {
    const invalidDraft: LineupConfigFile = {
      agents: {
        researcher: {
          model: "invalid" as never
        }
      },
      ollama: {
        enabled: true,
        scope: "broken" as never
      }
    };

    const errors = getDraftValidationErrors(invalidDraft);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: "agents.researcher.model" }),
        expect.objectContaining({ fieldId: "ollama.scope" })
      ])
    );
  });

  it("formats the draft as yaml for review output", () => {
    const draft: LineupConfigFile = {
      models: {
        haiku: "gpt-5-mini"
      },
      ollama: {
        enabled: true,
        model: "qwen3-coder:30b"
      }
    };

    const formatted = formatDraftYaml(draft);
    expect(formatted).toContain("models:");
    expect(formatted).toContain("haiku: gpt-5-mini");
    expect(formatted).toContain("ollama:");
  });
});
