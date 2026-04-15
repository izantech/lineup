import { beforeEach, describe, expect, it, vi } from "vitest"

const execSyncMock = vi.fn()

vi.mock("node:child_process", () => ({
  execSync: execSyncMock
}))

vi.mock("node:os", () => ({
  platform: () => "darwin"
}))

describe("notify", () => {
  beforeEach(() => {
    execSyncMock.mockReset()
  })

  it("suppresses desktop notifications during tests", async () => {
    const { notifyPipelineComplete } = await import("../src/lib/notify.js")

    notifyPipelineComplete("testrun", "succeeded", "Pipeline completed successfully.")

    expect(execSyncMock).not.toHaveBeenCalled()
  })
})
