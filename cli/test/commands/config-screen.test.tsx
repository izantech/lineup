import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigEditorApp, getLayoutMode } from "../../src/commands/config-screen.js";

function arrowDown(): string {
  return "\u001B[B";
}

function arrowRight(): string {
  return "\u001B[C";
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("config screen", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("switches preview hosts, toggles fields, and saves the draft", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-config-screen-"));
    const onSave = vi.fn();
    const onCancel = vi.fn();

    const app = render(
      <ConfigEditorApp
        configPath={join(tempDir, ".lineup", "config.yaml")}
        initialConfig={{}}
        initialWarnings={[]}
        initialHost="codex"
        cwd={tempDir}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    await flush();
    expect(app.lastFrame()).toContain("[codex]");

    app.stdin.write("\t");
    await flush();
    app.stdin.write(arrowRight());
    await flush();
    expect(app.lastFrame()).toContain("[opencode]");

    app.stdin.write("\t");
    await flush();
    app.stdin.write(arrowDown());
    app.stdin.write(arrowDown());
    await flush();
    app.stdin.write("\r");
    await flush();
    app.stdin.write(" ");
    await flush();
    app.stdin.write("s");
    await flush();

    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      ollama: {
        enabled: true
      }
    });

    app.unmount();
  });

  it("supports text editing, inherited unset, and clean quit", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-config-screen-"));
    const onSave = vi.fn();
    const onCancel = vi.fn();

    const app = render(
      <ConfigEditorApp
        configPath={join(tempDir, ".lineup", "config.yaml")}
        initialConfig={{}}
        initialWarnings={[]}
        initialHost="claude"
        cwd={tempDir}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    app.stdin.write("\r");
    await flush();
    app.stdin.write("gpt-5-mini");
    await flush();
    app.stdin.write("\r");
    await flush();
    expect(app.lastFrame()).toContain("haiku target: gpt-5-mini");

    app.stdin.write("\r");
    await flush();
    app.stdin.write("\u0015");
    await flush();
    expect(app.lastFrame()).toContain("haiku target: Inherited");

    app.stdin.write("q");
    await flush();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();

    app.unmount();
  });

  it("prompts before discarding dirty changes", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-config-screen-"));
    const onSave = vi.fn();
    const onCancel = vi.fn();

    const app = render(
      <ConfigEditorApp
        configPath={join(tempDir, ".lineup", "config.yaml")}
        initialConfig={{}}
        initialWarnings={[]}
        initialHost="claude"
        cwd={tempDir}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    app.stdin.write("\r");
    await flush();
    app.stdin.write("gpt-5-mini");
    await flush();
    app.stdin.write("\r");
    await flush();

    app.stdin.write("q");
    await flush();
    expect(app.lastFrame()).toContain("Discard unsaved changes?");
    expect(onCancel).not.toHaveBeenCalled();

    app.stdin.write("q");
    await flush();
    expect(onCancel).toHaveBeenCalledTimes(1);

    app.unmount();
  });

  it("switches to stacked and compact layouts as the terminal narrows", () => {
    expect(getLayoutMode(180)).toBe("wide");
    expect(getLayoutMode(140)).toBe("stacked");
    expect(getLayoutMode(90)).toBe("compact");
  });

  it("uses detected Ollama models as selectable options with a custom fallback", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-config-screen-"));
    const onSave = vi.fn();
    const onCancel = vi.fn();

    const app = render(
      <ConfigEditorApp
        configPath={join(tempDir, ".lineup", "config.yaml")}
        initialConfig={{
          ollama: {
            enabled: true
          }
        }}
        initialWarnings={[]}
        initialHost="claude"
        cwd={tempDir}
        onSave={onSave}
        onCancel={onCancel}
        viewportSize={{ columns: 170 }}
        loadOllamaModels={async () => ["qwen3-coder:30b", "llama3.2:latest"]}
      />
    );

    await flush();
    app.stdin.write("\t");
    await flush();
    app.stdin.write("\t");
    await flush();
    app.stdin.write("\u001B[B");
    app.stdin.write("\u001B[B");
    await flush();
    app.stdin.write("\r");
    await flush();
    app.stdin.write("\u001B[B");
    await flush();
    app.stdin.write("\r");
    await flush();

    expect(app.lastFrame()).toContain("Custom value...");
    expect(app.lastFrame()).toContain("Use higher-layer value");
    expect(app.lastFrame()).not.toContain("Inherited");
    expect(app.lastFrame()).toContain("qwen3-coder:30b");

    app.stdin.write("\u001B[B");
    await flush();
    app.stdin.write("\r");
    await flush();
    app.stdin.write("s");
    await flush();

    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      ollama: {
        enabled: true,
        model: "qwen3-coder:30b"
      }
    });

    app.unmount();
  });
});
