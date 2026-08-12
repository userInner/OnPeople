import type { BrowserHostEvent } from "./types";
import { desktopApi } from "../lib/desktopClient";
import type { BrowserAction } from "../bindings/BrowserAction";

export interface BrowserAgentCommand {
  id?: string;
  kind: "open";
  url: string;
}

const pendingAgentCommands: BrowserAgentCommand[] = [];
const pendingAgentCommandIds = new Set<string>();
const agentCommandListeners = new Set<(command: BrowserAgentCommand) => void>();

const DEFAULT_TIMEOUT_MS = 10_000;

function unavailable(): Error {
  return new Error("内置浏览器仅在 OnPeople Electron 桌面版中可用");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("浏览器操作超时，请重试")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export const browserBridge = {
  available(): boolean {
    return typeof window.onpeopleBrowser?.invoke === "function";
  },

  invoke<T>(
    command: string,
    payload: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const actionByCommand: Record<string, BrowserAction> = {
      back: "back",
      forward: "forward",
      reload: "reload",
      "visual-snapshot": "captureVisualSnapshot",
      "developer-tools": "inspectDeveloperState",
      "session-status": "sessionStatus",
      "clear-site-data": "clearSession",
      "clear-all-data": "clearAllData",
      activate: "activateTab",
      unregister: "detachTab",
    };
    const action = actionByCommand[command];
    if (action) {
      return withTimeout(
        desktopApi.request("browser.action", {
          action,
          payload: payload as never,
        }) as Promise<T>,
        timeoutMs,
      );
    }
    if (!window.onpeopleBrowser) return Promise.reject(unavailable());
    return withTimeout(
      window.onpeopleBrowser.invoke(command, payload) as Promise<T>,
      timeoutMs,
    );
  },

  onEvent(handler: (event: BrowserHostEvent) => void): () => void {
    return window.onpeopleBrowser?.onEvent(handler) ?? (() => undefined);
  },

  receiveAgentCommands(
    handler: (command: BrowserAgentCommand) => void,
  ): () => void {
    return (
      window.onpeopleBrowser?.onAgentCommand((payload) => {
        const command = payload as BrowserAgentCommand;
        if (command.kind !== "open" || typeof command.url !== "string") return;
        if (
          agentCommandListeners.size === 0 &&
          (!command.id || !pendingAgentCommandIds.has(command.id))
        ) {
          pendingAgentCommands.push(command);
          if (command.id) pendingAgentCommandIds.add(command.id);
        }
        for (const listener of agentCommandListeners) listener(command);
        handler(command);
      }) ?? (() => undefined)
    );
  },

  onAgentCommand(handler: (command: BrowserAgentCommand) => void): () => void {
    agentCommandListeners.add(handler);
    for (const command of pendingAgentCommands.splice(0)) {
      if (command.id) pendingAgentCommandIds.delete(command.id);
      handler(command);
    }
    return () => agentCommandListeners.delete(handler);
  },
};

export function normalizeBrowserAddress(value: string): string {
  const input = value.trim();
  if (!input) return "about:blank";
  if (/^(?:https?:\/\/|about:blank$)/i.test(input)) return input;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(input)) {
    return `https://${input}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}
