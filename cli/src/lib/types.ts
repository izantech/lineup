import type { HostName } from "./constants";

export type HostState = {
  installed: boolean;
  version?: string | null;
  source?: string | null;
  skills_dir?: string | null;
  last_action: "install" | "update" | "uninstall" | null;
  last_updated_at: string | null;
};

export type InstallerState = {
  schema_version: number;
  updated_at: string | null;
  hosts: Partial<Record<HostName, HostState>>;
};

export type ReleaseManifest = {
  tag: string;
  tarball_url: string;
  sha256: string;
  published_at?: string;
  generated_at?: string;
};

export type StatusHost = {
  host: HostName;
  installed: boolean;
  version: string | null;
  source: string | null;
  last_action: HostState["last_action"];
  error?: string;
};

export type StatusOutput = {
  schema_version: number;
  state_file: string;
  hosts: Partial<Record<HostName, StatusHost>>;
};

export type GeneratedFile = {
  host: HostName;
  source: string;
  target: string;
  content: string;
};
