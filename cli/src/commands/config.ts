import process from "node:process";

import { projectConfigPath, readProjectConfigFile } from "../lib/config.js";
import type { HostName } from "../lib/constants.js";
import { CliError } from "../lib/errors.js";
import { printJson } from "../lib/output.js";
import { projectRoot } from "../lib/paths.js";
import { isInteractive } from "../lib/prompts.js";
import {
  createConfigReport,
  printConfigReport,
  type ConfigInspectionOptions,
  type ConfigReport
} from "./config-report.js";

export type ConfigCommandMode = "show" | "edit";

export type ConfigCommandOptions = ConfigInspectionOptions & {
  json?: boolean;
  mode?: ConfigCommandMode;
};

export { createConfigReport, type ConfigReport } from "./config-report.js";

async function runConfigEditor(options: ConfigCommandOptions = {}, cwd = process.cwd()): Promise<void> {
  if (!isInteractive()) {
    throw new CliError("`lineup config` requires an interactive terminal. Use `lineup config show` for read-only output.", {
      code: "invalid_args"
    });
  }

  const root = projectRoot(cwd);
  const configPath = projectConfigPath(root);
  const { config, warnings } = readProjectConfigFile(configPath);
  const report = createConfigReport(options, cwd);
  const { runConfigEditorScreen } = await import("./config-screen.js");
  await runConfigEditorScreen({
    cwd,
    configPath,
    initialConfig: config,
    initialWarnings: warnings,
    initialHost: report.hostResolution.resolved ?? options.host ?? "claude",
    ...(report.hostResolution.note ? { hostNote: report.hostResolution.note } : {})
  });
}

export async function runConfigCommand(options: ConfigCommandOptions = {}): Promise<void> {
  const mode = options.mode ?? (options.json ? "show" : "edit");
  if (mode === "edit" && !options.json) {
    await runConfigEditor(options);
    return;
  }

  const report: ConfigReport = createConfigReport(options);
  if (options.json) {
    printJson(report);
    return;
  }

  printConfigReport(report);
}
