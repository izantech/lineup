import { execSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockedIsInteractive } = vi.hoisted(() => ({
  mockedIsInteractive: vi.fn(() => true)
}))

vi.mock("../src/lib/prompts.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/prompts.js")>("../src/lib/prompts.js")
  return {
    ...actual,
    isInteractive: mockedIsInteractive
  }
})

import { runBridgeWorkerCommand } from "../src/commands/bridge.js"
import { runRunCommand } from "../src/commands/run.js"
import { createLocalAgentRunner } from "../src/lib/agent-runner.js"
import { defaultBridgeSession, readBridgeEvents, saveBridgeSession } from "../src/lib/bridge.js"
import { writeGateResponse } from "../src/lib/gate-store.js"
import { LINEUP_OPENCODE_OLLAMA_PROVIDER, opencodeConfigPath } from "../src/lib/opencode-config.js"
import { runPipeline } from "../src/lib/run-pipeline.js"

type HostName = "claude" | "codex" | "opencode"

type TraceEntry = {
  command: string
  args: string[]
  prompt?: string
  wrapperTarget?: string
  env?: Record<string, string | null>
}

const ADAPTER_TEMPLATE = `#!/usr/bin/env bash
SYSTEM_PROMPT=$(cat "{{SYSTEM_PROMPT_PATH}}")
PAYLOAD="$(cat)"
{{HOST_INVOKE_COMMAND}}
`

const PASSTHROUGH_TEMPLATE = `#!/usr/bin/env bash
cat "{{APPROVED_MANIFEST_PATH}}"
`

const PROMPT_TEMPLATE = `You are an agent.

{{AGENT_BODY}}

## Contract`

const APPROVED_PLAN = `apiVersion: lineup/v3
kind: Plan
status: approved
summary: Integrate native executor
approaches:
  - name: Native
    strategy: Execute inside Lineup
recommendation:
  approach: Native
  rationale: Avoid the TF bridge
changes:
  - file: cli/src/lib/executor.ts
    change: Add executor
    rationale: Run tasks natively
acceptance_criteria:
  - criterion: Pipeline reaches verify
risks:
  - risk: Tests could depend on external host tooling
    mitigation: Seed native driver in tests
`

const REVIEW_YAML = `apiVersion: lineup/v3
kind: Review
status: PASS
summary: Pipeline completed through native executor.
issues: []
test_results:
  test_suite:
    status: pass
`

const EXPLANATION_YAML = `type: explanation
agent: teacher
date: 2026-04-14
topic: explain-tactic
status: complete
pipeline_stage: explain
learning_objectives:
  - Understand bundled tactic resolution.
prerequisites: []
explanation:
  overview: |
    The bundled explain tactic resolved successfully.
  sections:
    - title: Resolution
      content: |
        The CLI found the built-in explain tactic without requiring a repo-local tactics directory.
      code_examples: []
      key_takeaways:
        - Bundled tactics are available outside the lineup repo.
further_exploration: []
`

const RESEARCH_YAML = `type: research
agent: researcher
date: 2026-04-14
topic: ollama-host
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Captured by the Ollama host integration harness.
constraints:
  tooling: local
gaps:
  pending: []
`

const IMPLEMENT_JSON = JSON.stringify({
  status: "complete",
  summary: "implemented the requested change",
  changes_made: [
    {
      file: "README.md",
      description: "updated readme",
      task_id: "CHANGE-001"
    }
  ],
  issues_encountered: []
})

const RESEARCH_JSON = JSON.stringify({
  what_found: {
    files: ["README.md"]
  },
  how_it_works: "Captured by the Ollama host integration harness.",
  constraints: {
    tooling: "local"
  },
  gaps: {
    pending: []
  }
})

const PLAN_JSON = JSON.stringify({
  apiVersion: "lineup/v3",
  kind: "Plan",
  status: "approved",
  summary: "Integrate native executor",
  approaches: [
    {
      name: "Native",
      strategy: "Execute inside Lineup"
    }
  ],
  recommendation: {
    approach: "Native",
    rationale: "Avoid the TF bridge"
  },
  changes: [
    {
      file: "cli/src/lib/executor.ts",
      change: "Add executor",
      rationale: "Run tasks natively"
    }
  ],
  acceptance_criteria: [
    {
      criterion: "Pipeline reaches verify"
    }
  ],
  risks: [
    {
      risk: "Tests could depend on external host tooling",
      mitigation: "Seed native driver in tests"
    }
  ]
})

