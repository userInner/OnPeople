import type { BrowserHostEvent } from "./types";

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
    if (!window.onpeopleBrowser) return Promise.reject(unavailable());
    return withTimeout(
      window.onpeopleBrowser.invoke(command, payload) as Promise<T>,
      timeoutMs,
    );
  },

  onEvent(handler: (event: BrowserHostEvent) => void): () => void {
    return window.onpeopleBrowser?.onEvent(handler) ?? (() => undefined);
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
