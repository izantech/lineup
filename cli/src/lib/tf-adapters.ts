import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { HostName } from "./constants.js";
import { renderTemplate } from "./generate.js";
import type { TfRole } from "./types.js";

export type AdapterGenerationContext = {
  host: HostName;
  adaptersSourceDir: string;
  promptsSourceDir: string;
  outputDir: string;
  agentsDir: string;
  modelMap: Record<TfRole, string>;
};

const ROLE_TO_AGENT: Record<string, string> = {
  planner: "architect",
  worker: "developer",
  validator: "reviewer",
};

const HOST_INVOKE_COMMANDS: Record<string, string> = {
  claude: `claude --print --output-format text --model "$MODEL" --bare -s "$SYSTEM_PROMPT" <<< "$PAYLOAD"`,
  codex: `codex -q --full-context -m "$MODEL" <<< "$SYSTEM_PROMPT\n\n$PAYLOAD"`,
  opencode: `opencode run -m "$MODEL" -s "$SYSTEM_PROMPT" <<< "$PAYLOAD"`,
};

function extractAgentBody(content: string): string {
  const parts = content.split("---");
  // frontmatter is between first and second ---; body starts after second ---
  if (parts.length >= 3) {
    return parts.slice(2).join("---").trimStart();
  }
  return content.trimStart();
}

export function generateTfAdapters(ctx: AdapterGenerationContext): Record<TfRole, { adapterPath: string; promptPath: string }> {
  mkdirSync(ctx.outputDir, { recursive: true });

  const hostInvokeCommand = HOST_INVOKE_COMMANDS[ctx.host] ?? HOST_INVOKE_COMMANDS["claude"];
  const roles: Array<"planner" | "worker" | "validator"> = ["planner", "worker", "validator"];
  const result = {} as Record<TfRole, { adapterPath: string; promptPath: string }>;

  for (const role of roles) {
    const agentName = ROLE_TO_AGENT[role];
    const adapterTemplatePath = join(ctx.adaptersSourceDir, `${role}.sh.template`);
    const promptTemplatePath = join(ctx.promptsSourceDir, `${role}-system.txt.template`);
    const agentFilePath = join(ctx.agentsDir, `${agentName}.md`);

    const adapterTemplate = readFileSync(adapterTemplatePath, "utf8");
    const promptTemplate = readFileSync(promptTemplatePath, "utf8");
    const agentContent = readFileSync(agentFilePath, "utf8");
    const agentBody = extractAgentBody(agentContent);

    const adapterPath = join(ctx.outputDir, `${role}.sh`);
    const promptPath = join(ctx.outputDir, `${role}-system.txt`);

    const vars: Record<string, string> = {
      MODEL: ctx.modelMap[role],
      SYSTEM_PROMPT_PATH: promptPath,
      HOST_INVOKE_COMMAND: hostInvokeCommand,
    };

    const renderedAdapter = renderTemplate(adapterTemplate, vars, `${role}.sh.template`, ctx.host);
    const renderedPrompt = promptTemplate.replace("{{AGENT_BODY}}", agentBody);

    writeFileSync(adapterPath, renderedAdapter, "utf8");
    chmodSync(adapterPath, 0o755);
    writeFileSync(promptPath, renderedPrompt, "utf8");

    result[role] = { adapterPath, promptPath };
  }

  return result;
}

export function generatePassthroughAdapter(ctx: AdapterGenerationContext, approvedManifestPath: string): string {
  mkdirSync(ctx.outputDir, { recursive: true });

  const templatePath = join(ctx.adaptersSourceDir, "passthrough-planner.sh.template");
  const template = readFileSync(templatePath, "utf8");

  const vars: Record<string, string> = {
    APPROVED_MANIFEST_PATH: approvedManifestPath,
  };

  const rendered = renderTemplate(template, vars, "passthrough-planner.sh.template", ctx.host);
  const adapterPath = join(ctx.outputDir, "passthrough-planner.sh");

  writeFileSync(adapterPath, rendered, "utf8");
  chmodSync(adapterPath, 0o755);

  return adapterPath;
}
