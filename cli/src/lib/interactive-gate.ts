import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import type { PendingGate, GateResponse } from "./gate-store.js";

export async function handleInteractiveGate(gate: PendingGate): Promise<GateResponse> {
  const rl = createInterface({ input, output });

  try {
    let choice: string;
    const promptWithContext = (prompt: string): string => (
      gate.context && gate.context.trim().length > 0
        ? `${gate.context.trim()}\n\n${prompt}`
        : prompt
    );

    if (gate.gateType === "approval") {
      const answer = await rl.question(promptWithContext(`${gate.question} [Y/n]: `));
      const trimmed = answer.trim().toLowerCase();
      choice = trimmed === "" || trimmed === "y" || trimmed === "yes" ? "approve" : "reject";

    } else if (gate.gateType === "clarify" || gate.gateType === "clarification") {
      const answer = await rl.question(promptWithContext(`${gate.question}\n> `));
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
      if (gate.choices.length > 0) {
        output.write(`${gate.question}\n`);
        gate.choices.forEach((c, i) => {
          const defaultMarker = gate.defaultChoice === c ? " (default)" : "";
          output.write(`  ${i + 1}) ${c}${defaultMarker}\n`);
        });
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
        const answer = await rl.question(promptWithContext(`${gate.question}\n> `));
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
