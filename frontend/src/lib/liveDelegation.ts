export type LiveDelegationState =
  | "starting"
  | "queued"
  | "running"
  | "waiting-approval"
  | "waiting-input"
  | "completed"
  | "failed"
  | "cancelled";

export interface LiveDelegationTask {
  id: string;
  text: string;
  state: LiveDelegationState;
  detail: string;
  threadId?: string;
  turnId?: string;
  queueId?: string;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type LiveDelegationIntent =
  | { kind: "task" }
  | { kind: "status" }
  | { kind: "cancel" }
  | { kind: "follow-up"; instruction: string };

export type LiveDelegationOutcome = "completed" | "failed" | "cancelled";

export const LIVE_DELEGATION_STORAGE_KEY = "onpeople:live-delegations:v2";

const ACTIVE_STATES = new Set<LiveDelegationState>([
  "starting",
  "queued",
  "running",
  "waiting-approval",
  "waiting-input",
]);

export function isActiveLiveDelegation(task: LiveDelegationTask): boolean {
  return ACTIVE_STATES.has(task.state);
}

export function classifyLiveDelegationIntent(
  value: string,
): LiveDelegationIntent {
  const text = normalize(value);
  if (!text) return { kind: "task" };

  if (
    /^(?:帮我)?(?:查看|查询|说说|告诉我)?(?:一下)?(?:这些|所有|后台|刚才|当前)?(?:任务|工作)?(?:的)?(?:进度|状态|结果)(?:怎么样|如何|呢|吧|\?|？)?$/iu.test(
      text,
    ) ||
    /^(?:what(?:'s| is) the )?(?:task )?(?:status|progress)(?: please)?[?.!]?$/iu.test(
      text,
    )
  ) {
    return { kind: "status" };
  }

  if (
    /^(?:请)?(?:取消|停止|终止|中断)(?:一下)?(?:刚才|当前|后台|那个|这个)?(?:的)?(?:任务|工作|搜索|查询)?[。.!！]?$/iu.test(
      text,
    ) ||
    /^(?:please )?(?:cancel|stop|abort|interrupt)(?: the)?(?: current| last| background)? task[?.!]?$/iu.test(
      text,
    )
  ) {
    return { kind: "cancel" };
  }

  const followUp = text.match(
    /^(?:继续|补充|追加|再告诉|再让|告诉)(?:给)?(?:刚才|当前|后台|那个|这个)?(?:的)?(?:任务|它|他)?[：:，, ]*(.+)$/iu,
  );
  if (followUp?.[1]?.trim()) {
    return { kind: "follow-up", instruction: followUp[1].trim() };
  }
  const englishFollowUp = text.match(
    /^(?:also|continue|follow up|tell (?:it|the task) to)[:, ]+(.+)$/iu,
  );
  if (englishFollowUp?.[1]?.trim()) {
    return { kind: "follow-up", instruction: englishFollowUp[1].trim() };
  }

  return { kind: "task" };
}

export function liveDelegationStateLabel(state: LiveDelegationState): string {
  switch (state) {
    case "starting":
      return "正在创建";
    case "queued":
      return "已排队";
    case "running":
      return "运行中";
    case "waiting-approval":
      return "等待批准";
    case "waiting-input":
      return "等待输入";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

export function liveDelegationStatusSummary(
  tasks: LiveDelegationTask[],
): string {
  const ordered = [...tasks].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const active = ordered.filter(isActiveLiveDelegation);
  if (active.length === 0) {
    const latest = ordered[0];
    if (!latest) return "目前没有后台任务。";
    const result = latest.result?.trim();
    return `目前没有运行中的后台任务。最近的任务“${shortText(latest.text, 48)}”${liveDelegationStateLabel(latest.state)}${result ? `：${shortText(result, 240)}` : "。"}`;
  }
  const lines = active
    .slice(0, 4)
    .map(
      (task, index) =>
        `${index + 1}. “${shortText(task.text, 48)}”：${liveDelegationStateLabel(task.state)}${task.detail ? `，${shortText(task.detail, 80)}` : ""}`,
    );
  const extra =
    active.length > 4 ? ` 另外还有 ${active.length - 4} 个任务。` : "";
  return `当前有 ${active.length} 个后台任务。${lines.join(" ")}${extra}`;
}

export function finalTextFromDelegationTimeline(rows: unknown[]): string {
  const messages: Array<{ text: string; commentary: boolean }> = [];
  for (const raw of rows) {
    const entry = record(raw);
    const item = record(entry.item ?? raw);
    const type = stringValue(item.type);
    if (!["agentMessage", "assistantMessage", "message"].includes(type)) {
      continue;
    }
    const role = stringValue(item.role).toLowerCase();
    if (
      type === "message" &&
      role &&
      role !== "assistant" &&
      role !== "agent"
    ) {
      continue;
    }
    const text = messageText(item).trim();
    if (!text || /^<turn_aborted>/iu.test(text)) continue;
    messages.push({
      text,
      commentary: stringValue(item.phase).toLowerCase() === "commentary",
    });
  }
  return (
    messages.findLast((message) => !message.commentary)?.text ??
    messages.at(-1)?.text ??
    ""
  );
}

export function liveDelegationOutcomeFromResume(
  value: unknown,
  turnId?: string,
): LiveDelegationOutcome | null {
  const root = record(value);
  const thread = record(root.thread ?? root);
  const initialTurnsPage = record(root.initialTurnsPage);
  const candidates = [
    ...(Array.isArray(thread.turns) ? thread.turns : []),
    ...(Array.isArray(initialTurnsPage.data) ? initialTurnsPage.data : []),
  ].map(record);
  const turn =
    (turnId
      ? candidates.find((candidate) => stringValue(candidate.id) === turnId)
      : undefined) ?? candidates.at(-1);
  const status = stringValue(turn?.status).trim().toLowerCase();
  if (["cancelled", "canceled", "interrupted", "aborted"].includes(status)) {
    return "cancelled";
  }
  if (["failed", "error"].includes(status)) return "failed";
  if (["completed", "complete"].includes(status)) return "completed";
  return null;
}

export function describeLiveRuntimeItem(value: unknown): string {
  const item = record(value);
  const type = stringValue(item.type);
  if (type === "commandExecution") return "正在运行命令";
  if (type === "fileChange" || type === "applyPatch") return "正在修改文件";
  if (type === "webSearch") return "正在搜索网页";
  if (type === "reasoning") return "正在分析";
  if (type === "collabAgentToolCall" || type === "subAgentActivity") {
    return "正在协调子 Agent";
  }
  if (type === "computerAction") return "正在操作电脑";
  if (type === "dynamicToolCall" || type === "mcpToolCall") {
    const tool = stringValue(item.tool ?? item.name);
    return tool ? `正在使用 ${tool}` : "正在使用工具";
  }
  return "正在执行";
}

export function loadLiveDelegations(
  storage: Storage | null,
): LiveDelegationTask[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(
      storage.getItem(LIVE_DELEGATION_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeStoredTask)
      .filter((task): task is LiveDelegationTask => task !== null)
      .slice(-24);
  } catch {
    return [];
  }
}

export function saveLiveDelegations(
  storage: Storage | null,
  tasks: LiveDelegationTask[],
): void {
  if (!storage) return;
  try {
    storage.setItem(
      LIVE_DELEGATION_STORAGE_KEY,
      JSON.stringify(
        [...tasks]
          .sort((left, right) => left.createdAt - right.createdAt)
          .slice(-24),
      ),
    );
  } catch {
    // A full or disabled local storage must never break Live itself.
  }
}

function normalizeStoredTask(value: unknown): LiveDelegationTask | null {
  const task = record(value);
  const id = stringValue(task.id).trim();
  const text = stringValue(task.text).trim();
  const state = stringValue(task.state) as LiveDelegationState;
  if (
    !id ||
    !text ||
    (!ACTIVE_STATES.has(state) &&
      !["completed", "failed", "cancelled"].includes(state))
  ) {
    return null;
  }
  const createdAt = Number(task.createdAt);
  const updatedAt = Number(task.updatedAt);
  return {
    id,
    text,
    state,
    detail: stringValue(task.detail),
    ...(stringValue(task.threadId)
      ? { threadId: stringValue(task.threadId) }
      : {}),
    ...(stringValue(task.turnId) ? { turnId: stringValue(task.turnId) } : {}),
    ...(stringValue(task.queueId)
      ? { queueId: stringValue(task.queueId) }
      : {}),
    ...(stringValue(task.result) ? { result: stringValue(task.result) } : {}),
    ...(stringValue(task.error) ? { error: stringValue(task.error) } : {}),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function messageText(item: Record<string, unknown>): string {
  const direct = stringValue(item.text);
  if (direct) return direct;
  const content = item.content ?? item.output ?? item.message;
  if (Array.isArray(content)) {
    return content
      .map((part) => stringValue(record(part).text ?? part))
      .filter(Boolean)
      .join("");
  }
  return stringValue(content);
}

function shortText(value: string, max: number): string {
  const text = normalize(value);
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
