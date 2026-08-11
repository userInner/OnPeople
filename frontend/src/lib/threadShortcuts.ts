import type { ThreadSummary } from "../types";

const MAX_NUMBERED_THREAD_SHORTCUTS = 9;

/**
 * The numbered shortcuts intentionally mirror the pinned section in the
 * sidebar. Keeping this ordering in one helper prevents the visible badge and
 * the global keyboard handler from drifting apart.
 */
export function numberedThreadShortcuts(
  threads: readonly ThreadSummary[],
): ThreadSummary[] {
  return [...threads]
    .filter((thread) => thread.pinned)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_NUMBERED_THREAD_SHORTCUTS);
}

export function threadForNumberShortcut(
  threads: readonly ThreadSummary[],
  key: string,
): ThreadSummary | undefined {
  if (!/^[1-9]$/u.test(key)) return undefined;
  return numberedThreadShortcuts(threads)[Number(key) - 1];
}
