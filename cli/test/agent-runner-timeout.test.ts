import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

describe("runSpawnedCommand timeout handling", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects after the timeout grace window even when the child never emits close", async () => {
    vi.useFakeTimers();

    const killCalls: string[] = [];

    vi.doMock("node:child_process", () => ({
      execSync: vi.fn(),
      spawn: vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill: (signal?: string) => boolean;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal?: string) => {
          killCalls.push(signal ?? "SIGTERM");
          return true;
        };
        return child;
      })
    }));

    const { createLocalAgentRunner } = await import("../src/lib/agent-runner.js");
    const runner = createLocalAgentRunner("claude");

    const invocation = runner.invoke({
      projectRoot: "/tmp",
      workingDirectory: "/tmp",
      agent: "researcher",
      prompt: "Explain this repo.",
      timeoutMs: 25
    });
    const rejection = expect(invocation).rejects.toMatchObject({
      code: "timeout"
    });

    await vi.advanceTimersByTimeAsync(1_200);

    await rejection;
    expect(killCalls).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