const REVIEW_JSON = JSON.stringify({
  apiVersion: "lineup/v3",
  kind: "Review",
  status: "PASS",
  summary: "Pipeline completed through native executor.",
  issues: [],
  test_results: {
    test_suite: {
      status: "pass"
    }
  }
})

const TEACHER_PROSE = "The bundled explain tactic resolved successfully, but the host returned plain prose instead of structured YAML."

const EXPLANATION_JSON = JSON.stringify({
  type: "explanation",
  agent: "teacher",
  date: "2026-04-14",
  topic: "explain-tactic",
  status: "complete",
  pipeline_stage: "explain",
  learning_objectives: ["Understand bundled tactic resolution."],
  prerequisites: [],
  explanation: {
    overview: "Recovered from prose output.",
    sections: [],
    raw_output: TEACHER_PROSE
  },
  further_exploration: []
})

const HOSTS: HostName[] = ["claude", "codex", "opencode"]

function writeProjectConfig(root: string, content: string): void {
  const dir = join(root, ".lineup")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.yaml"), content, "utf8")
}

function writeUserOllamaConfig(homeDir: string, host: HostName, content: string): void {
  const dir =
    host === "claude"
      ? join(homeDir, ".claude", "lineup")
      : host === "codex"
        ? join(homeDir, ".codex", "lineup")
        : join(homeDir, ".config", "opencode", "lineup")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "ollama.yaml"), content, "utf8")
}

function writeExecutable(binDir: string, name: string, content: string): void {
  const filePath = join(binDir, name)
  const normalized = content.replace("#!/usr/bin/env node", `#!${process.execPath}`)
  writeFileSync(filePath, normalized, "utf8")
  chmodSync(filePath, 0o755)
}

function writeTemplatesTo(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".lineup-core", "adapters"), { recursive: true })
  mkdirSync(join(projectRoot, ".lineup-core", "prompts"), { recursive: true })
  mkdirSync(join(projectRoot, "agents"), { recursive: true })
  for (const role of ["planner", "worker", "validator"]) {
    writeFileSync(join(projectRoot, ".lineup-core", "adapters", `${role}.sh.template`), ADAPTER_TEMPLATE)
    writeFileSync(join(projectRoot, ".lineup-core", "prompts", `${role}-system.txt.template`), PROMPT_TEMPLATE)
  }
  writeFileSync(join(projectRoot, ".lineup-core", "adapters", "passthrough-planner.sh.template"), PASSTHROUGH_TEMPLATE)
  for (const agent of ["researcher", "architect", "developer", "reviewer", "teacher"]) {
    writeFileSync(
      join(projectRoot, "agents", `${agent}.md`),
      `---
name: ${agent}
description: Test ${agent}
---

AGENT_MARKER: ${agent}
`,
      "utf8"
    )
  }
}

function initGitRepo(projectRoot: string): void {
  execSync("git init", { cwd: projectRoot, stdio: "ignore" })
  execSync("git config user.email 'lineup@example.com'", { cwd: projectRoot, stdio: "ignore" })
  execSync("git config user.name 'Lineup Tests'", { cwd: projectRoot, stdio: "ignore" })
  writeFileSync(join(projectRoot, "README.md"), "# test\n", "utf8")
  execSync("git add README.md", { cwd: projectRoot, stdio: "ignore" })
  execSync("git commit -m 'init'", { cwd: projectRoot, stdio: "ignore" })
}

function writeFullPipelineWorkflow(projectRoot: string): string {
  const workflowDir = join(projectRoot, ".lineup-core", "workflows")
  mkdirSync(workflowDir, { recursive: true })
  const workflowPath = join(workflowDir, "full-pipeline.yaml")
  writeFileSync(
    workflowPath,
    `apiVersion: lineup/v3
kind: Workflow
name: human-pipeline
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
  - id: plan
    type: agent
    agent: architect
    depends_on: [research]
  - id: plan-approval
    type: approval
    depends_on: [plan]
  - id: implement
    type: agent
    agent: developer
    depends_on: [plan-approval]
  - id: verify
    type: agent
    agent: reviewer
    depends_on: [implement]
`,
    "utf8"
  )
  return workflowPath
}

