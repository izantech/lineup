import { describe, expect, it } from "vitest";

import { parseLocalAgentStructuredOutput } from "../src/lib/agent-runner.js";

describe("parseLocalAgentStructuredOutput", () => {
  it("unwraps Claude YAML result envelopes that contain fenced JSON", () => {
    const raw = `type: result
subtype: success
result: >-
  \`\`\`json

  {
    "summary": "Add a second sentence to README.md.",
    "changes": [
      {
        "file": "README.md",
        "action": "append sentence",
        "reason": "Document the app"
      }
    ]
  }

  \`\`\`
`;

    expect(parseLocalAgentStructuredOutput(raw)).toEqual({
      summary: "Add a second sentence to README.md.",
      changes: [
        {
          file: "README.md",
          action: "append sentence",
          reason: "Document the app"
        }
      ]
    });
  });

  it("unwraps Claude JSON result envelopes that contain fenced JSON", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "```json\n{\"summary\":\"Add README text\",\"changes\":[{\"file\":\"README.md\",\"action\":\"append sentence\",\"reason\":\"Document the app\"}]}\n```"
    });

    expect(parseLocalAgentStructuredOutput(raw)).toEqual({
      summary: "Add README text",
      changes: [
        {
          file: "README.md",
          action: "append sentence",
          reason: "Document the app"
        }
      ]
    });
  });
});
