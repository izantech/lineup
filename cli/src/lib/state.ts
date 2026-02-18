import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { HostName } from "./constants";
import { lineupStateFile } from "./paths";
import type { HostState, InstallerState } from "./types";
import { validateInstallerState } from "./validation";

export const STATE_SCHEMA_VERSION = 1;

export function defaultState(): InstallerState {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    updated_at: null,
    hosts: {}
  };
}

export function loadState(filePath = lineupStateFile()): InstallerState {
  if (!existsSync(filePath)) {
    return defaultState();
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return validateInstallerState(parsed, filePath);
  } catch {
    return defaultState();
  }
}

export function saveState(state: InstallerState, filePath = lineupStateFile()): InstallerState {
  const payload: InstallerState = {
    schema_version: STATE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    hosts: state.hosts
  };

  const valid = validateInstallerState(payload, filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  return valid;
}

export function updateHostState(
  state: InstallerState,
  host: HostName,
  patch: Partial<Omit<HostState, "last_updated_at">>
): InstallerState {
  const previous: HostState = state.hosts[host] ?? {
    installed: false,
    last_action: null,
    last_updated_at: null
  };

  state.hosts[host] = {
    ...previous,
    ...patch,
    last_updated_at: new Date().toISOString()
  };

  return state;
}
