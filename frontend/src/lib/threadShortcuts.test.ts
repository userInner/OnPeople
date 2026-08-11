import { describe, expect, it } from "vitest";

import type { ThreadSummary } from "../types";
import {
  numberedThreadShortcuts,
  threadForNumberShortcut,
} from "./threadShortcuts";

function thread(id: string, updatedAt: string, pinned = true): ThreadSummary {
  return {
    id,
    title: id,
    cwd: "/workspace",
    projectPath: null,
    status: "idle",
    pinned,
    archived: false,
    unread: false,
    model: null,
    reasoningEffort: null,
    workspaceMode: "local",
    workspaceBaseCwd: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("numbered thread shortcuts", () => {
  it("uses the same newest-first pinned order shown in the sidebar", () => {
    const threads = [
      thread("older", "2026-08-10T00:00:00Z"),
      thread("regular", "2026-08-12T00:00:00Z", false),
      thread("newer", "2026-08-11T00:00:00Z"),
    ];

    expect(numberedThreadShortcuts(threads).map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(threadForNumberShortcut(threads, "1")?.id).toBe("newer");
    expect(threadForNumberShortcut(threads, "2")?.id).toBe("older");
  });

  it("ignores invalid or empty shortcut slots and caps the list at nine", () => {
    const threads = Array.from({ length: 11 }, (_, index) =>
      thread(
        `thread-${index + 1}`,
        `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      ),
    );

    expect(numberedThreadShortcuts(threads)).toHaveLength(9);
    expect(threadForNumberShortcut(threads, "0")).toBeUndefined();
    expect(threadForNumberShortcut(threads, "x")).toBeUndefined();
  });
});
