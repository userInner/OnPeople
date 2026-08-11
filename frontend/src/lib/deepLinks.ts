import type { SettingsRoute } from "../types";

export type DeepLinkAction =
  | { kind: "task"; threadId: string }
  | { kind: "new-task"; cwd?: string }
  | { kind: "settings"; route: SettingsRoute }
  | { kind: "plugins" }
  | {
      kind: "connector-oauth";
      state: string;
      code?: string;
      error?: string;
    };

const settingsRoutes = new Set<SettingsRoute>([
  "general",
  "models",
  "profile",
  "appearance",
  "voice",
  "config",
  "personalization",
  "shortcuts",
  "usage",
  "account",
  "snapshots",
  "plugins",
  "computer",
  "hooks",
  "connections",
  "git",
  "environment",
  "worktrees",
  "archived",
]);

export function parseDeepLinkActions(payload: unknown): DeepLinkAction[] {
  const urls = [...new Set(deepLinkUrls(payload))];
  return urls.flatMap((value): DeepLinkAction[] => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return [];
    }
    if (url.protocol !== "onpeople:") return [];
    const route = url.hostname.toLowerCase();
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (route === "task" || route === "thread") {
      const threadId = path || url.searchParams.get("id") || "";
      return threadId ? [{ kind: "task" as const, threadId }] : [];
    }
    if (route === "new") {
      const cwd = url.searchParams.get("cwd")?.trim();
      return [{ kind: "new-task" as const, ...(cwd ? { cwd } : {}) }];
    }
    if (route === "settings") {
      const candidate = (path || "general") as SettingsRoute;
      return settingsRoutes.has(candidate)
        ? [{ kind: "settings" as const, route: candidate }]
        : [{ kind: "settings" as const, route: "general" }];
    }
    if (route === "plugins") return [{ kind: "plugins" as const }];
    if (route === "oauth" && path.toLowerCase() === "callback") {
      const state = url.searchParams.get("state")?.trim() ?? "";
      const code = url.searchParams.get("code")?.trim();
      const error = url.searchParams.get("error")?.trim();
      return state && (code || error)
        ? [
            {
              kind: "connector-oauth" as const,
              state,
              ...(code ? { code } : {}),
              ...(error ? { error } : {}),
            },
          ]
        : [];
    }
    return [];
  });
}

function deepLinkUrls(payload: unknown, depth = 0): string[] {
  if (depth > 5 || payload === null || payload === undefined) return [];
  if (typeof payload === "string") {
    const value = payload.trim();
    if (
      (value.startsWith("[") || value.startsWith("{")) &&
      value.length < 100_000
    ) {
      try {
        return deepLinkUrls(JSON.parse(value), depth + 1);
      } catch {
        // The plugin may deliver a plain command-line string instead of JSON.
      }
    }
    return value.match(/onpeople:\/\/[^\s"']+/giu) ?? [];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => deepLinkUrls(entry, depth + 1));
  }
  if (typeof payload === "object") {
    return Object.values(payload).flatMap((entry) =>
      deepLinkUrls(entry, depth + 1),
    );
  }
  return [];
}
