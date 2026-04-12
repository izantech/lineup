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

export type LineupApiVersion = "lineup/v3";

export type ArtifactKind =
  | "constitution"
  | "spec"
  | "plan"
  | "tasks"
  | "review"
  | "config"
  | "pipeline-state";

export type ArtifactFormat = "yaml" | "json" | "markdown";

export type ArtifactDescriptor = {
  kind: ArtifactKind;
  apiVersion: Extract<LineupApiVersion, "lineup/v3">;
  format: ArtifactFormat;
  path?: string;
  sha256?: string;
};

export type PipelineArtifactMap = Partial<Record<ArtifactKind, ArtifactDescriptor>>;

export type ModelProvider = "anthropic" | "openai" | "ollama";

export type ModelAliasDefinition = {
  provider: ModelProvider;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
};

export type UserConfig = {
  apiVersion: Extract<LineupApiVersion, "lineup/v3">;
  defaultHost?: HostName;
  modelAliases?: Record<string, ModelAliasDefinition>;
  ollama?: {
    enabled?: boolean;
    baseUrl?: string;
    defaultModel?: string;
  };
};

export type ResolvedConfig = {
  sources: string[];
  defaultHost: HostName | null;
  modelAliases: Record<string, ModelAliasDefinition>;
  ollama: {
    enabled: boolean;
    baseUrl: string;
    defaultModel: string | null;
  };
};

export type WorkflowVariable = {
  name: string;
  description?: string;
  type?: "string" | "number" | "boolean";
  default?: string;
  required?: boolean;
};

export type StageType = "builtin" | "reasoning" | "agent" | "approval" | "tasks";
export type AgentRole = "researcher" | "architect" | "developer" | "reviewer" | "documenter" | "teacher";
export type ErrorCode =
  | "invalid_path"
  | "command_not_found"
  | "command_failed"
  | "timeout"
  | "rate_limit"
  | "build_failure"
  | "test_failure"
  | "malformed_output"
  | "context_overflow"
  | "tool_unavailable"
  | "agent_spawn_failed"
  | "data_corruption"
  | "approval_rejected"
  | "protocol_error"
  | "artifact_validation_failed"
  | "state_mismatch"
  | "isolation_failed"
  | "worktree_conflict"
  | "sparse_isolation_disabled"
  | "sparse_isolation_missing_paths";

export type StageInput = {
  source: string;
  fields: string[];
  via?: "inline" | "file-reference";
  fallback?: string;
};

export type StageOutputDef = {
  type: string;
  values?: string[];
  items?: StageOutputDef;
  properties?: Record<string, StageOutputDef>;
  max_length?: number;
};

export type ParallelConfig = {
  strategy: "per-area";
  max?: number;
  condition?: string;
};

export type RetryConfig = {
  max_attempts?: number;
  on?: ErrorCode[];
  backoff?: "exponential" | "linear" | "none";
};

export type OnFailureConfig = {
  action: "report" | "retry-from";
  stage?: string;
  max_retries?: number;
  block_dependents?: boolean;
};

export type WorkflowStage = {
  id: string;
  type: StageType;
  agent?: AgentRole;
  description?: string;
  depends_on?: string[];
  inputs?: StageInput[];
  outputs?: Record<string, StageOutputDef>;
  condition?: string;
  skip_if?: string;
  timeout?: string;
  retry?: RetryConfig;
  on_failure?: OnFailureConfig;
  optional?: boolean;
  gate?: string | boolean;
  parallel?: ParallelConfig;
  conditional_approach?: Record<string, number>;
};

export type SnapshotConfig = {
  max_size?: string;
  overflow?: "file-reference" | "truncate";
  stream_threshold?: string;
  compression?: "hybrid" | "mechanical" | "llm";
};

export type CacheConfig = {
  dir?: string;
  key?: string;
  format?: "yaml" | "json";
};

export type LifecycleConfig = {
  ephemeral_dir?: string;
  cleanup?: "after_verify" | "after_document" | "manual";
  persist?: string[];
};

export type WorkflowDefinition = {
  apiVersion: LineupApiVersion;
  kind: string;
  name: string;
  description?: string;
  variables?: WorkflowVariable[];
  stages: WorkflowStage[];
  snapshots?: SnapshotConfig;
  cache?: CacheConfig;
  lifecycle?: LifecycleConfig;
};

export type TfRole = "scope_selector" | "planner" | "worker" | "validator";

export type IsolationMode = "index" | "full" | "sparse";

export type PipelineRunStatus = "success" | "failed" | "aborted";

export type PipelineState = {
  apiVersion: Extract<LineupApiVersion, "lineup/v3">;
  runId: string;
  status: PipelineRunStatus;
  workflowPath: string;
  gitTreeSha: string | null;
  artifacts: PipelineArtifactMap;
};

export type RunOptions = {
  workflow?: string;
  tactic?: string;
  fromStage?: string;
  dryRun?: boolean;
  forceRerun?: boolean;
  json?: boolean;
  generateOnly?: boolean;
  timeout?: number;
};

export type TfGenerateOptions = {
  host?: string;
  output?: string;
  workflow?: string;
  manifestPath?: string;
};
