import { SUPPORTED_HOSTS, type HostName } from "./constants";
import { CliError } from "./errors";
import { isInteractive, promptHostSelection } from "./prompts";

export type HostOption = HostName | "all";

const HOST_SET = new Set<string>([...SUPPORTED_HOSTS, "all"]);
const HOST_OPTIONS = [...SUPPORTED_HOSTS, "all"];

export function normalizeHostOption(raw?: string): HostOption | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (!HOST_SET.has(normalized)) {
    throw new CliError(`Invalid --host value: ${raw}. Expected ${HOST_OPTIONS.join(", ")}.`, {
      code: "invalid_host"
    });
  }

  return normalized as HostOption;
}

export function hostOptionToHosts(option: HostOption): HostName[] {
  if (option === "all") {
    return [...SUPPORTED_HOSTS];
  }

  return [option];
}

export async function resolveRequestedHosts(
  rawHost?: string,
  options?: { interactive?: boolean; prompt?: () => Promise<HostName[]> }
): Promise<HostName[]> {
  const normalized = normalizeHostOption(rawHost);
  if (normalized) {
    return hostOptionToHosts(normalized);
  }

  const interactive = options?.interactive ?? isInteractive();
  if (interactive) {
    return (options?.prompt ?? promptHostSelection)();
  }

  throw new CliError(`No host selected. Use --host ${HOST_OPTIONS.join("|")} when running non-interactively.`, {
    code: "host_required"
  });
}
