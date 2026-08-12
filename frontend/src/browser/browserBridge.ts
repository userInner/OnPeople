import type { BrowserHostEvent } from "./types";
import { desktopApi } from "../lib/desktopClient";
import type { BrowserAction } from "../bindings/BrowserAction";
import type { DesktopBrowserCommand } from "../bindings/DesktopBrowserCommand";

export interface BrowserAgentCommand {
  id?: string;
  kind: "open";
  routeId?: string;
  url: string;
}

export interface BrowserNativeRoute {
  routeId: string;
  threadId: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  crashed: boolean;
}

export interface BrowserNativeState {
  hostReady: boolean;
  hostStatus: string;
  hostError: string | null;
  hostErrorKind: string | null;
  activeRouteId: string | null;
  tabs: BrowserNativeRoute[];
  profilePath: string;
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
    return window.onpeopleElectron?.isElectron === true;
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
      downloads: "downloads",
      "show-download": "showDownload",
      "open-external": "openExternal",
      zoom: "zoom",
      recover: "recover",
      activate: "activateTab",
      focus: "focus",
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
    const routeId = String(payload.routeId ?? payload.tabId ?? "");
    if (command === "state") {
      return withTimeout(
        desktopApi.request("browser.state", {}) as Promise<T>,
        timeoutMs,
      );
    }
    if (command === "restart") {
      return withTimeout(
        desktopApi.request("browser.restart", {}) as Promise<T>,
        timeoutMs,
      );
    }
    if (command === "surface-bounds") {
      return withTimeout(
        desktopApi.request("browser.surface.bounds", {
          routeId,
          x: Number(payload.x) || 0,
          y: Number(payload.y) || 0,
          width: Number(payload.width) || 1,
          height: Number(payload.height) || 1,
          scaleFactor: Number(payload.scaleFactor) || 1,
          visible: payload.visible === true,
          interactive: payload.interactive !== false,
        }) as Promise<T>,
        timeoutMs,
      );
    }
    const commandName = {
      create: "createRoute",
      navigate: "navigate",
      stop: "stop",
      unregister: "closeRoute",
      "dom-snapshot": "domSnapshot",
      "visual-snapshot": "visualSnapshot",
      "developer-tools": "developerInspect",
    }[command];
    if (!commandName) return Promise.reject(unavailable());
    const browserCommand = {
      command: commandName,
      payload:
        commandName === "createRoute"
          ? {
              routeId,
              threadId: String(payload.threadId ?? "browser"),
              url: String(payload.url ?? "about:blank"),
            }
          : commandName === "navigate"
            ? { routeId, url: String(payload.url ?? "about:blank") }
            : { routeId },
    } as DesktopBrowserCommand;
    return withTimeout(
      desktopApi.request("browser.command", {
        command: browserCommand,
      }) as Promise<T>,
      timeoutMs,
    );
  },

  onEvent(handler: (event: BrowserHostEvent) => void): () => void {
    return window.onpeopleBrowser?.onEvent(handler) ?? (() => undefined);
  },

  onState(handler: (state: BrowserNativeState) => void): () => void {
    return (
      window.onpeopleElectron?.on("browser:state", (payload) =>
        handler(payload as BrowserNativeState),
      ) ?? (() => undefined)
    );
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
