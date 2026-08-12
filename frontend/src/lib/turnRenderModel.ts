import type { TimelineItem } from "../types";

export type TurnRenderBlock =
  | { id: string; kind: "item"; items: [TimelineItem] }
  | { id: string; kind: "activity"; items: TimelineItem[] };

export interface TurnRenderModel {
  items: TimelineItem[];
  blocks: TurnRenderBlock[];
}

/**
 * Pure, deterministic projection from app-server history to the conversation
 * surface. The store remains an append-only source of truth; renderer-specific
 * ownership, duplicate reconciliation, and completed-turn placement live here.
 */
export function buildTurnRenderModel(
  source: TimelineItem[],
  runtimeWorking = false,
): TurnRenderModel {
  const items = orderCompletedTurnActivities(
    suppressRedundantReasoningPlaceholders(
      collapseDuplicateTurnNarration(
        normalizeTurnActivityTraces(
          collapseDuplicateCommandTraces(inferMissingTurnIds(source)),
        ),
      ),
    ),
    runtimeWorking,
  );
  return { items, blocks: groupTimelineItems(items) };
}

function inferMissingTurnIds(items: TimelineItem[]): TimelineItem[] {
  let activeTurnId: string | undefined;
  return items.map((item) => {
    if (item.role === "user") {
      activeTurnId = item.turnId;
      return item;
    }
    if (item.turnId) {
      activeTurnId = item.turnId;
      return item;
    }
    return activeTurnId ? { ...item, turnId: activeTurnId } : item;
  });
}

function collapseDuplicateCommandTraces(items: TimelineItem[]): TimelineItem[] {
  const collapsed: TimelineItem[] = [];
  const commandIndexes = new Map<string, number>();
  for (const item of items) {
    const key = duplicateCommandKey(item);
    const existingIndex = key ? commandIndexes.get(key) : undefined;
    if (existingIndex === undefined) {
      if (key) commandIndexes.set(key, collapsed.length);
      collapsed.push(item);
      continue;
    }
    const existing = collapsed[existingIndex];
    if (existing && commandTraceScore(item) > commandTraceScore(existing)) {
      collapsed[existingIndex] = item;
    }
  }
  return collapsed;
}

function normalizeTurnActivityTraces(items: TimelineItem[]): TimelineItem[] {
  const directBrowserOperations = new Map<string, Set<string>>();
  const successfulBrowserTurns = new Set<string>();
  for (const item of items) {
    const operation = browserOperation(item);
    if (!operation || !item.turnId) continue;
    if (item.kind === "tool") {
      const operations = directBrowserOperations.get(item.turnId) ?? new Set();
      operations.add(operation);
      directBrowserOperations.set(item.turnId, operations);
      if (!hasFailed(item)) successfulBrowserTurns.add(item.turnId);
    }
  }
  return items.filter((item) => {
    const operation = browserOperation(item);
    if (
      operation &&
      item.turnId &&
      item.kind === "command" &&
      directBrowserOperations.get(item.turnId)?.has(operation)
    )
      return false;
    if (
      operation &&
      item.turnId &&
      hasFailed(item) &&
      successfulBrowserTurns.has(item.turnId)
    )
      return false;
    return !(
      item.turnId &&
      isWaitTrace(item) &&
      successfulBrowserTurns.has(item.turnId)
    );
  });
}

function browserOperation(item: TimelineItem): string | undefined {
  return `${item.title ?? ""} ${item.meta ?? ""} ${item.command ?? ""}`
    .toLowerCase()
    .match(/browser_(open|dom_snapshot|click|type|back|reload|state)/u)?.[1];
}

function isWaitTrace(item: TimelineItem): boolean {
  return (
    item.kind === "tool" &&
    !hasFailed(item) &&
    /^(?:wait|等待)$/iu.test(`${item.title ?? ""} ${item.meta ?? ""}`.trim())
  );
}

function collapseDuplicateTurnNarration(items: TimelineItem[]): TimelineItem[] {
  const collapsed: TimelineItem[] = [];
  const indexes = new Map<string, number>();
  for (const item of items) {
    const key = narrationKey(item);
    const existingIndex = key ? indexes.get(key) : undefined;
    if (existingIndex === undefined) {
      if (key) indexes.set(key, collapsed.length);
      collapsed.push(item);
      continue;
    }
    const existing = collapsed[existingIndex];
    if (existing && narrationPriority(item) > narrationPriority(existing)) {
      collapsed[existingIndex] = item;
    }
  }
  return collapsed;
}

function suppressRedundantReasoningPlaceholders(
  items: TimelineItem[],
): TimelineItem[] {
  const meaningfulTurns = new Set<string>();
  for (const item of items) {
    if (
      item.turnId &&
      ((item.kind === "message" &&
        item.role === "assistant" &&
        Boolean(item.text.trim())) ||
        (isActivityItem(item) && item.kind !== "reasoning"))
    )
      meaningfulTurns.add(item.turnId);
  }
  return items.filter(
    (item) =>
      item.kind !== "reasoning" ||
      Boolean(item.text.trim()) ||
      (isActivelyPending(item) &&
        (!item.turnId || !meaningfulTurns.has(item.turnId))),
  );
}

