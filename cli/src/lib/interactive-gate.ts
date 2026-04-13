import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import type { PendingGate, GateResponse } from "./gate-store.js";

export async function handleInteractiveGate(gate: PendingGate): Promise<GateResponse> {
  const rl = createInterface({ input, output });

  try {
    let choice: string;

    if (gate.gateType === "approval") {
      const answer = await rl.question(`${gate.question} [Y/n]: `);
      const trimmed = answer.trim().toLowerCase();
      choice = trimmed === "" || trimmed === "y" || trimmed === "yes" ? "approve" : "reject";

    } else if (gate.gateType === "clarify" || gate.gateType === "clarification") {
      const answer = await rl.question(`${gate.question}\n> `);
      choice = answer.trim();

    } else if (gate.gateType === "verify-decision") {
      output.write(`${gate.question}\n`);
      output.write("  1) Retry\n");
      output.write("  2) Accept with warnings\n");
      output.write("  3) Abort\n");
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
      output.write(`${gate.question}\n`);
      gate.choices.forEach((c, i) => {
        output.write(`  ${i + 1}) ${c}\n`);
      });
      const answer = await rl.question(`Choice [1-${gate.choices.length}]: `);
      const idx = parseInt(answer.trim(), 10) - 1;
      choice = idx >= 0 && idx < gate.choices.length ? gate.choices[idx] : gate.choices[0];

    } else {
      const answer = await rl.question(`${gate.question}\n> `);
      choice = answer.trim() || (gate.defaultChoice ?? "");
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