function escapeForScript(value: string): string {
  return JSON.stringify(value)
}

function writeFakeHostBinaries(binDir: string): void {
  const hostCore = `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const prompt = args[args.length - 1] ?? ''
const traceFile = process.env.LINEUP_TEST_TRACE_FILE
const teacherMode = process.env.LINEUP_TEST_TEACHER_MODE ?? 'structured'

function log(entry) {
  if (!traceFile) {
    return
  }
  mkdirSync(dirname(traceFile), { recursive: true })
  appendFileSync(traceFile, JSON.stringify(entry) + '\\n')
}

function findOutputPath(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-o') {
      return argv[index + 1] ?? ''
    }
  }
  return ''
}

function findExpectedArtifactPath(value) {
  const match = value.match(/Create or overwrite (\\S+) with the final structured payload\\./)
  return match ? match[1] : ''
}

function detectAgent(value) {
  if (value.includes('Convert the following draft into a JSON value that matches the provided schema.')) {
    return 'formatter'
  }
  for (const agent of ['researcher', 'architect', 'developer', 'reviewer', 'teacher']) {
    if (value.includes('AGENT_MARKER: ' + agent)) {
      return agent
    }
  }
  return 'unknown'
}

function responseFor(agent) {
  switch (agent) {
    case 'researcher':
      return ${escapeForScript(RESEARCH_YAML)}
    case 'architect':
      return ${escapeForScript(APPROVED_PLAN)}
    case 'developer':
      return ${escapeForScript(IMPLEMENT_JSON)}
    case 'reviewer':
      return ${escapeForScript(REVIEW_YAML)}
    case 'teacher':
      return teacherMode === 'prose' ? ${escapeForScript(TEACHER_PROSE)} : ${escapeForScript(EXPLANATION_YAML)}
    case 'formatter':
      if (prompt.includes('kind: Plan')) {
        return ${escapeForScript(PLAN_JSON)}
      }
      if (prompt.includes('kind: Review') || prompt.includes('**Status')) {
        return ${escapeForScript(REVIEW_JSON)}
      }
      if (prompt.includes('type: research') || prompt.includes('what_found:')) {
        return ${escapeForScript(RESEARCH_JSON)}
      }
      if (prompt.includes('"changes_made"') || prompt.includes('"issues_encountered"')) {
        return ${escapeForScript(IMPLEMENT_JSON)}
      }
      return ${escapeForScript(EXPLANATION_JSON)}
    default:
      return ${escapeForScript(RESEARCH_YAML)}
  }
}

const agent = detectAgent(prompt)
const output = responseFor(agent)
const expectedArtifactPath = findExpectedArtifactPath(prompt)
if (expectedArtifactPath) {
  writeFileSync(expectedArtifactPath, output)
}
`

  writeExecutable(
    binDir,
    "claude",
    `#!/usr/bin/env node
${hostCore}
log({
  command: 'claude',
  args,
  prompt,
  env: {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null,
    OLLAMA_HOST: process.env.OLLAMA_HOST ?? null,
    LINEUP_WRAPPED_VIA_OLLAMA: process.env.LINEUP_WRAPPED_VIA_OLLAMA ?? null
  }
})
process.stdout.write(output)
`
  )

  writeExecutable(
    binDir,
    "opencode",
    `#!/usr/bin/env node
${hostCore}
log({
  command: 'opencode',
  args,
  prompt,
  env: {
    OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT ? '[set]' : null,
    OLLAMA_HOST: process.env.OLLAMA_HOST ?? null,
    LINEUP_WRAPPED_VIA_OLLAMA: process.env.LINEUP_WRAPPED_VIA_OLLAMA ?? null
  }
})
process.stdout.write(output)
`
  )

  writeExecutable(
    binDir,
    "codex",
    `#!/usr/bin/env node
${hostCore}
const outputPath = findOutputPath(args)
log({
  command: 'codex',
  args,
  prompt,
  env: {
    OLLAMA_HOST: process.env.OLLAMA_HOST ?? null,
    LINEUP_WRAPPED_VIA_OLLAMA: process.env.LINEUP_WRAPPED_VIA_OLLAMA ?? null
  }
})
if (outputPath) {
  writeFileSync(outputPath, output)
}
process.stdout.write('')
`
  )

  writeExecutable(
    binDir,
    "ollama",
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const traceFile = process.env.LINEUP_TEST_TRACE_FILE

function log(entry) {
  if (!traceFile) {
    return
  }
  mkdirSync(dirname(traceFile), { recursive: true })
  appendFileSync(traceFile, JSON.stringify(entry) + '\\n')
}

if (args[0] === 'list') {
  process.stdout.write(\`NAME               ID              SIZE      MODIFIED\\n\${process.env.LINEUP_TEST_OLLAMA_MODEL ?? 'local-model'}     abc123          1 GB      now\\n\`)
  process.exit(0)
}

if (args[0] !== 'launch') {
  process.stderr.write('unsupported ollama command\\n')
  process.exit(1)
}

const wrapperTarget = args[1] ?? ''
const separatorIndex = args.indexOf('--')
const forwardedArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1)
log({
  command: 'ollama',
  args,
  wrapperTarget,
  env: {
    OLLAMA_HOST: process.env.OLLAMA_HOST ?? null
  }
})
const result = spawnSync(wrapperTarget, forwardedArgs, {
  encoding: 'utf8',
  env: {
    ...process.env,
    LINEUP_WRAPPED_VIA_OLLAMA: '1'
  }
})
if (result.stdout) {
  process.stdout.write(result.stdout)
}
if (result.stderr) {
  process.stderr.write(result.stderr)
}
process.exit(result.status ?? 1)
`
  )
}

function readTrace(traceFile: string): TraceEntry[] {
  if (!existsSync(traceFile)) {
    return []
  }

  return readFileSync(traceFile, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceEntry)
}

function latestRunId(projectRoot: string): string {
  const runsDir = join(projectRoot, ".lineup", ".runs")
  return readdirSync(runsDir)
    .filter((entry) => !entry.startsWith("."))
    .sort()
    .at(-1) ?? ""
}

function configureHostFixture(input: {
  root: string
  homeDir: string
  host: HostName
  includeOllama?: boolean
  scope?: "research" | "full"
  strategy?: "auto" | "launch" | "managed"
  model?: string
  teacherMode?: "structured" | "prose"
}): { traceFile: string; workflowPath: string; projectRoot: string; homeDir: string } {
  const projectRoot = join(input.root, `${input.host}-project`)
  const homeDir = input.homeDir
  const binDir = join(input.root, "bin")
  const model = input.model ?? "gpt-oss:120b"
  mkdirSync(projectRoot, { recursive: true })
  mkdirSync(homeDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  writeTemplatesTo(projectRoot)
  initGitRepo(projectRoot)
  const workflowPath = writeFullPipelineWorkflow(projectRoot)
  writeProjectConfig(projectRoot, "models:\n  haiku: haiku\n")
  writeUserOllamaConfig(
    homeDir,
    input.host,
    `enabled: true
model: ${model}
scope: ${input.scope ?? "research"}
baseUrl: http://127.0.0.1:11434/v1
host_integration:
  enabled: true
  strategy: ${input.strategy ?? "auto"}
`
  )
  writeFakeHostBinaries(binDir)
  if (!input.includeOllama) {
    rmSync(join(binDir, "ollama"))
  }

  const traceFile = join(input.root, `${input.host}-trace.ndjson`)
  process.env.PATH = `${binDir}:/usr/bin:/bin`
  process.env.HOME = homeDir
  process.env.USERPROFILE = homeDir
  process.env.LINEUP_TEST_TRACE_FILE = traceFile
  process.env.LINEUP_TEST_OLLAMA_MODEL = model
  process.env.LINEUP_TEST_TEACHER_MODE = input.teacherMode ?? "structured"

  return { traceFile, workflowPath, projectRoot, homeDir }
}

function assertHostLaunchPath(
  host: HostName,
  trace: TraceEntry[],
  homeDir: string,
  model: string,
  claudeIntegration: "launch" | "env" = "launch"
): void {
  if (host === "claude") {
    if (claudeIntegration === "launch") {
      expect(trace.some((entry) => entry.command === "ollama" && entry.wrapperTarget === "claude")).toBe(true)
      expect(
        trace.some(
          (entry) => entry.command === "claude" && entry.env?.LINEUP_WRAPPED_VIA_OLLAMA === "1"
        )
      ).toBe(true)
      return
    }

    expect(trace.some((entry) => entry.command === "ollama")).toBe(false)
    expect(
      trace.some(
        (entry) =>
          entry.command === "claude" &&
          entry.env?.ANTHROPIC_BASE_URL === "http://127.0.0.1:11434" &&
          entry.env?.LINEUP_WRAPPED_VIA_OLLAMA === null
      )
    ).toBe(true)
    return
  }

  if (host === "codex") {
    const codexInvocation = trace.find((entry) => entry.command === "codex")
    expect(codexInvocation?.args).toContain("--oss")
    expect(codexInvocation?.args).toContain("--local-provider")
    expect(codexInvocation?.args).toContain("ollama")
    expect(codexInvocation?.args).toContain("-m")
    expect(codexInvocation?.args).toContain(model)
    expect(codexInvocation?.env?.OLLAMA_HOST).toBe("http://127.0.0.1:11434")
    return
  }

  const opencodeInvocation = trace.find((entry) => entry.command === "opencode")
  expect(opencodeInvocation?.args).toContain("--model")
  expect(opencodeInvocation?.args).toContain(`${LINEUP_OPENCODE_OLLAMA_PROVIDER}/${model}`)
  expect(opencodeInvocation?.env?.OPENCODE_CONFIG_CONTENT).toBeTruthy()
  const opencodeConfig = JSON.parse(readFileSync(opencodeConfigPath(homeDir), "utf8")) as {
    model?: string
    provider: Record<string, unknown>
  }
  expect(opencodeConfig.model).toBe(`${LINEUP_OPENCODE_OLLAMA_PROVIDER}/${model}`)
  expect(opencodeConfig.provider).toHaveProperty(LINEUP_OPENCODE_OLLAMA_PROVIDER)
}

let tempDir = ""
let originalCwd = ""
let originalPath: string | undefined
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalTrace: string | undefined
let originalTeacherMode: string | undefined
let originalModel: string | undefined
let stderrChunks: string[]

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-ollama-host-suite-"))
  originalCwd = process.cwd()
  originalPath = process.env.PATH
  originalHome = process.env.HOME
  originalUserProfile = process.env.USERPROFILE
  originalTrace = process.env.LINEUP_TEST_TRACE_FILE
  originalTeacherMode = process.env.LINEUP_TEST_TEACHER_MODE
  originalModel = process.env.LINEUP_TEST_OLLAMA_MODEL
  stderrChunks = []
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk))
    return true
  })
  mockedIsInteractive.mockReturnValue(true)
})