function orderCompletedTurnActivities(
  items: TimelineItem[],
  runtimeWorking: boolean,
): TimelineItem[] {
  if (items.length < 2) return items;
  const sourceSegments: number[] = [];
  const turnSegments = new Map<string, number>();
  let segment = -1;
  for (const item of items) {
    if (item.role === "user") segment += 1;
    const source = Math.max(0, segment);
    sourceSegments.push(source);
    if (item.turnId && !turnSegments.has(item.turnId)) {
      turnSegments.set(item.turnId, source);
    }
  }
  const segments = Array.from(
    { length: Math.max(1, segment + 1) },
    () => [] as TimelineItem[],
  );
  items.forEach((item, index) => {
    const source = sourceSegments[index] ?? 0;
    const target =
      item.role === "user" || !item.turnId
        ? source
        : (turnSegments.get(item.turnId) ?? source);
    segments[target]?.push(item);
  });
  return segments.flatMap((turnItems, segmentIndex) => {
    let finalIndex = -1;
    for (let index = turnItems.length - 1; index >= 0; index -= 1) {
      const item = turnItems[index];
      if (
        item?.role === "assistant" &&
        item.kind === "message" &&
        item.phase !== "commentary"
      ) {
        finalIndex = index;
        break;
      }
    }
    if (finalIndex < 0) return turnItems;
    const trailing = turnItems.slice(finalIndex + 1);
    const lateActivities = trailing.filter(isActivityItem);
    if (
      lateActivities.length === 0 ||
      (runtimeWorking &&
        segmentIndex === segments.length - 1 &&
        lateActivities.some(isActivelyPending))
    )
      return turnItems;
    return [
      ...turnItems.slice(0, finalIndex),
      ...lateActivities,
      turnItems[finalIndex]!,
      ...trailing.filter((item) => !isActivityItem(item)),
    ];
  });
}

function groupTimelineItems(items: TimelineItem[]): TurnRenderBlock[] {
  const blocks: TurnRenderBlock[] = [];
  for (const item of items) {
    const activity = isActivityItem(item);
    const previous = blocks.at(-1);
    if (
      activity &&
      previous?.kind === "activity" &&
      previous.items.at(-1)?.turnId === item.turnId
    ) {
      previous.items.push(item);
      continue;
    }
    blocks.push(
      activity
        ? { id: `activity-${item.id}`, kind: "activity", items: [item] }
        : { id: item.id, kind: "item", items: [item] },
    );
  }
  return blocks;
}

function narrationKey(item: TimelineItem): string | undefined {
  if (
    item.role !== "assistant" ||
    (item.kind !== "message" && item.kind !== "reasoning") ||
    !item.turnId ||
    !item.text.trim()
  )
    return undefined;
  const text = item.text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return text ? `${item.turnId}\u0000${text}` : undefined;
}

function narrationPriority(item: TimelineItem): number {
  if (item.kind === "reasoning") return 1;
  if (item.phase === "final_answer") return 4;
  if (item.phase === "commentary") return 3;
  return 2;
}

function duplicateCommandKey(item: TimelineItem): string | undefined {
  if (item.kind !== "command" || !item.turnId) return undefined;
  const legacyCommand =
    item.meta && /\s/.test(String(item.meta).trim())
      ? String(item.meta)
      : undefined;
  const command = canonicalCommand(
    item.command ?? legacyCommand ?? String(item.text ?? ""),
  );
  return command ? `${item.turnId}:${command}` : undefined;
}

function canonicalCommand(value: string): string {
  const command = rawActivityText(value).trim();
  const wrapped = command.match(
    /^\/bin\/(?:ba|z|)sh\s+-lc\s+(['"])([\s\S]*)\1$/u,
  );
  return (wrapped?.[2] ?? command).replace(/\s+/g, " ").trim();
}

function rawActivityText(value: string): string {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ⏎ ")
    .replace(/^\$\s*/, "")
    .replace(/\s+/g, " ");
}

function commandTraceScore(item: TimelineItem): number {
  return (
    (item.exitCode !== undefined ? 8 : 0) +
    (item.durationMs !== undefined ? 4 : 0) +
    (item.cwd ? 2 : 0) +
    (item.command ? 1 : 0)
  );
}

function hasFailed(item: TimelineItem): boolean {
  return (
    (item.exitCode !== undefined && item.exitCode !== 0) ||
    /失败|错误|已拒绝/.test(`${item.status ?? ""}${item.title ?? ""}`)
  );
}

function isActivelyPending(item: TimelineItem): boolean {
  return (
    Boolean(item.pending) &&
    !["已完成", "失败", "已取消", "已拒绝"].includes(item.status ?? "")
  );
}

function isActivityItem(item: TimelineItem): boolean {
  return (
    item.kind === "reasoning" ||
    (item.role === "tool" &&
      ["command", "file-change", "tool"].includes(item.kind ?? ""))
  );
}
