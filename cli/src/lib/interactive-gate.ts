import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import type { PendingGate, GateResponse } from "./gate-store.js";
import { writeGatePromptFrame } from "./ui/runtime.js";

export async function handleInteractiveGate(gate: PendingGate): Promise<GateResponse> {
  const rl = createInterface({ input, output });

  try {
    let choice: string;
    writeGatePromptFrame(gate, output);

    if (gate.gateType === "approval") {
      output.write("Press Enter to accept the default choice.\n");
      const answer = await rl.question("Approve? [Y/n]: ");
      const trimmed = answer.trim().toLowerCase();
      choice = trimmed === "" || trimmed === "y" || trimmed === "yes" ? "approve" : "reject";

    } else if (gate.gateType === "clarify" || gate.gateType === "clarification") {
      output.write("Press Enter to submit an empty response.\n");
      const answer = await rl.question("> ");
      choice = answer.trim();

    } else if (gate.gateType === "verify-decision") {
      output.write("  1) Retry\n");
      output.write("  2) Accept with warnings\n");
      output.write("  3) Abort\n");
      output.write("Press Enter to choose the default action.\n");
      const answer = await rl.question("Choice [1/2/3]: ");
      const trimmed = answer.trim();
      if (trimmed === "2") {
        choice = "accept";
      } else if (trimmed === "3") {
        choice = "abort";
      } else {
        choice = "retry";
      }

    } else if (gate.gateType === "custom") {
      gate.choices.forEach((c, i) => {
        output.write(`  ${i + 1}) ${c}\n`);
      });
      output.write("Press Enter to choose the first option.\n");
      const answer = await rl.question(`Choice [1-${gate.choices.length}]: `);
      const idx = parseInt(answer.trim(), 10) - 1;
      choice = idx >= 0 && idx < gate.choices.length ? gate.choices[idx] : gate.choices[0];

    } else {
      if (gate.choices.length > 0) {
        gate.choices.forEach((c, i) => {
          const defaultMarker = gate.defaultChoice === c ? " (default)" : "";
          output.write(`  ${i + 1}) ${c}${defaultMarker}\n`);
        });
        output.write("Press Enter to use the default choice.\n");
        const answer = await rl.question(`Choice [1-${gate.choices.length}]: `);
        const trimmed = answer.trim();
        const idx = parseInt(trimmed, 10) - 1;
        if (idx >= 0 && idx < gate.choices.length) {
          choice = gate.choices[idx];
        } else {
          const matched = gate.choices.find((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
          choice = matched ?? gate.defaultChoice ?? gate.choices[0];
        }
      } else {
        output.write("Press Enter to submit the default response.\n");
        const answer = await rl.question("> ");
        choice = answer.trim() || (gate.defaultChoice ?? "");
      }
    }

    return {
      requestId: gate.requestId,
      choice,
      respondedAt: new Date().toISOString()
    };
  } finally {
    rl.close();
  }
}
