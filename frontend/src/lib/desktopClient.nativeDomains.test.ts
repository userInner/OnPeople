import { afterEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "./desktopClient";

describe("desktopClient native domain compatibility", () => {
  afterEach(() => {
    delete window.__ONPEOPLE_DEV__;
  });

  it("keeps legacy helper shapes while using only desktop_request", async () => {
    const invoke = vi.fn(async (command: string, args: unknown) => {
      expect(command).toBe("desktop_request");
      const request = (
        args as { request: { requestId: string; method: string } }
      ).request;
      const result =
        request.method === "terminal.start"
          ? {
              processId: "terminal-1",
              cwd: "/workspace",
              shell: "/bin/zsh",
              cols: 80,
              rows: 24,
            }
          : request.method === "file.list"
            ? []
            : request.method === "git.hunks"
              ? { path: "README.md", hunks: [] }
              : null;
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result,
      };
    });
    window.__ONPEOPLE_DEV__ = {
      setWorkbenchState: vi.fn() as never,
      invoke,
    };

    const terminal = await desktopClient.startTerminal({
      cwd: "/workspace",
      cols: 80,
      rows: 24,
    });
    const files = await desktopClient.listProjectFiles("/workspace");
    const hunks = await desktopClient.getGitHunks("/workspace", "README.md");

    expect(terminal.processId).toBe("terminal-1");
    expect(files).toEqual([]);
    expect(hunks).toEqual({ path: "README.md", hunks: [] });
    expect(
      invoke.mock.calls.map(([, args]) =>
        String((args as { request: { method: string } }).request.method),
      ),
    ).toEqual(["terminal.start", "file.list", "git.hunks"]);
  });

  it("keeps native shell helper shapes while using only desktop_request", async () => {
    const invoke = vi.fn(async (command: string, args: unknown) => {
      expect(command).toBe("desktop_request");
      const request = (
        args as {
          request: { requestId: string; method: string; params: unknown };
        }
      ).request;
      const result =
        request.method === "shell.images.pick"
          ? { selected: ["/tmp/image.png"] }
          : request.method === "shell.app-update.state"
            ? {
                supported: true,
                status: "idle",
                currentVersion: "0.30.0",
                availableVersion: null,
                progress: null,
                message: null,
              }
            : { opened: true, url: "https://example.com" };
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result,
      };
    });
    window.__ONPEOPLE_DEV__ = {
      setWorkbenchState: vi.fn() as never,
      invoke,
    };

    const opened = await desktopClient.openExternalUrl("https://example.com");
    const cloudConsole = await desktopClient.openCloudConsole();
    const picked = await desktopClient.pickImages();
    const update = await desktopClient.getAppUpdateState();

    expect(opened).toEqual({ opened: true, url: "https://example.com" });
    expect(cloudConsole).toEqual({ opened: true, url: "https://example.com" });
    expect(picked).toEqual({ selected: ["/tmp/image.png"] });
    expect(update.currentVersion).toBe("0.30.0");
    expect(
      invoke.mock.calls.map(([, args]) =>
        String((args as { request: { method: string } }).request.method),
      ),
    ).toEqual([
      "shell.external-url.open",
      "shell.cloud-console.open",
      "shell.images.pick",
      "shell.app-update.state",
    ]);
  });
});
