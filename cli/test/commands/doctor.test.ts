import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoctorReport, runDoctorCommand } from "../../src/commands/doctor.js";
import { runInitCommand } from "../../src/commands/init.js";

let tempDir: string;
let stdout: string[];
let originalCwd: string;
let originalPath: string | undefined;

function writeProjectConfig(root: string, content: string): void {
  const dir = join(root, ".lineup");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.yaml"), content, "utf8");
}

function writeUserOllamaConfig(homeDir: string, host: "claude" | "codex" | "opencode", content: string): void {
  const dir =
    host === "claude"
      ? join(homeDir, ".claude", "lineup")
      : host === "codex"
        ? join(homeDir, ".codex", "lineup")
        : join(homeDir, ".config", "opencode", "lineup");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ollama.yaml"), content, "utf8");
}

function writeBinary(binDir: string, name: string, content: string): void {
  const filePath = join(binDir, name);
  writeFileSync(filePath, content, "utf8");
  chmodSync(filePath, 0o755);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-doctor-"));
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  originalCwd = process.cwd();
  originalPath = process.env.PATH;
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env.PATH = originalPath;
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("doctor command", () => {
  it("reports missing workflow and git prerequisites for a fresh directory", async () => {
    await runDoctorCommand({ json: true });

    const report = JSON.parse(stdout.join("")) as {
      healthy: boolean;
      checks: {
        project: {
          workflow: { ok: boolean; detail: string };
          git_repository: { ok: boolean; detail: string };
          git_head: { ok: boolean; detail: string };
          next_commands: Array<{ label: string; command: string; detail: string }>;
        };
      };
    };

    expect(report.healthy).toBe(false);
    expect(report.checks.project.workflow.ok).toBe(false);
    expect(report.checks.project.git_repository.ok).toBe(false);
    expect(report.checks.project.git_head.ok).toBe(false);
    expect(report.checks.project.next_commands).toEqual([
      {
        label: "scaffold the Lineup workflow and git repo",
        command: "lineup init",
        detail: "creates .lineup-core/workflows/full-pipeline.yaml and initializes git if needed"
      }
    ]);
  });

  it("reports a runnable project after init and initial commit", async () => {
    await runInitCommand({});
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'lineup@example.com'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.name 'Lineup Tests'", { cwd: tempDir, stdio: "ignore" });
    execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
    execSync("git commit -m 'Initial commit'", { cwd: tempDir, stdio: "ignore" });

    stdout.length = 0;
    await runDoctorCommand({ json: true });

    const report = JSON.parse(stdout.join("")) as {
      healthy: boolean;
      checks: {
        project: {
          workflow: { ok: boolean; detail: string };
          git_repository: { ok: boolean; detail: string };
          git_head: { ok: boolean; detail: string };
          next_commands: Array<{ label: string; command: string; detail: string }>;
        };
      };
    };

    expect(existsSync(join(tempDir, ".lineup-core", "workflows", "full-pipeline.yaml"))).toBe(true);
    expect(report.healthy).toBe(true);
    expect(report.checks.project.workflow.ok).toBe(true);
    expect(report.checks.project.git_repository.ok).toBe(true);
    expect(report.checks.project.git_head.ok).toBe(true);
    expect(report.checks.project.next_commands).toEqual([]);
  });

  it("recommends only the initial commit when the workflow exists but the repo has no commits", async () => {
    await runInitCommand({});
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    stdout.length = 0;
    await runDoctorCommand({ json: true });

    const report = JSON.parse(stdout.join("")) as {
      checks: {
        project: {
          workflow: { ok: boolean };
          git_repository: { ok: boolean };
          git_head: { ok: boolean };
          next_commands: Array<{ label: string; command: string; detail: string }>;
        };
      };
    };

    expect(report.checks.project.workflow.ok).toBe(true);
    expect(report.checks.project.git_repository.ok).toBe(true);
    expect(report.checks.project.git_head.ok).toBe(false);
    expect(report.checks.project.next_commands).toEqual([
      {
        label: "create the first commit",
        command: 'git add -A && git commit -m "Initial commit"',
        detail: "native Lineup runs require at least one commit"
      }
    ]);
  });

  it("does not block health when Ollama host integration is disabled", async () => {
    const homeDir = join(tempDir, "home");
    await runInitCommand({});
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'lineup@example.com'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.name 'Lineup Tests'", { cwd: tempDir, stdio: "ignore" });
    execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
    execSync("git commit -m 'Initial commit'", { cwd: tempDir, stdio: "ignore" });
    writeProjectConfig(
      tempDir,
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: research\n  baseUrl: http://127.0.0.1:11434/v1\n`
    );

    const report = createDoctorReport(tempDir, homeDir);

    expect(report.healthy).toBe(true);
    expect(report.checks.ollama.claude.mode.detail).toBe("disabled");
    expect(report.checks.ollama.codex.mode.detail).toBe("disabled");
    expect(report.checks.ollama.opencode.mode.detail).toBe("disabled");
  });

  it("fails when Codex host integration cannot verify the configured model", async () => {
    const homeDir = join(tempDir, "home");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeBinary(
      binDir,
      "ollama",
      `#!/bin/sh
if [ "$1" = "list" ]; then
  cat <<'EOF'
NAME               ID              SIZE      MODIFIED
different-model     abc123          1 GB      now
EOF
  exit 0
fi
echo "unexpected" >&2
exit 1
`
    );
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    await runInitCommand({});
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'lineup@example.com'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.name 'Lineup Tests'", { cwd: tempDir, stdio: "ignore" });
    execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
    execSync("git commit -m 'Initial commit'", { cwd: tempDir, stdio: "ignore" });
    writeUserOllamaConfig(
      homeDir,
      "codex",
      `enabled: true\nmodel: local-qwen\nscope: research\nbaseUrl: http://127.0.0.1:11434/v1\nhost_integration:\n  enabled: true\n  strategy: auto\n`
    );

    const report = createDoctorReport(tempDir, homeDir);

    expect(report.healthy).toBe(false);
    expect(report.checks.ollama.codex.mode.detail).toContain("launch");
    expect(report.checks.ollama.codex.binary.ok).toBe(true);
    expect(report.checks.ollama.codex.readiness.ok).toBe(false);
    expect(report.checks.ollama.codex.readiness.detail).toContain("local-qwen");
    expect(report.checks.ollama.codex.integration.detail).toContain("codex --oss --local-provider ollama");
    expect(report.checks.project.next_commands).toContainEqual({
      label: "verify codex Ollama readiness",
      command: "ollama list",
      detail: "codex host integration is enabled, but the configured Ollama model could not be verified"
    });
  });

  it("recommends installing a supported host when none are available", async () => {
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "git"), "#!/bin/sh\nexit 0\n", "utf8");
    writeFileSync(join(binDir, "node"), "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(join(binDir, "git"), 0o755);
    chmodSync(join(binDir, "node"), 0o755);
    process.env.PATH = binDir;

    await runDoctorCommand({ json: true });

    const report = JSON.parse(stdout.join("")) as {
      checks: {
        hosts: Record<string, { ok: boolean; detail: string }>;
        project: {
          next_commands: Array<{ label: string; command: string; detail: string }>;
        };
      };
    };

    expect(report.checks.hosts.claude.detail).toContain("install claude");
    expect(report.checks.hosts.codex.detail).toContain("install codex");
    expect(report.checks.hosts.opencode.detail).toContain("install opencode");
    expect(report.checks.project.next_commands).toContainEqual({
      label: "install and configure a supported host CLI",
      command: "install Claude Code, Codex CLI, or OpenCode, then run lineup install --host <host>",
      detail: "Lineup needs at least one local host binary before native runs can execute"
    });
  });
});
