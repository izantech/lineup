import { describe, it, expect, vi } from "vitest";

import { validateAndWarnAgentOutput } from "../src/lib/run-pipeline.js";

const VALID_RESEARCHER_YAML = `
type: research
agent: researcher
date: "2024-01-01"
topic: "Test topic"
status: complete
pipeline_stage: 1
`;

const INVALID_RESEARCHER_YAML = `
agent: researcher
date: "2024-01-01"
topic: "Test topic"
`;

describe("agent output validation", () => {
  it("valid agent output passes validation silently", () => {
    const emitStatus = vi.fn();
    validateAndWarnAgentOutput("research", "researcher", VALID_RESEARCHER_YAML, emitStatus);
    expect(emitStatus).not.toHaveBeenCalled();
  });

  it("invalid agent output emits stage/warning with schema errors", () => {
    const emitStatus = vi.fn();
    validateAndWarnAgentOutput("research", "researcher", INVALID_RESEARCHER_YAML, emitStatus);
    expect(emitStatus).toHaveBeenCalledOnce();
    const [stageId, message] = emitStatus.mock.calls[0];
    expect(stageId).toBe("research");
    expect(message).toContain("[stage/warning]");
  });

  it("validation is skipped when validateOutputs is false", () => {
    const emitStatus = vi.fn();
    validateAndWarnAgentOutput("research", "researcher", INVALID_RESEARCHER_YAML, emitStatus, false);
    expect(emitStatus).not.toHaveBeenCalled();
  });
});