afterEach(() => {
  process.chdir(originalCwd)
  process.env.PATH = originalPath
  process.env.HOME = originalHome
  process.env.USERPROFILE = originalUserProfile
  process.env.LINEUP_TEST_TRACE_FILE = originalTrace
  process.env.LINEUP_TEST_TEACHER_MODE = originalTeacherMode
  process.env.LINEUP_TEST_OLLAMA_MODEL = originalModel
  rmSync(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe("Ollama host integration pipelines", () => {
  for (const host of HOSTS) {
    it(`runs the full human pipeline through ${host}`, async () => {
      const fixture = configureHostFixture({
        root: tempDir,
        homeDir: join(tempDir, `${host}-home`),
        host,
        includeOllama: host === "claude" ? false : true
      })
      const localAgentRunner = createLocalAgentRunner(host)

      process.chdir(fixture.projectRoot)
      const result = await runPipeline(
        {
          workflow: fixture.workflowPath,
          mode: "human",
          approvePlan: true,
          prompt: "Ship the local Ollama-backed feature",
          host
        },
        {
          runId: `${host}hum`,
          localAgentRunner
        }
      )

      expect(result.status).toBe("success")
      expect(result.stageResults.get("research")?.outputs).toHaveProperty("artifactPath")
      if (host !== "claude") {
        expect(result.stageResults.get("research")?.outputs).toMatchObject({
          how_it_works: "Captured by the Ollama host integration harness."
        })
      }
      expect(result.stageResults.get("plan")?.outputs).toHaveProperty("planPath")
      expect(result.stageResults.get("verify")?.outputs).toHaveProperty("status", "PASS")
      assertHostLaunchPath(
        host,
        readTrace(fixture.traceFile),
        fixture.homeDir,
        "gpt-oss:120b",
        host === "claude" ? "env" : "launch"
      )
    })
  }

  for (const host of HOSTS) {
    it(`runs the bridge worker flow through ${host}`, async () => {
      const fixture = configureHostFixture({
        root: tempDir,
        homeDir: join(tempDir, `${host}-bridge-home`),
        host,
        includeOllama: host === "claude" ? false : true
      })

      process.chdir(fixture.projectRoot)
      saveBridgeSession(
        defaultBridgeSession({
          runId: `${host}brg`,
          executorHost: host,
          workflow: fixture.workflowPath
        }),
        fixture.projectRoot
      )

      setTimeout(() => {
        writeGateResponse(
          `${host}brg`,
          {
            requestId: 1,
            choice: "approve",
            respondedAt: new Date().toISOString()
          },
          fixture.projectRoot
        )
      }, 50)

      await runBridgeWorkerCommand({
        runId: `${host}brg`,
        executorHost: host,
        workflow: fixture.workflowPath,
        prompt: "Ship the bridge-backed Ollama feature"
      })

      const replay = await readBridgeEvents(`${host}brg`, {}, fixture.projectRoot)
      expect(replay.events.some((event) => event.type === "question" && event.stageId === "plan-approval")).toBe(true)
      expect(replay.events.some((event) => event.type === "complete" && event.status === "succeeded")).toBe(true)
      expect(
        existsSync(join(fixture.projectRoot, ".lineup", ".runs", `${host}brg`, "artifacts", "review.yaml"))
      ).toBe(true)
      assertHostLaunchPath(
        host,
        readTrace(fixture.traceFile),
        fixture.homeDir,
        "gpt-oss:120b",
        host === "claude" ? "env" : "launch"
      )
    })
  }
})

describe("Ollama host integration explain tactic", () => {
  for (const host of HOSTS) {
    it(`runs lineup run --tactic explain through ${host}`, async () => {
      const fixture = configureHostFixture({
        root: tempDir,
        homeDir: join(tempDir, `${host}-explain-home`),
        host,
        includeOllama: host === "claude" ? false : true,
        teacherMode: host === "opencode" ? "prose" : "structured"
      })

      process.chdir(fixture.projectRoot)
      await runRunCommand({
        tactic: "explain",
        host,
        prompt: "Explain tactic resolution"
      })

      const runId = latestRunId(fixture.projectRoot)
      const explainArtifact = join(fixture.projectRoot, ".lineup", ".runs", runId, "artifacts", "explain.yaml")
      expect(existsSync(explainArtifact)).toBe(true)
      const explainYaml = readFileSync(explainArtifact, "utf8")
      expect(explainYaml).toContain("type: explanation")
      if (host === "opencode") {
        expect(explainYaml).toContain("raw_output:")
      } else {
        expect(explainYaml).toContain("learning_objectives:")
      }
      expect(stderrChunks.join("")).toContain(`Using local host '${host}'`)
      assertHostLaunchPath(
        host,
        readTrace(fixture.traceFile),
        fixture.homeDir,
        "gpt-oss:120b",
        host === "claude" ? "env" : "launch"
      )
    })
  }

  it("falls back to Claude env launch when the ollama wrapper is unavailable", async () => {
    const fixture = configureHostFixture({
      root: tempDir,
      homeDir: join(tempDir, "claude-fallback-home"),
      host: "claude",
      includeOllama: false,
      strategy: "launch",
      teacherMode: "prose"
    })

    process.chdir(fixture.projectRoot)
    await runRunCommand({
      tactic: "explain",
      host: "claude",
      prompt: "Explain tactic resolution"
    })

    const trace = readTrace(fixture.traceFile)
    expect(trace.some((entry) => entry.command === "ollama")).toBe(false)
    expect(
      trace.some(
        (entry) =>
          entry.command === "claude" &&
          entry.env?.ANTHROPIC_BASE_URL === "http://127.0.0.1:11434" &&
          entry.env?.LINEUP_WRAPPED_VIA_OLLAMA === null
      )
    ).toBe(true)

    const runId = latestRunId(fixture.projectRoot)
    const explainArtifact = join(fixture.projectRoot, ".lineup", ".runs", runId, "artifacts", "explain.yaml")
    expect(readFileSync(explainArtifact, "utf8")).toContain("raw_output:")
  })
})
