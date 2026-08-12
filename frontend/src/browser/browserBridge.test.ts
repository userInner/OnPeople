import { afterEach, describe, expect, it, vi } from "vitest";

import { browserBridge, normalizeBrowserAddress } from "./browserBridge";

afterEach(() => {
  delete window.onpeopleBrowser;
});

describe("normalizeBrowserAddress", () => {
  it("keeps supported URLs and expands host names", () => {
    expect(normalizeBrowserAddress("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(normalizeBrowserAddress("example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(normalizeBrowserAddress(" ")).toBe("about:blank");
  });

  it("turns plain text into a Google search", () => {
    expect(normalizeBrowserAddress("OnPeople browser")).toBe(
      "https://www.google.com/search?q=OnPeople%20browser",
    );
  });

  it("queues Electron agent commands before the browser workspace mounts", () => {
    let deliver: ((payload: unknown) => void) | undefined;
    window.onpeopleBrowser = {
      invoke: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
      onAgentCommand: vi.fn((handler) => {
        deliver = handler as (payload: unknown) => void;
        return () => undefined;
      }),
    };

    const stopReceiver = browserBridge.receiveAgentCommands(() => undefined);
    deliver?.({ kind: "open", url: "https://example.com/weather" });
    const listener = vi.fn();
    const stopListener = browserBridge.onAgentCommand(listener);

    expect(window.onpeopleBrowser.onAgentCommand).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      kind: "open",
      url: "https://example.com/weather",
    });

    stopListener();
    stopReceiver();
  });

  it("deduplicates retried agent commands while the browser workspace mounts", () => {
    let deliver: ((payload: unknown) => void) | undefined;
    window.onpeopleBrowser = {
      invoke: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
      onAgentCommand: vi.fn((handler) => {
        deliver = handler as (payload: unknown) => void;
        return () => undefined;
      }),
    };

    const stopReceiver = browserBridge.receiveAgentCommands(() => undefined);
    const command = {
      id: "browser-open-stable-id",
      kind: "open",
      url: "https://example.com/weather",
    };
    deliver?.(command);
    deliver?.(command);
    deliver?.(command);
    const listener = vi.fn();
    const stopListener = browserBridge.onAgentCommand(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(command);

    stopListener();
    stopReceiver();
  });
});
