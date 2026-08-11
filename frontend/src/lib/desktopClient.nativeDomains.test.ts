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
});
