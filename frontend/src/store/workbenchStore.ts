import { create } from "zustand";

import { desktopClient } from "../lib/desktopClient";
import { isCloudAccountState } from "../lib/cloudAccount";
import { errorMessage } from "../lib/errors";
import type {
  AgentStatus,
  BrowserState,
  EventEnvelope,
  Goal,
  LocalArtifactPreviewRequest,
  Preferences,
  PrimaryView,
  PromptOptions,
  PromptSubmission,
  QueuedMessage,
  RuntimeSnapshot,
  SchedulerSnapshot,
  SettingsRoute,
  ThreadList,
  TimelineAttachment,
  TimelineItem,
  ToolView,
} from "../types";

const emptyThreads: ThreadList = { threads: [], projects: [] };

const defaultPreferences: Preferences = {
  theme: "system",
  density: "comfortable",
  reduceMotion: false,
  showComposerFooter: true,
  showSuggestions: true,
  defaultFileOpener: "smart",
  browserOpenLinks: "internal",
  browserEnabled: true,
  liveVoice: "cove",
  downloadDirectory: null,
  customInstructions: "",
  sidebarWidth: 275,
  utilityWidth: 560,
  terminalHeight: 300,
};

export type ThreadActivityStatus =
  | "idle"
  | "working"
  | "waiting-approval"
  | "waiting-input"
  | "error";

interface WorkbenchStore {
  initialized: boolean;
  loading: boolean;
  threadLoading: boolean;
  runtimeRetrying: boolean;
  sendingPrompt: boolean;
  error: string | null;
  status: AgentStatus | null;
  preferences: Preferences;
  threadList: ThreadList;
  selectedThreadId: string | null;
  runtime: RuntimeSnapshot | null;
  scheduler: SchedulerSnapshot;
  browser: BrowserState | null;
  timeline: TimelineItem[];
  queuedMessages: QueuedMessage[];
  /** Last known live trace for each task, retained while switching tasks. */
  timelineByThread: Record<string, TimelineItem[]>;
  turnStartedAt: Record<string, string>;
  turnDurations: Record<string, number>;
  threadActivity: Record<string, ThreadActivityStatus>;
  utilityOpen: boolean;
  toolView: ToolView;
  localArtifactPreview: LocalArtifactPreviewRequest | null;
  primaryView: PrimaryView;
  settingsOpen: boolean;
  settingsRoute: SettingsRoute;
  showingArchived: boolean;
  search: string;
  draftCwd: string | null;
  initialize: () => Promise<void>;
  reconnectRuntime: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  refreshScheduler: () => Promise<void>;
  selectThread: (id: string | null) => Promise<void>;
  setSearch: (value: string) => void;
  setToolView: (view: ToolView) => void;
  showLocalArtifact: (path: string, threadId?: string | null) => Promise<void>;
  closeLocalArtifact: () => void;
  setPrimaryView: (view: PrimaryView) => void;
  setUtilityOpen: (value: boolean) => void;
  setSettingsOpen: (value: boolean, route?: SettingsRoute) => void;
  setSettingsRoute: (route: SettingsRoute) => void;
  setShowingArchived: (value: boolean) => void;
  savePreferences: (value: Preferences) => Promise<void>;
  sendPrompt: (
    text: string,
    options?: PromptOptions,
  ) => Promise<PromptSubmission | null>;
  queueMessage: (text: string) => Promise<void>;
  deleteQueuedMessage: (queueId: string) => Promise<void>;
  steerQueuedMessage: (queueId: string) => Promise<void>;
  resolveApproval: (requestId: string, decision: string) => Promise<void>;
  resolveUserInput: (
    requestId: string,
    answers: Record<string, string[]>,
  ) => Promise<void>;
  interrupt: () => Promise<void>;
  newTask: (cwd?: string) => void;
}

let subscriptionsStarted = false;
let initializationStarted = false;
let runtimeStartPromise: Promise<void> | null = null;
let threadSelectionRequest = 0;
const autoNamingThreadIds = new Set<string>();

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function queuedMessagesFromContext(value: unknown): QueuedMessage[] {
  const context = record(value);
  const source = Array.isArray(context.queuedMessages)
    ? context.queuedMessages
    : Array.isArray(context.queued)
      ? context.queued
      : [];
  return source.reduce<QueuedMessage[]>((messages, entry) => {
    const item = record(entry);
    const id = textValue(item.id).trim();
    const threadId = textValue(item.threadId).trim();
    const text = textValue(item.text).trim();
    if (!id || !threadId || !text) return messages;
    messages.push({
      id,
      threadId,
      text,
      queuedAt: textValue(item.queuedAt) || undefined,
      status: "queued",
    });
    return messages;
  }, []);
}

function normalizedUserText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？，、；：.!?,;:]$/u, "");
}

function isInternalTimelineMessage(value: string): boolean {
  const text = value.trim();
  return (
    /^<turn_aborted>(?:.|\n|\r)*<\/turn_aborted>$/iu.test(text) ||
    /^<codex_internal_context\b[^>]*>(?:.|\n|\r)*/iu.test(text)
  );
}

interface RuntimeErrorPresentation {
  reconnecting: boolean;
  title: string;
  text: string;
}

function runtimeErrorPresentation(value: unknown): RuntimeErrorPresentation {
  const raw = textValue(value);
  const details = record(value);
  const nested = record(details.codexErrorInfo ?? details.codex_error_info);
  const message = textValue(
    details.message ??
      details.additionalDetails ??
      details.additional_details ??
      nested.message ??
      raw,
  );
  const reconnectMatch = raw.match(
    /Reconnecting\.{0,3}\s*(\d+)\s*\/\s*(\d+)/iu,
  );
  if (reconnectMatch) {
    return {
      reconnecting: true,
      title: "连接不稳定",
      text: `正在重新连接（${reconnectMatch[1]}/${reconnectMatch[2]}）`,
    };
  }
  if (
    /stream disconnected before completion|responseStreamDisconnected/iu.test(
      raw,
    )
  ) {
    return {
      reconnecting: false,
      title: "连接已中断",
      text: "本次回复未完成，可以重新发送。",
    };
  }
  return {
    reconnecting: false,
    title: "运行错误",
    text: message || "任务运行时遇到问题。",
  };
}

function withoutInterruptionArtifacts(items: TimelineItem[]): TimelineItem[] {
  return items.filter(
    (item) =>
      !isInternalTimelineMessage(item.text) &&
      item.id !== "runtime-reconnect-notice",
  );
}

function isPlaceholderThreadTitle(value: string | undefined): boolean {
  const title = value?.trim() ?? "";
  return !title || title === "新任务" || title === "未命名任务";
}

function fallbackThreadTitle(value: string): string {
  return normalizedUserText(value).slice(0, 24) || "新任务";
}

function generatedImagePath(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  if (typeof value === "string") {
    const match = value.match(
      /(?:^|["'\s])([^"'\n]*(?:\.onpeople[\\/]generated-images|generated-images)[^"'\n]*\.(?:png|jpe?g|webp))(?=["'\s,}]|$)/i,
    );
    return match?.[1];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => generatedImagePath(entry, depth + 1))
      .find(Boolean);
  }
  const object = record(value);
  for (const key of ["imagePath", "outputPath"]) {
    const candidate = object[key];
    if (
      typeof candidate === "string" &&
      /\.(?:png|jpe?g|webp)$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  for (const key of ["path", "filePath"]) {
    const candidate = object[key];
    if (
      typeof candidate === "string" &&
      /(?:\.onpeople[\\/]generated-images|generated-images).+\.(?:png|jpe?g|webp)$/i.test(
        candidate,
      )
    ) {
      return candidate;
    }
  }
  return Object.values(object)
    .map((entry) => generatedImagePath(entry, depth + 1))
    .find(Boolean);
}

function attachmentName(path: string, fallback = "附件"): string {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1);
  if (!name) return fallback;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function timelineAttachments(
  images: readonly string[] = [],
  files: readonly string[] = [],
): TimelineAttachment[] {
  return [
    ...images.map((path) => ({
      path,
      name: attachmentName(path, "图片"),
      kind: "image" as const,
    })),
    ...files.map((path) => ({
      path,
      name: attachmentName(path),
      kind: "file" as const,
    })),
  ];
}

function userInputParts(content: unknown): {
  text: string;
  attachments: TimelineAttachment[];
} {
  if (!Array.isArray(content)) return { text: "", attachments: [] };
  const text: string[] = [];
  const attachments: TimelineAttachment[] = [];
  for (const entry of content) {
    const input = record(entry);
    const type = textValue(input.type);
    if (type === "text") {
      const value = textValue(input.text);
      if (value) text.push(value);
      continue;
    }
    if (type === "mention") {
      const path = textValue(input.path);
      const name = textValue(input.name) || attachmentName(path);
      if (path) {
        attachments.push({ path, name, kind: "file" });
      } else if (name) {
        text.push(`@${name}`);
      }
      continue;
    }
    if (type === "skill") {
      const name = textValue(input.name);
      if (name) text.push(`@${name}`);
      continue;
    }
    if (type === "localImage" || type === "image") {
      const path = textValue(input.path ?? input.url);
      if (path) {
        attachments.push({
          path,
          name: attachmentName(path, "图片"),
          kind: "image",
        });
      }
    }
  }
  return { text: text.join("\n"), attachments };
}

function commandsFromExecInput(value: unknown): string[] {
  const input = textValue(value);
  if (!input) return [];
  const commands: string[] = [];
  const pattern =
    /\bexec_command\s*\(\s*\{\s*cmd\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  for (const match of input.matchAll(pattern)) {
    const encoded = match[1];
    if (!encoded) continue;
    const decoded = decodeJavascriptString(encoded);
    if (decoded) commands.push(decoded);
  }
  return commands.length > 0 ? commands : ["exec"];
}

function decodeJavascriptString(value: string): string {
  if (value.startsWith('"')) {
    try {
      return textValue(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  return value
    .slice(1, -1)
    .replace(/\\n/g, "\n")
    .replace(/\\([\\'`])/g, "$1");
}

function statusText(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value : textValue(record(value).type);
  if (!raw) return undefined;
  return (
    (
      {
        completed: "已完成",
        complete: "已完成",
        inProgress: "进行中",
        running: "进行中",
        started: "进行中",
        failed: "失败",
        error: "失败",
        declined: "已拒绝",
        cancelled: "已取消",
      } as Record<string, string>
    )[raw] ?? raw
  );
}

function threadActivityFromStatus(value: unknown): ThreadActivityStatus {
  const raw = textValue(value).trim().toLowerCase();
  if (["active", "working", "running", "inprogress"].includes(raw)) {
    return "working";
  }
  if (["waiting-approval", "waitingonapproval", "approval"].includes(raw)) {
    return "waiting-approval";
  }
  if (["waiting-input", "waitingonuserinput", "input"].includes(raw)) {
    return "waiting-input";
  }
  if (["error", "failed", "systemerror"].includes(raw)) return "error";
  return "idle";
}

function eventActivityStatus(
  method: string,
  params: Record<string, unknown>,
): ThreadActivityStatus | null {
  if (method === "turn/started" || method === "queued-message-started") {
    return "working";
  }
  if (method === "turn/completed") {
    const turn = record(params.turn);
    return turn.error ? "error" : "idle";
  }
  if (method === "approval-required") return "waiting-approval";
  if (method === "user-input-required") return "waiting-input";
  if (method === "thread/status/changed") {
    const status = record(params.status);
    const statusType = textValue(status.type);
    const activeFlags = Array.isArray(status.activeFlags)
      ? status.activeFlags.map(textValue).join(" ")
      : "";
    const combined = `${statusType} ${activeFlags}`.toLowerCase();
    if (combined.includes("waitingonapproval")) return "waiting-approval";
    if (combined.includes("waitingonuserinput")) return "waiting-input";
    if (combined.includes("active") || combined.includes("working")) {
      return "working";
    }
    if (combined.includes("error") || combined.includes("failed")) {
      return "error";
    }
    return "idle";
  }
  if (method === "error" || method === "warning") {
    const presentation = runtimeErrorPresentation(
      params.message ?? params.error,
    );
    return presentation.reconnecting ? "working" : "error";
  }
  return null;
}

function mergeThreadActivity(
  threadList: ThreadList,
  activity: Record<string, ThreadActivityStatus>,
): ThreadList {
  return {
    ...threadList,
    threads: threadList.threads.map((thread) => {
      const active = activity[thread.id];
      return active && active !== "idle"
        ? { ...thread, status: active }
        : thread;
    }),
  };
}

function eventThreadIdFromPayload(
  payload: Record<string, unknown>,
  envelopeThreadId?: string | null,
): string {
  const params = record(payload.params ?? payload);
  const request = record(payload.request);
  const requestParams = record(request.params);
  return textValue(
    params.threadId ??
      requestParams.threadId ??
      record(requestParams.thread).id ??
      payload.threadId ??
      envelopeThreadId,
  );
}

function isTerminalStatus(value: string | undefined): boolean {
  return (
    value === "已完成" ||
    value === "失败" ||
    value === "已拒绝" ||
    value === "已取消"
  );
}

function goalFromEvent(value: unknown): Goal | null {
  const goal = record(value);
  const threadId = textValue(goal.threadId);
  const objective = textValue(goal.objective);
  if (!threadId || !objective) return null;
  const timestamp = (candidate: unknown) => {
    if (typeof candidate === "string") return candidate;
    const seconds = Number(candidate);
    return Number.isFinite(seconds)
      ? new Date(seconds * 1_000).toISOString()
      : new Date().toISOString();
  };
  const integer = (candidate: unknown) => {
    try {
      return BigInt(Math.max(0, Number(candidate) || 0));
    } catch {
      return 0n;
    }
  };
  return {
    id: `goal-${threadId}`,
    threadId,
    objective,
    status: textValue(goal.status || "active") as Goal["status"],
    tokenBudget:
      goal.tokenBudget === null || goal.tokenBudget === undefined
        ? null
        : integer(goal.tokenBudget),
    tokensUsed: integer(goal.tokensUsed),
    timeUsedSeconds: integer(goal.timeUsedSeconds),
    createdAt: timestamp(goal.createdAt),
    updatedAt: timestamp(goal.updatedAt),
  };
}

function approvalItem(requestValue: unknown): TimelineItem | null {
  const request = record(requestValue);
  const requestId = textValue(request.id);
  if (!requestId) return null;
  const method = textValue(request.method);
  const params = record(request.params);
  const commandValue = params.command ?? params.cmd ?? params.commandLine;
  const command = Array.isArray(commandValue)
    ? commandValue.map(textValue).filter(Boolean).join(" ")
    : textValue(commandValue);
  const reason = textValue(
    params.message ?? params.reason ?? params.explanation,
  );
  const cwd = textValue(params.cwd ?? params.workingDirectory);
  const details = [reason, command, cwd ? `工作目录：${cwd}` : ""]
    .filter(Boolean)
    .join("\n");
  const title = method.includes("applyPatch")
    ? "批准文件修改"
    : method.includes("exec") || method.includes("command")
      ? "批准命令执行"
      : method === "mcpServer/elicitation/request"
        ? "批准电脑操作"
        : "操作需要确认";
  return {
    id: `approval-${requestId}`,
    role: "tool",
    kind: "approval",
    title,
    text: details || "Codex 请求继续执行这项操作。",
    meta: method,
    status: "需要确认",
    pending: true,
    requestId,
    approvalMethod: method,
  };
}

function userInputItem(requestValue: unknown): TimelineItem | null {
  const request = record(requestValue);
  const requestId = textValue(request.id);
  const params = record(request.params);
  if (!requestId || !Array.isArray(params.questions)) return null;
  const questions = params.questions
    .map((raw) => {
      const question = record(raw);
      const id = textValue(question.id);
      const prompt = textValue(question.question);
      if (!id || !prompt) return null;
      return {
        id,
        header: textValue(question.header) || "需要确认",
        question: prompt,
        isOther: Boolean(question.isOther),
        isSecret: Boolean(question.isSecret),
        options: Array.isArray(question.options)
          ? question.options.map((rawOption) => {
              const option = record(rawOption);
              return {
                label: textValue(option.label),
                description: textValue(option.description),
              };
            })
          : [],
      };
    })
    .filter((question) => question !== null);
  if (questions.length === 0) return null;
  return {
    id: `user-input-${requestId}`,
    role: "tool",
    kind: "user-input",
    title: "Codex 需要你的输入",
    text: questions.map((question) => question.question).join("\n"),
    status: "等待回答",
    pending: true,
    requestId,
    userInputQuestions: questions,
  };
}

function itemToTimeline(
  raw: unknown,
  pending = false,
  turnId?: string,
  eventTimestamp?: string,
): TimelineItem | null {
  const item = itemToTimelineBase(raw, pending);
  const source = record(raw);
  const itemTurnId = turnId || textValue(source.turnId);
  const timestamp =
    eventTimestamp ||
    textValue(source.timestamp ?? source.createdAt ?? source.updatedAt);
  if (!item) return null;
  return {
    ...item,
    ...(itemTurnId ? { turnId: itemTurnId } : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

function itemToTimelineBase(
  raw: unknown,
  pending = false,
): TimelineItem | null {
  const item = record(raw);
  const type = textValue(item.type);
  const id = textValue(item.id) || `item-${crypto.randomUUID()}`;
  pending = pending && !isTerminalStatus(statusText(item.status));
  if (type === "userMessage") {
    const { text, attachments } = userInputParts(item.content);
    if (
      (!text && attachments.length === 0) ||
      isInternalTimelineMessage(text)
    ) {
      return null;
    }
    return {
      id,
      role: "user",
      kind: "message",
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
      pending,
    };
  }
  if (type === "agentMessage") {
    const text = textValue(item.text);
    if (!text || isInternalTimelineMessage(text)) return null;
    return {
      id,
      role: "assistant",
      kind: "message",
      text,
      status: textValue(item.phase) || undefined,
      pending,
    };
  }
  // Be tolerant of app-server history produced by older/newer Codex builds.
  // The canonical protocol calls this item `agentMessage`, but compatible
  // servers have also exposed it as `message` with text nested in content.
  if (type === "message" || type === "assistantMessage") {
    const content = item.content ?? item.output ?? item.message;
    const text =
      textValue(item.text) ||
      (Array.isArray(content)
        ? content
            .map((part) => textValue(record(part).text ?? part))
            .filter(Boolean)
            .join("")
        : textValue(content));
    if (!text || isInternalTimelineMessage(text)) return null;
    return {
      id,
      role: "assistant",
      kind: "message",
      text,
      status: textValue(item.phase) || undefined,
      pending,
    };
  }
  if (type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.map(textValue).filter(Boolean).join("\n")
      : "";
    const detail = Array.isArray(item.content)
      ? item.content.map(textValue).filter(Boolean).join("\n")
      : "";
    return {
      id,
      role: "assistant",
      kind: "reasoning",
      title:
        textValue(item.title) ||
        (summary && !summary.includes("\n")
          ? summary.slice(0, 120)
          : pending
            ? "正在思考"
            : "思考过程"),
      text: summary || detail,
      status: statusText(item.status),
      pending,
    };
  }
  if (type === "plan") {
    return {
      id,
      role: "tool",
      kind: "plan",
      title: "执行计划",
      text: textValue(item.text),
      pending,
    };
  }
  if (type === "commandExecution") {
    const command = Array.isArray(item.command)
      ? item.command.map(textValue).filter(Boolean).join(" ")
      : textValue(item.command);
    const output = textValue(item.aggregatedOutput ?? item.output);
    const cwd = textValue(item.cwd);
    const exitCode = finiteNumber(
      item.exitCode ?? item.exit_code ?? record(item.result).exitCode,
    );
    const durationMs = finiteNumber(
      item.durationMs ?? item.duration_ms ?? record(item.result).durationMs,
    );
    return {
      id,
      role: "tool",
      kind: "command",
      title: pending ? "正在运行命令" : "运行命令",
      text: output || command,
      meta: cwd || undefined,
      status: statusText(item.status),
      pending,
      command: command || undefined,
      cwd: cwd || undefined,
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }
  if (
    [
      "fileRead",
      "fileReadResult",
      "readFile",
      "fileSearch",
      "searchFiles",
      "grep",
    ].includes(type)
  ) {
    const path = textValue(
      item.path ?? item.filePath ?? item.filename ?? item.query,
    );
    const output = textValue(item.output ?? item.content ?? item.result);
    const reading = type.toLowerCase().includes("search") || type === "grep";
    return {
      id,
      role: "tool",
      kind: "tool",
      title: pending
        ? reading
          ? "正在搜索文件"
          : "正在读取文件"
        : reading
          ? "已搜索文件"
          : "已读取文件",
      text: output || path,
      meta: path && output ? path : undefined,
      status: statusText(item.status),
      pending,
    };
  }
  if (
    [
      "toolCall",
      "toolInvocation",
      "browserAction",
      "computerAction",
      "applyPatch",
    ].includes(type)
  ) {
    const tool = textValue(item.tool ?? item.name ?? item.action) || "工具调用";
    const target = textValue(item.path ?? item.filePath ?? item.url);
    const result = item.result ?? item.output ?? item.arguments ?? item.input;
    return {
      id,
      role: "tool",
      kind: type === "applyPatch" ? "file-change" : "tool",
      title: pending ? `正在${tool}` : `已${tool}`,
      text: textValue(result) || target,
      meta: target && result ? target : undefined,
      status: statusText(item.status),
      pending,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const files = changes
      .map((change) => {
        const value = record(change);
        return textValue(value.path ?? value.filePath ?? value.name);
      })
      .filter(Boolean);
    const diffStat = record(item.diffStat ?? item.stats);
    const added = Number(
      diffStat.added ?? diffStat.additions ?? item.added ?? item.additions ?? 0,
    );
    const removed = Number(
      diffStat.removed ??
        diffStat.deletions ??
        item.removed ??
        item.deletions ??
        0,
    );
    return {
      id,
      role: "tool",
      kind: "file-change",
      title: pending
        ? "正在修改文件"
        : `已修改 ${files.length || changes.length} 个文件`,
      text: files.join("\n"),
      status: statusText(item.status),
      pending,
      stats: {
        files: files.length || changes.length,
        ...(Number.isFinite(added) && added > 0 ? { added } : {}),
        ...(Number.isFinite(removed) && removed > 0 ? { removed } : {}),
      },
    };
  }
  if (type === "dynamicToolCall" && textValue(item.tool) === "exec") {
    const input = record(item.arguments).input;
    const command = commandsFromExecInput(input).join("\n");
    const result = record(item.result);
    const output =
      textValue(result.output ?? result.stdout ?? item.output) ||
      (Object.keys(result).length === 0 ? textValue(item.result) : "");
    const cwd = textValue(result.workdir ?? result.cwd);
    const exitCode = finiteNumber(
      result.exitCode ?? result.exit_code ?? item.exitCode,
    );
    const durationMs = finiteNumber(
      result.durationMs ?? result.duration_ms ?? item.durationMs,
    );
    return {
      id,
      role: "tool",
      kind: "command",
      title: pending ? "正在运行命令" : "运行命令",
      text: output || command,
      meta: cwd || undefined,
      status: statusText(item.status),
      pending,
      command: command || undefined,
      cwd: cwd || undefined,
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }
  if (type === "mcpToolCall" || type === "dynamicToolCall") {
    const server = textValue(item.server ?? item.namespace);
    const tool = textValue(item.tool) || "工具调用";
    const result =
      item.result ?? item.contentItems ?? item.error ?? item.arguments;
    return {
      id,
      role: "tool",
      kind: "tool",
      title: server ? `${server} · ${tool}` : tool,
      text: textValue(result),
      generatedImagePath: generatedImagePath(result),
      status: statusText(item.status),
      pending,
    };
  }
  if (type === "collabAgentToolCall" || type === "subAgentActivity") {
    const tool = textValue(item.tool);
    const toolLabels: Record<string, [string, string]> = {
      spawnAgent: ["正在创建子 Agent", "已创建子 Agent"],
      sendInput: ["正在向子 Agent 发送指令", "已向子 Agent 发送指令"],
      resumeAgent: ["正在恢复子 Agent", "已恢复子 Agent"],
      wait: ["正在等待子 Agent", "子 Agent 已返回"],
      closeAgent: ["正在停止子 Agent", "已停止子 Agent"],
    };
    const labels = toolLabels[tool] ?? ["Agent 协作进行中", "Agent 协作"];
    const receiverIds = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.map(textValue).filter(Boolean)
      : [];
    const agentStates = record(item.agentsStates);
    const stateSummary = Object.values(agentStates)
      .map((value) => textValue(record(value).status))
      .filter(Boolean)
      .join(" · ");
    return {
      id,
      role: "tool",
      kind: "tool",
      title: pending ? labels[0] : labels[1],
      text:
        textValue(item.prompt ?? item.agentPath ?? item.kind) || stateSummary,
      meta:
        receiverIds.length > 0
          ? `${receiverIds.length} 个子 Agent${stateSummary ? ` · ${stateSummary}` : ""}`
          : undefined,
      status: statusText(item.status),
      pending,
    };
  }
  if (type === "webSearch") {
    return {
      id,
      role: "tool",
      kind: "tool",
      title: "搜索网页",
      text: textValue(item.query ?? item.action ?? "正在检索资料"),
      pending,
    };
  }
  if (type === "contextCompaction") {
    return {
      id,
      role: "system",
      kind: "notice",
      title: "已压缩上下文",
      text: "为继续任务整理了较早的对话内容。",
      pending,
    };
  }
  return null;
}

export function historyFromResume(value: unknown): TimelineItem[] {
  const response = record(value);
  const thread = record(response.thread);
  const page = record(response.initialTurnsPage);
  const turns = Array.isArray(thread.turns)
    ? thread.turns
    : Array.isArray(page.data)
      ? page.data
      : [];
  const resumedItems = turns.flatMap((turn) => {
    const current = record(turn);
    const pending = current.status === "inProgress";
    const turnId = textValue(current.id) || undefined;
    const turnTimestamp = textValue(
      current.createdAt ?? current.startedAt ?? current.updatedAt,
    );
    const seenMessageKeys = new Set<string>();
    return (Array.isArray(current.items) ? current.items : [])
      .map((item) => itemToTimeline(item, pending, turnId, turnTimestamp))
      .filter((item): item is TimelineItem => {
        if (!item) return false;
        // A malformed/older app-server resume can contain the same response
        // item twice inside one turn. Keep repeated messages across turns,
        // but collapse an exact same-role message duplicated by that single
        // turn so reopening a task never renders a second copy.
        if (
          item.kind === "message" &&
          (item.role === "user" || item.role === "assistant")
        ) {
          const key = `${item.role}\u0000${normalizedUserText(item.text)}`;
          if (seenMessageKeys.has(key)) return false;
          seenMessageKeys.add(key);
        }
        return true;
      });
  });
  const persistedItems = Array.isArray(response.onpeopleTimelineItems)
    ? response.onpeopleTimelineItems
        .map((raw) => {
          const entry = record(raw);
          return itemToTimeline(
            entry.item ?? raw,
            false,
            textValue(entry.turnId) || undefined,
            textValue(entry.timestamp ?? entry.createdAt) || undefined,
          );
        })
        .filter((item): item is TimelineItem => item !== null)
    : [];
  const merged =
    persistedItems.length > 0
      ? reconcileRecoveredTimeline(persistedItems, resumedItems)
      : resumedItems;
  return retainOnlyLatestPending(merged);
}

function timestampMilliseconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    }
    return Date.parse(trimmed);
  }
  return Number.NaN;
}

function normalizedTimestamp(value: unknown): string | undefined {
  const milliseconds = timestampMilliseconds(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

export function turnTimingFromResume(value: unknown): {
  turnStartedAt: Record<string, string>;
  turnDurations: Record<string, number>;
} {
  const response = record(value);
  const thread = record(response.thread);
  const page = record(response.initialTurnsPage);
  const turns = Array.isArray(thread.turns)
    ? thread.turns
    : Array.isArray(page.data)
      ? page.data
      : [];
  const turnStartedAt: Record<string, string> = {};
  const turnDurations: Record<string, number> = {};
  for (const raw of turns) {
    const turn = record(raw);
    const id = textValue(turn.id);
    if (!id) continue;
    const startedValue = turn.startedAt ?? turn.createdAt ?? turn.startTime;
    const completedValue = turn.completedAt ?? turn.updatedAt ?? turn.endTime;
    const started = normalizedTimestamp(startedValue);
    if (started) turnStartedAt[id] = started;
    const explicitMilliseconds = Number(turn.durationMs ?? turn.duration_ms);
    const explicitSeconds = Number(
      turn.durationSeconds ?? turn.duration_seconds,
    );
    const startedMs = timestampMilliseconds(startedValue);
    const completedMs = timestampMilliseconds(completedValue);
    if (Number.isFinite(explicitMilliseconds)) {
      turnDurations[id] = Math.max(0, Math.round(explicitMilliseconds / 1_000));
    } else if (Number.isFinite(explicitSeconds)) {
      turnDurations[id] = Math.max(0, Math.round(explicitSeconds));
    } else if (Number.isFinite(startedMs) && Number.isFinite(completedMs)) {
      turnDurations[id] = Math.max(
        0,
        Math.round((completedMs - startedMs) / 1_000),
      );
    }
  }
  return { turnStartedAt, turnDurations };
}

function upsertItem(items: TimelineItem[], item: TimelineItem): TimelineItem[] {
  let index = items.findIndex((entry) => entry.id === item.id);
  if (
    index < 0 &&
    item.kind === "message" &&
    (item.role === "user" || item.role === "assistant")
  ) {
    const normalized = normalizedUserText(item.text);
    for (let candidate = items.length - 1; candidate >= 0; candidate -= 1) {
      const entry = items[candidate];
      if (
        entry &&
        entry.kind === "message" &&
        entry.role === item.role &&
        normalizedUserText(entry.text) === normalized &&
        ((entry.turnId && item.turnId && entry.turnId === item.turnId) ||
          entry.id.startsWith("local-") ||
          item.id.startsWith("local-") ||
          entry.pending ||
          item.pending)
      ) {
        index = candidate;
        break;
      }
    }
  }
  const previous = index >= 0 ? items[index] : undefined;
  // Completion is monotonic. A delayed `item/started` notification must not
  // resurrect an item that a terminal notification already settled.
  if (
    previous &&
    !previous.pending &&
    isTerminalStatus(previous.status) &&
    item.pending
  ) {
    return items;
  }
  if (item.pending) {
    items = settlePreviousPendingItems(items, item.id);
  }
  if (index < 0) return [...items.slice(-399), item];
  const current = items[index];
  if (!current) return [...items.slice(-399), item];
  const next = [...items];
  next[index] = {
    ...current,
    ...item,
    text: item.text || current.text,
    meta: item.meta || current.meta,
    timestamp: item.timestamp ?? current.timestamp,
  };
  return next;
}

function mergeRecoveredTimeline(
  current: TimelineItem[],
  recovered: TimelineItem[],
): TimelineItem[] {
  return recovered.reduce((items, item) => upsertItem(items, item), current);
}

function orderByRecoveredTurns(
  items: TimelineItem[],
  recovered: TimelineItem[],
): TimelineItem[] {
  const turnOrder: string[] = [];
  const seenTurns = new Set<string>();
  for (const item of recovered) {
    if (item.turnId && !seenTurns.has(item.turnId)) {
      seenTurns.add(item.turnId);
      turnOrder.push(item.turnId);
    }
  }
  if (turnOrder.length < 2) return items;

  const turnIndexes = new Map(
    turnOrder.map((turnId, index) => [turnId, index] as const),
  );
  const beforeFirstTurn: TimelineItem[] = [];
  const turns = turnOrder.map(() => [] as TimelineItem[]);
  let activeTurnIndex: number | undefined;

  for (const item of items) {
    const recoveredTurnIndex = item.turnId
      ? turnIndexes.get(item.turnId)
      : undefined;
    if (recoveredTurnIndex !== undefined) {
      activeTurnIndex = recoveredTurnIndex;
      turns[recoveredTurnIndex]?.push(item);
    } else if (activeTurnIndex !== undefined) {
      // Runtime-only notices and traces belong beside the closest preceding
      // recovered turn. This keeps information omitted by thread/resume while
      // still restoring the server's canonical conversation order.
      turns[activeTurnIndex]?.push(item);
    } else {
      beforeFirstTurn.push(item);
    }
  }

  return [...beforeFirstTurn, ...turns.flat()];
}

function reconcileRecoveredTimeline(
  current: TimelineItem[],
  recovered: TimelineItem[],
): TimelineItem[] {
  // Resume history repairs missed messages, but it is not a complete event
  // log: some app-server builds omit reasoning and tool activity once a turn
  // has finished. Merge it into the live timeline instead of replacing the
  // live trace. `upsertItem` semantically deduplicates streamed and persisted
  // messages whose IDs differ.
  return orderByRecoveredTurns(
    mergeRecoveredTimeline(current, recovered),
    recovered,
  );
}

export function completeTurnTimeline(
  items: TimelineItem[],
  turnId: string,
): TimelineItem[] {
  return items.map((item) => {
    if (!item.pending || (item.turnId && item.turnId !== turnId)) return item;
    return completeTimelineItem(item);
  });
}

export function assignTurnIdToLatestTurn(
  items: TimelineItem[],
  turnId: string,
): TimelineItem[] {
  if (!turnId) return items;
  let latestUserIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return items;
  return items.map((item, index) =>
    index >= latestUserIndex && !item.turnId ? { ...item, turnId } : item,
  );
}

export function attachQueuedMessageToTurn(
  items: TimelineItem[],
  queuedMessages: QueuedMessage[],
  threadId: string,
  turnId: string,
  timestamp: string,
): { timeline: TimelineItem[]; queuedMessages: QueuedMessage[] } {
  const queued = queuedMessages.find(
    (message) => message.threadId === threadId && message.status !== "failed",
  );
  if (!queued) return { timeline: items, queuedMessages };

  const anchor: TimelineItem = {
    id: `queued-user-${queued.id}`,
    queueId: queued.id,
    turnId,
    role: "user",
    kind: "message",
    text: queued.text,
    timestamp: queued.queuedAt ?? timestamp,
  };
  return {
    timeline: upsertItem(items, anchor),
    queuedMessages: queuedMessages.filter(
      (message) => message.id !== queued.id,
    ),
  };
}

function settlePreviousPendingItems(
  items: TimelineItem[],
  currentId: string,
): TimelineItem[] {
  return items.map((entry) =>
    entry.id !== currentId && entry.pending && !isTerminalStatus(entry.status)
      ? completeTimelineItem(entry)
      : entry,
  );
}

export function retainOnlyLatestPending(items: TimelineItem[]): TimelineItem[] {
  let latestPendingIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.pending && !isTerminalStatus(item.status)) {
      latestPendingIndex = index;
      break;
    }
  }
  if (latestPendingIndex < 0) return items;
  return items.map((item, index) =>
    index !== latestPendingIndex &&
    item.pending &&
    !isTerminalStatus(item.status)
      ? completeTimelineItem(item)
      : item,
  );
}

function completeTimelineItem(
  item: TimelineItem,
  status = item.status === "进行中" || !item.status ? "已完成" : item.status,
): TimelineItem {
  let title = item.title;
  if (item.kind === "reasoning") {
    title = "思考过程";
  } else if (item.kind === "command") {
    title = "运行命令";
  } else if (item.kind === "file-change") {
    const files = item.stats?.files ?? 0;
    title = files > 0 ? `已修改 ${files} 个文件` : "已修改文件";
  } else if (title?.startsWith("正在")) {
    title = `已${title.slice(2)}`;
  }

  return { ...item, title, pending: false, status };
}

export { reconcileRecoveredTimeline };

function appendDelta(
  items: TimelineItem[],
  id: string,
  delta: string,
  fallback: TimelineItem,
): TimelineItem[] {
  const existingIndex = items.findIndex((item) => item.id === id);
  const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
  if (existing && !existing.pending && isTerminalStatus(existing.status)) {
    return items;
  }
  items = settlePreviousPendingItems(items, id);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return [...items.slice(-399), { ...fallback, text: delta }];
  const next = [...items];
  const current = next[index];
  if (!current) return [...items.slice(-399), { ...fallback, text: delta }];
  next[index] = {
    ...current,
    turnId: current.turnId ?? fallback.turnId,
    timestamp: current.timestamp ?? fallback.timestamp,
    text: `${current.text}${delta}`,
  };
  return next;
}

function applyTheme(preferences: Preferences) {
  const theme =
    preferences.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preferences.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preferences.theme;
  document.documentElement.dataset.density = preferences.density;
  document.documentElement.classList.toggle(
    "reduce-motion",
    preferences.reduceMotion,
  );
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  initialized: false,
  loading: true,
  threadLoading: false,
  runtimeRetrying: false,
  sendingPrompt: false,
  error: null,
  status: null,
  preferences: defaultPreferences,
  threadList: emptyThreads,
  selectedThreadId: null,
  runtime: null,
  scheduler: { tasks: [], runs: [], unread: 0 },
  browser: null,
  timeline: [],
  queuedMessages: [],
  timelineByThread: {},
  turnStartedAt: {},
  turnDurations: {},
  threadActivity: {},
  utilityOpen: true,
  toolView: "activity",
  localArtifactPreview: null,
  primaryView: "tasks",
  settingsOpen: false,
  settingsRoute: "general",
  showingArchived: false,
  search: "",
  draftCwd: null,

  initialize: async () => {
    if (get().initialized || initializationStarted) return;
    initializationStarted = true;
    set({ loading: true, error: null });
    try {
      const results = await Promise.allSettled([
        desktopClient.agentStatus(),
        desktopClient.getPreferences(),
        desktopClient.listThreads(),
        desktopClient.runtimeSnapshot(),
        desktopClient.scheduler(),
        desktopClient.browserState(),
      ] as const);
      const [
        statusResult,
        preferencesResult,
        threadListResult,
        runtimeResult,
        schedulerResult,
        browserResult,
      ] = results;
      const status =
        statusResult.status === "fulfilled" ? statusResult.value : null;
      const preferences =
        preferencesResult.status === "fulfilled"
          ? preferencesResult.value
          : defaultPreferences;
      const threadList =
        threadListResult.status === "fulfilled"
          ? threadListResult.value
          : emptyThreads;
      const runtime =
        runtimeResult.status === "fulfilled" ? runtimeResult.value : null;
      const scheduler =
        schedulerResult.status === "fulfilled"
          ? schedulerResult.value
          : { tasks: [], runs: [], unread: 0 };
      const browser =
        browserResult.status === "fulfilled" ? browserResult.value : null;
      const threadActivity = Object.fromEntries(
        threadList.threads.map((thread) => [
          thread.id,
          threadActivityFromStatus(thread.status),
        ]),
      ) as Record<string, ThreadActivityStatus>;
      const initialError = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      set({
        status,
        preferences,
        threadList,
        runtime,
        scheduler,
        browser,
        threadActivity,
        draftCwd: null,
        initialized: true,
        loading: false,
        error: initialError ? errorMessage(initialError.reason) : null,
      });
      applyTheme(preferences);
      if (!subscriptionsStarted) {
        subscriptionsStarted = true;
        await desktopClient
          .onRuntimeEvent((event: EventEnvelope) => {
            const payload = record(event.payload);
            const method = textValue(payload.method || payload.type);
            const params = record(payload.params ?? payload);
            const eventThreadId = eventThreadIdFromPayload(
              payload,
              event.threadId,
            );
            const selectedThreadId = get().selectedThreadId;

            const activity = eventActivityStatus(method, params);
            if (eventThreadId && activity) {
              set((state) => {
                const threadActivity = {
                  ...state.threadActivity,
                  [eventThreadId]: activity,
                };
                return {
                  threadActivity,
                  threadList: mergeThreadActivity(
                    state.threadList,
                    threadActivity,
                  ),
                };
              });
            }

            if (
              method.startsWith("thread/") &&
              (method.includes("updated") ||
                method.includes("archived") ||
                method.includes("unarchived") ||
                method.includes("status"))
            ) {
              void get().refreshThreads();
            }

            if (method === "thread/name/updated") {
              const name = textValue(params.threadName ?? params.name).trim();
              if (eventThreadId && name) {
                set((state) => ({
                  threadList: {
                    ...state.threadList,
                    threads: state.threadList.threads.map((thread) =>
                      thread.id === eventThreadId
                        ? { ...thread, title: name }
                        : thread,
                    ),
                  },
                }));
              }
            }

            if (
              selectedThreadId &&
              eventThreadId &&
              selectedThreadId !== eventThreadId
            ) {
              return;
            }

            if (method === "thread/goal/updated") {
              const goal = goalFromEvent(params.goal);
              if (!goal) return;
              set((state) => ({
                status: state.status ? { ...state.status, goal } : state.status,
              }));
              return;
            }
            if (method === "thread/goal/cleared") {
              set((state) => ({
                status: state.status
                  ? { ...state.status, goal: null }
                  : state.status,
              }));
              return;
            }
            if (method === "thread/tokenUsage/updated") {
              set((state) => ({
                runtime: state.runtime
                  ? {
                      ...state.runtime,
                      context: (params.tokenUsage ??
                        null) as RuntimeSnapshot["context"],
                    }
                  : state.runtime,
              }));
              return;
            }

            if (method === "approval-required") {
              const item = approvalItem(payload.request);
              if (!item) return;
              set((state) => ({
                runtime: {
                  ...(state.runtime ?? {
                    threadId: selectedThreadId,
                    turnId: null,
                    queuedMessages: 0,
                    pendingApprovals: 0,
                    context: null,
                  }),
                  state: "waiting-approval",
                  pendingApprovals: (state.runtime?.pendingApprovals ?? 0) + 1,
                },
                timeline: upsertItem(state.timeline, item),
              }));
              return;
            }
            if (method === "user-input-required") {
              const item = userInputItem(payload.request);
              if (!item) return;
              set((state) => ({
                runtime: {
                  ...(state.runtime ?? {
                    threadId: selectedThreadId,
                    turnId: null,
                    queuedMessages: 0,
                    pendingApprovals: 0,
                    context: null,
                  }),
                  state: "waiting-input",
                },
                timeline: upsertItem(state.timeline, item),
              }));
              return;
            }
            if (method === "unsupported-server-request") {
              const unsupported = record(payload.request);
              set((state) => ({
                timeline: [
                  ...state.timeline,
                  {
                    id: `unsupported-request-${event.sequence}`,
                    role: "error",
                    kind: "notice",
                    title: "无法处理运行时请求",
                    text: textValue(unsupported.method) || "未知请求",
                  },
                ],
              }));
              return;
            }
            if (method === "queued-message-started") {
              const message = record(payload.message);
              const queueId = textValue(message.id);
              const turnId = textValue(payload.turnId);
              const messageText = textValue(message.text);
              set((state) => {
                const anchor: TimelineItem | null = messageText
                  ? {
                      id: `queued-user-${queueId || turnId || event.sequence}`,
                      queueId: queueId || undefined,
                      turnId: turnId || undefined,
                      role: "user",
                      kind: "message",
                      text: messageText,
                      timestamp: textValue(message.queuedAt) || event.emittedAt,
                    }
                  : null;
                return {
                  runtime: state.runtime
                    ? {
                        ...state.runtime,
                        state: "working",
                        turnId: turnId || state.runtime.turnId,
                        queuedMessages:
                          typeof payload.queuedMessages === "number"
                            ? payload.queuedMessages
                            : Math.max(0, state.runtime.queuedMessages - 1),
                      }
                    : state.runtime,
                  timeline: anchor
                    ? upsertItem(state.timeline, anchor)
                    : state.timeline,
                  queuedMessages: queueId
                    ? state.queuedMessages.filter((item) => item.id !== queueId)
                    : state.queuedMessages,
                };
              });
              return;
            }
            if (method === "context-error") {
              const message = textValue(payload.message);
              set((state) => ({
                queuedMessages: state.queuedMessages.map((item) =>
                  textValue(payload.queueId) &&
                  item.id === textValue(payload.queueId)
                    ? { ...item, status: "failed" as const }
                    : item,
                ),
                error: message || "排队消息未能开始执行。",
              }));
              return;
            }

            if (method === "turn/started") {
              const turn = record(params.turn);
              const turnId = textValue(turn.id) || textValue(params.turnId);
              set((state) => {
                const threadId = eventThreadId || state.selectedThreadId || "";
                const shouldAttachQueuedMessage =
                  Boolean(turnId && threadId) &&
                  !state.sendingPrompt &&
                  state.queuedMessages.some(
                    (message) => message.threadId === threadId,
                  ) &&
                  (state.runtime?.state === "queued" || !state.runtime?.turnId);
                const anchored = shouldAttachQueuedMessage
                  ? attachQueuedMessageToTurn(
                      state.timeline,
                      state.queuedMessages,
                      threadId,
                      turnId,
                      event.emittedAt,
                    )
                  : {
                      timeline: state.timeline,
                      queuedMessages: state.queuedMessages,
                    };
                return {
                  runtime: {
                    ...(state.runtime ?? {
                      queuedMessages: 0,
                      pendingApprovals: 0,
                      context: null,
                    }),
                    state: "working",
                    threadId: threadId || null,
                    turnId: textValue(turn.id) || null,
                  },
                  queuedMessages: anchored.queuedMessages,
                  ...(turnId
                    ? {
                        timeline: assignTurnIdToLatestTurn(
                          anchored.timeline,
                          turnId,
                        ),
                        turnStartedAt: {
                          ...state.turnStartedAt,
                          [turnId]: event.emittedAt,
                        },
                      }
                    : {}),
                };
              });
              return;
            }
            if (method === "turn/completed") {
              const turn = record(params.turn);
              const turnId =
                textValue(turn.id) ||
                textValue(params.turnId) ||
                get().runtime?.turnId ||
                "";
              const startedAt = turnId
                ? get().turnStartedAt[turnId]
                : undefined;
              const startedMs = startedAt ? Date.parse(startedAt) : NaN;
              const completedMs = Date.parse(event.emittedAt);
              const durationSeconds =
                Number.isFinite(startedMs) && Number.isFinite(completedMs)
                  ? Math.max(0, Math.round((completedMs - startedMs) / 1000))
                  : undefined;
              const turnError = record(turn.error);
              const turnStatus = textValue(turn.status).toLowerCase();
              set((state) => {
                const attributedTimeline = turnId
                  ? assignTurnIdToLatestTurn(state.timeline, turnId)
                  : state.timeline;
                const completedTimeline = withoutInterruptionArtifacts(
                  completeTurnTimeline(attributedTimeline, turnId),
                );
                const errorPresentation = runtimeErrorPresentation(turnError);
                const interrupted = turnStatus === "interrupted";
                return {
                  runtime: state.runtime
                    ? {
                        ...state.runtime,
                        state:
                          state.runtime.queuedMessages > 0 ? "queued" : "ready",
                        turnId: null,
                      }
                    : state.runtime,
                  timeline:
                    turnError.message && !interrupted
                      ? [
                          ...completedTimeline,
                          {
                            id: `error-${textValue(turn.id) || Date.now()}`,
                            role: "error",
                            kind: "notice",
                            title: errorPresentation.title,
                            text: errorPresentation.text,
                          },
                        ]
                      : completedTimeline,
                  ...(turnId && durationSeconds !== undefined
                    ? {
                        turnDurations: {
                          ...state.turnDurations,
                          [turnId]: durationSeconds,
                        },
                      }
                    : {}),
                };
              });
              void get().refreshThreads();
              // A fast response can finish before the WebView has attached
              // its event listener or before sendPrompt has selected the new
              // thread. Re-read the authoritative thread once completion is
              // observed so the final assistant message cannot disappear.
              if (eventThreadId) {
                void (async () => {
                  try {
                    const resumed =
                      await desktopClient.resumeThread(eventThreadId);
                    const runtime =
                      await desktopClient.runtimeSnapshot(eventThreadId);
                    set((state) =>
                      state.selectedThreadId === eventThreadId
                        ? {
                            runtime,
                            timeline: reconcileRecoveredTimeline(
                              state.timeline,
                              historyFromResume(resumed),
                            ),
                          }
                        : state,
                    );
                  } catch {
                    // The live event path already updated the UI; recovery is
                    // best effort and must not replace a successful response
                    // with a second error notice.
                  }
                })();
              }
              return;
            }
            if (method === "item/started" || method === "item/completed") {
              const eventItem = record(params.item);
              const eventItemId = textValue(
                eventItem.id ?? params.itemId ?? params.id,
              );
              const item = itemToTimeline(
                params.item,
                method === "item/started",
                textValue(params.turnId) ||
                  textValue(eventItem.turnId) ||
                  get().runtime?.turnId ||
                  undefined,
                event.emittedAt,
              );
              if (item) {
                set((state) => ({
                  timeline: upsertItem(state.timeline, item),
                }));
              } else if (method === "item/completed" && eventItemId) {
                const terminalStatus =
                  statusText(eventItem.status ?? params.status) ?? "已完成";
                set((state) => ({
                  timeline: state.timeline.map((entry) =>
                    entry.id === eventItemId
                      ? completeTimelineItem(entry, terminalStatus)
                      : entry,
                  ),
                }));
              }
              return;
            }
            if (
              method === "item/agentMessage/delta" ||
              method === "agent/message/delta"
            ) {
              const id = textValue(
                params.itemId ?? params.messageId ?? params.id,
              );
              const delta = textValue(params.delta);
              set((state) => ({
                timeline: appendDelta(state.timeline, id, delta, {
                  id,
                  role: "assistant",
                  kind: "message",
                  text: "",
                  pending: true,
                  turnId:
                    textValue(params.turnId) ||
                    get().runtime?.turnId ||
                    undefined,
                  timestamp: event.emittedAt,
                }),
              }));
              return;
            }
            if (
              method === "item/reasoning/summaryTextDelta" ||
              method === "item/reasoning/textDelta"
            ) {
              const id = textValue(params.itemId);
              const delta = textValue(params.delta);
              set((state) => ({
                timeline: appendDelta(state.timeline, id, delta, {
                  id,
                  role: "assistant",
                  kind: "reasoning",
                  title: "正在思考",
                  text: "",
                  pending: true,
                  turnId:
                    textValue(params.turnId) ||
                    get().runtime?.turnId ||
                    undefined,
                  timestamp: event.emittedAt,
                }),
              }));
              return;
            }
            if (
              method === "item/commandExecution/outputDelta" ||
              method === "command/exec/outputDelta"
            ) {
              const id = textValue(params.itemId ?? params.processId);
              const delta = textValue(params.delta);
              set((state) => ({
                timeline: appendDelta(state.timeline, id, delta, {
                  id,
                  role: "tool",
                  kind: "command",
                  title: "正在运行命令",
                  text: "",
                  pending: true,
                  turnId:
                    textValue(params.turnId) ||
                    get().runtime?.turnId ||
                    undefined,
                  timestamp: event.emittedAt,
                }),
              }));
              return;
            }
            if (method === "turn/plan/updated") {
              const plan = Array.isArray(params.plan) ? params.plan : [];
              const text = plan
                .map((step) => {
                  const value = record(step);
                  const done = value.status === "completed";
                  return `- [${done ? "x" : " "}] ${textValue(value.step)}`;
                })
                .join("\n");
              const item: TimelineItem = {
                id: `plan-${textValue(params.turnId)}`,
                role: "tool",
                kind: "plan",
                title: "执行计划",
                text,
                pending: plan.some(
                  (step) => record(step).status === "in_progress",
                ),
                turnId:
                  textValue(params.turnId) ||
                  get().runtime?.turnId ||
                  undefined,
                timestamp: event.emittedAt,
              };
              set((state) => ({ timeline: upsertItem(state.timeline, item) }));
              return;
            }
            if (method === "error" || method === "warning") {
              const raw = params.message ?? params.error;
              if (!textValue(raw)) return;
              const presentation = runtimeErrorPresentation(raw);
              const notice: TimelineItem = {
                id: presentation.reconnecting
                  ? "runtime-reconnect-notice"
                  : `${method}-${event.sequence}`,
                role:
                  presentation.reconnecting || method === "warning"
                    ? "system"
                    : "error",
                kind: "notice",
                title: presentation.title,
                text: presentation.text,
              };
              set((state) => ({
                timeline: presentation.reconnecting
                  ? upsertItem(state.timeline, notice)
                  : [...state.timeline, notice],
              }));
            }
          })
          .catch((error) => set({ error: errorMessage(error) }));
        await desktopClient
          .onSchedulerUpdated((value) => set({ scheduler: value }))
          .catch((error) => set({ error: errorMessage(error) }));
        await desktopClient
          .onBrowserState((value) => set({ browser: value }))
          .catch((error) => set({ error: errorMessage(error) }));
        // The Browser Host can become ready after the initial snapshot but before
        // this listener is installed. Re-read once after subscribing so that a
        // startup transition cannot be lost and leave the UI showing stale state.
        await desktopClient
          .browserState()
          .then((value) => set({ browser: value }))
          .catch((error) => set({ error: errorMessage(error) }));
        await desktopClient
          .onCloudAccountUpdated(async (account) => {
            if (!isCloudAccountState(account)) return;
            if (account.signedIn) {
              await get().reconnectRuntime();
              return;
            }
            try {
              const [status, runtime] = await Promise.all([
                desktopClient.agentStatus(),
                desktopClient.runtimeSnapshot(get().selectedThreadId),
              ]);
              set({ status, runtime, error: null });
            } catch (error) {
              set({ error: errorMessage(error) });
            }
          })
          .catch((error) => set({ error: errorMessage(error) }));
      }
      void get().reconnectRuntime();
    } catch (error) {
      set({
        initialized: true,
        loading: false,
        error: errorMessage(error),
      });
    }
  },

  reconnectRuntime: async () => {
    if (get().runtimeRetrying) return;
    if (runtimeStartPromise) return runtimeStartPromise;
    const run = (async () => {
      set({ runtimeRetrying: true, error: null });
      try {
        await desktopClient.startRuntime();
        const [status, runtime, threadList] = await Promise.all([
          desktopClient.agentStatus(),
          desktopClient.runtimeSnapshot(get().selectedThreadId),
          desktopClient.listThreads({
            query: get().search,
            archived: get().showingArchived,
          }),
        ]);
        set((state) => ({
          status,
          runtime,
          threadList,
          draftCwd: state.draftCwd,
          error: null,
        }));
      } catch (error) {
        set({ error: errorMessage(error) });
      } finally {
        set({ runtimeRetrying: false });
      }
    })();
    runtimeStartPromise = run;
    try {
      await run;
    } finally {
      if (runtimeStartPromise === run) runtimeStartPromise = null;
    }
  },

  refreshThreads: async () => {
    const { search, showingArchived } = get();
    const threadList = await desktopClient.listThreads({
      query: search,
      archived: showingArchived,
    });
    set((state) => ({
      threadList: mergeThreadActivity(threadList, state.threadActivity),
    }));
  },

  refreshScheduler: async () => {
    const scheduler = await desktopClient.scheduler();
    set({ scheduler });
  },

  selectThread: async (id) => {
    if (!id) {
      get().newTask();
      return;
    }
    const current = get();
    if (current.selectedThreadId === id && !current.threadLoading) return;
    const requestId = ++threadSelectionRequest;
    const selectedThread = current.threadList.threads.find(
      (thread) => thread.id === id,
    );
    const cachedTimeline = current.timelineByThread[id] ?? [];
    set((state) => ({
      selectedThreadId: id,
      draftCwd: selectedThread?.cwd ?? selectedThread?.projectPath ?? null,
      primaryView: "tasks",
      utilityOpen: true,
      toolView: "activity",
      localArtifactPreview: null,
      // Keep a previously loaded task visible while its authoritative history
      // is refreshed. The old implementation blanked the whole timeline and
      // made every switch look like a cold startup.
      threadLoading: cachedTimeline.length === 0,
      timeline: cachedTimeline,
      queuedMessages: [],
      turnStartedAt: {},
      turnDurations: {},
      error: null,
      timelineByThread:
        state.selectedThreadId && state.selectedThreadId !== id
          ? {
              ...state.timelineByThread,
              [state.selectedThreadId]: state.timeline,
            }
          : state.timelineByThread,
    }));
    try {
      // Match Codex's task switching model: paint the durable local trace first,
      // then reconcile with the slower app-server resume in the background.
      // This avoids turning every first visit after an app restart into a blank
      // full-page loading state.
      const resumePromise = desktopClient.resumeThread(id);
      const runtimePromise = desktopClient.runtimeSnapshot(id);
      if (cachedTimeline.length === 0) {
        try {
          const persisted = historyFromResume({
            onpeopleTimelineItems: await desktopClient.threadTimeline(id),
          });
          if (persisted.length > 0) {
            set((state) => {
              const merged = reconcileRecoveredTimeline(
                state.timelineByThread[id] ?? [],
                persisted,
              );
              const timelineByThread = {
                ...state.timelineByThread,
                [id]: merged,
              };
              if (
                requestId !== threadSelectionRequest ||
                state.selectedThreadId !== id
              ) {
                return { timelineByThread };
              }
              return {
                timeline: merged,
                timelineByThread,
                threadLoading: false,
              };
            });
          }
        } catch {
          // The authoritative resume below remains the fallback for older
          // installations that do not have a persisted trace yet.
        }
      }
      const [resumed, runtime, contextState] = await Promise.all([
        resumePromise,
        runtimePromise,
        desktopClient.getContextState(id),
      ]);
      const timing = turnTimingFromResume(resumed);
      const recovered = historyFromResume(resumed);
      set((state) => {
        const baseTimeline =
          state.selectedThreadId === id
            ? state.timeline
            : (state.timelineByThread[id] ?? []);
        const merged = reconcileRecoveredTimeline(baseTimeline, recovered);
        const timelineByThread = {
          ...state.timelineByThread,
          [id]: merged,
        };
        if (
          requestId !== threadSelectionRequest ||
          state.selectedThreadId !== id
        ) {
          return { timelineByThread };
        }
        return {
          runtime,
          queuedMessages: queuedMessagesFromContext(contextState),
          timeline: merged,
          timelineByThread,
          ...timing,
          threadLoading: false,
        };
      });
    } catch (error) {
      if (requestId === threadSelectionRequest) {
        set({ threadLoading: false, error: errorMessage(error) });
      }
    }
  },

  setSearch: (search) => {
    set({ search });
    void get().refreshThreads();
  },

  setToolView: (toolView) => set({ toolView, utilityOpen: true }),
  showLocalArtifact: async (path, threadId) => {
    const state = get();
    if (state.preferences.defaultFileOpener === "system") {
      await desktopClient.openLocalArtifact(path, threadId);
      return;
    }
    set({
      localArtifactPreview: {
        id: crypto.randomUUID(),
        path,
        threadId: threadId ?? state.selectedThreadId,
      },
      toolView: "browser",
      utilityOpen: true,
    });
  },
  closeLocalArtifact: () => set({ localArtifactPreview: null }),
  setPrimaryView: (primaryView) => set({ primaryView }),
  setUtilityOpen: (utilityOpen) => set({ utilityOpen }),
  setSettingsOpen: (settingsOpen, route) =>
    set((state) => ({
      settingsOpen,
      settingsRoute: route ?? state.settingsRoute,
    })),
  setSettingsRoute: (settingsRoute) => set({ settingsRoute }),
  setShowingArchived: (showingArchived) => {
    set({ showingArchived });
    void get().refreshThreads();
  },

  savePreferences: async (preferences) => {
    const saved = await desktopClient.savePreferences(preferences);
    applyTheme(saved);
    set({ preferences: saved });
  },

  sendPrompt: async (text, options = {}) => {
    const value = text.trim();
    const images = options.images ?? [];
    const attachments = options.attachments ?? [];
    if (!value && images.length === 0 && attachments.length === 0) return null;
    if (get().sendingPrompt) return null;
    const { selectedThreadId, runtime, draftCwd, threadList } = get();
    const selectedThread = selectedThreadId
      ? threadList.threads.find((thread) => thread.id === selectedThreadId)
      : undefined;
    const shouldAutoName =
      !selectedThreadId || isPlaceholderThreadTitle(selectedThread?.title);
    const optimisticId = `local-${crypto.randomUUID()}`;
    const optimistic: TimelineItem = {
      id: optimisticId,
      role: "user",
      kind: "message",
      text: value,
      attachments: timelineAttachments(images, attachments),
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      sendingPrompt: true,
      timeline: [...state.timeline, optimistic],
      runtime: {
        ...(runtime ?? {
          threadId: selectedThreadId,
          turnId: null,
          queuedMessages: 0,
          pendingApprovals: 0,
          context: null,
        }),
        state: "working",
      },
      ...(selectedThreadId
        ? {
            threadActivity: {
              ...state.threadActivity,
              [selectedThreadId]: "working" as const,
            },
          }
        : {}),
      error: null,
    }));
    try {
      const submission = await desktopClient.sendPrompt({
        threadId: selectedThreadId,
        text: value || "请查看我附加的文件。",
        cwd: draftCwd,
        workspaceMode: draftCwd ? "local" : "isolated",
        ...(options.images ? { images: options.images } : {}),
        ...(options.attachments ? { attachments: options.attachments } : {}),
        ...(options.capability !== undefined
          ? { capability: options.capability }
          : {}),
        ...(options.industryPlugin !== undefined
          ? { industryPlugin: options.industryPlugin }
          : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.reasoningEffort !== undefined
          ? { reasoningEffort: options.reasoningEffort }
          : {}),
      });
      set((state) => ({
        sendingPrompt: false,
        selectedThreadId: submission.threadId,
        timeline: state.timeline.map((item) =>
          item.id === optimisticId
            ? { ...item, turnId: submission.turnId }
            : item,
        ),
        runtime: state.runtime
          ? {
              ...state.runtime,
              threadId: submission.threadId,
              turnId: submission.turnId,
              state: "working",
            }
          : state.runtime,
        threadActivity: {
          ...state.threadActivity,
          [submission.threadId]: "working",
        },
      }));
      if (shouldAutoName && !autoNamingThreadIds.has(submission.threadId)) {
        autoNamingThreadIds.add(submission.threadId);
        void (async () => {
          try {
            const result = await desktopClient.autoNameThread(
              submission.threadId,
              value || attachmentName(images[0] ?? attachments[0] ?? "附件"),
              options.model,
            );
            const title = textValue(record(result).title).trim();
            if (title) {
              set((state) => ({
                threadList: {
                  ...state.threadList,
                  threads: state.threadList.threads.map((thread) =>
                    thread.id === submission.threadId
                      ? { ...thread, title }
                      : thread,
                  ),
                },
              }));
            }
            await get().refreshThreads();
          } catch {
            // Title generation is secondary to the conversation. If the
            // model endpoint is temporarily unavailable, keep the task
            // useful and remove the placeholder name locally.
            try {
              await desktopClient.renameThread(
                submission.threadId,
                fallbackThreadTitle(
                  value ||
                    attachmentName(images[0] ?? attachments[0] ?? "附件"),
                ),
              );
              await get().refreshThreads();
            } catch {
              // The conversation itself already succeeded; title recovery is
              // best effort and must not add another visible error message.
            }
          } finally {
            autoNamingThreadIds.delete(submission.threadId);
          }
        })();
      }
      if (options.mode === "goal") {
        try {
          const goal = await desktopClient.setGoal({
            threadId: submission.threadId,
            objective: value,
            tokenBudget: options.goalTokenBudget ?? null,
          });
          set((state) => ({
            status: state.status ? { ...state.status, goal } : state.status,
          }));
        } catch (goalError) {
          set((state) => ({
            timeline: [
              ...state.timeline,
              {
                id: `goal-error-${Date.now()}`,
                role: "error",
                kind: "notice",
                title: "任务已开始，但目标未启用",
                text: errorMessage(goalError),
              },
            ],
          }));
        }
      }
      await get().refreshThreads();
      // Reconcile the just-submitted thread with Codex. This covers the
      // short-turn race where all deltas and completion notifications arrive
      // before the frontend has selected the newly-created thread.
      const reconcileThread = async () => {
        const resumed = await desktopClient.resumeThread(submission.threadId);
        const timing = turnTimingFromResume(resumed);
        const reconciledRuntime = await desktopClient.runtimeSnapshot(
          submission.threadId,
        );
        set((state) =>
          state.selectedThreadId === submission.threadId
            ? {
                runtime: reconciledRuntime,
                timeline: reconcileRecoveredTimeline(
                  state.timeline,
                  historyFromResume(resumed),
                ),
                ...timing,
              }
            : state,
        );
        return reconciledRuntime;
      };
      try {
        await reconcileThread();
      } catch {
        // Live agent events remain the primary path. Recovery is a fallback
        // and should not turn a displayed response into an error state.
      }
      // A normal Codex turn can finish after the initial reconciliation (the
      // first call may observe an in-progress turn). Keep polling the
      // authoritative thread briefly so a delayed completion cannot leave the
      // composer stuck in “正在工作” when the event bridge was late.
      // Codex responses can legitimately take tens of seconds before their
      // first/final item is committed. Keep the authoritative resume fallback
      // alive long enough to cover that interval when a WebView listener was
      // attached late or an event was coalesced by the native bridge.
      const reconciliationDelays = [
        750, 1_500, 3_000, 6_000, 12_000, 20_000, 30_000, 45_000,
      ];
      let reconciliationAttempt = 0;
      const scheduleReconciliation = () => {
        const delay = reconciliationDelays[reconciliationAttempt++];
        if (delay === undefined) return;
        window.setTimeout(async () => {
          try {
            const reconciledRuntime = await reconcileThread();
            if (
              reconciledRuntime.state === "working" ||
              reconciledRuntime.state === "queued"
            ) {
              scheduleReconciliation();
            }
          } catch {
            scheduleReconciliation();
          }
        }, delay);
      };
      scheduleReconciliation();
      return submission;
    } catch (error) {
      set((state) => ({
        sendingPrompt: false,
        runtime: state.runtime
          ? { ...state.runtime, state: "ready", turnId: null }
          : state.runtime,
        timeline: [
          ...state.timeline,
          {
            id: `error-${Date.now()}`,
            role: "error",
            kind: "notice",
            title: "发送失败",
            text: errorMessage(error),
          },
        ],
      }));
      return null;
    }
  },

  queueMessage: async (text) => {
    const value = text.trim();
    if (!value) return;
    const { selectedThreadId, runtime } = get();
    if (!selectedThreadId) {
      set({ error: "当前任务还不能接收排队消息" });
      return;
    }
    const localId = `queued-local-${crypto.randomUUID()}`;
    set((state) => ({
      queuedMessages: [
        ...state.queuedMessages,
        {
          id: localId,
          threadId: selectedThreadId,
          text: value,
          queuedAt: new Date().toISOString(),
          status: "pending",
        },
      ],
      error: null,
    }));
    try {
      const queued = await desktopClient.queueMessage(value, selectedThreadId);
      const queueId = textValue(queued.id);
      set((state) => ({
        runtime: {
          ...(state.runtime ??
            runtime ?? {
              state: "working",
              threadId: selectedThreadId,
              turnId: null,
              queuedMessages: 0,
              pendingApprovals: 0,
              context: null,
            }),
          queuedMessages: (state.runtime?.queuedMessages ?? 0) + 1,
        },
        threadActivity: {
          ...state.threadActivity,
          [selectedThreadId]: "working",
        },
        queuedMessages: state.queuedMessages.map((item) =>
          item.id === localId
            ? {
                ...item,
                id: queueId || item.id,
                status: "queued" as const,
              }
            : item,
        ),
      }));
    } catch (error) {
      const message = errorMessage(error);
      set((state) => ({
        queuedMessages: state.queuedMessages.map((item) =>
          item.id === localId ? { ...item, status: "failed" as const } : item,
        ),
        error: message,
      }));
    }
  },

  deleteQueuedMessage: async (queueId) => {
    const { selectedThreadId, queuedMessages } = get();
    if (!selectedThreadId) return;
    const index = queuedMessages.findIndex((item) => item.id === queueId);
    if (index < 0) return;
    const message = queuedMessages[index];
    if (!message) return;
    set((state) => ({
      queuedMessages: state.queuedMessages.filter(
        (item) => item.id !== queueId,
      ),
      runtime: state.runtime
        ? {
            ...state.runtime,
            queuedMessages: Math.max(0, state.runtime.queuedMessages - 1),
          }
        : state.runtime,
      error: null,
    }));
    try {
      await desktopClient.deleteQueuedMessage(queueId, selectedThreadId);
    } catch (error) {
      set((state) => {
        const restored = [...state.queuedMessages];
        restored.splice(Math.min(index, restored.length), 0, message);
        return {
          queuedMessages: restored,
          runtime: state.runtime
            ? {
                ...state.runtime,
                queuedMessages: state.runtime.queuedMessages + 1,
              }
            : state.runtime,
          error: errorMessage(error),
        };
      });
    }
  },

  steerQueuedMessage: async (queueId) => {
    const { selectedThreadId } = get();
    if (!selectedThreadId) return;
    set((state) => ({
      queuedMessages: state.queuedMessages.map((item) =>
        item.id === queueId ? { ...item, status: "steering" as const } : item,
      ),
      error: null,
    }));
    try {
      await desktopClient.steerQueuedMessage(queueId, selectedThreadId);
      set((state) => ({
        queuedMessages: state.queuedMessages.filter(
          (item) => item.id !== queueId,
        ),
        runtime: state.runtime
          ? {
              ...state.runtime,
              queuedMessages: Math.max(0, state.runtime.queuedMessages - 1),
            }
          : state.runtime,
      }));
    } catch (error) {
      set((state) => ({
        queuedMessages: state.queuedMessages.map((item) =>
          item.id === queueId ? { ...item, status: "failed" as const } : item,
        ),
        error: errorMessage(error),
      }));
    }
  },

  resolveApproval: async (requestId, decision) => {
    set((state) => ({
      timeline: state.timeline.map((item) =>
        item.requestId === requestId
          ? { ...item, status: "正在提交决定" }
          : item,
      ),
    }));
    try {
      await desktopClient.resolveApproval(requestId, decision);
      const status =
        decision === "decline"
          ? "已拒绝"
          : decision === "acceptForSession"
            ? "本次会话已允许"
            : "已允许一次";
      set((state) => {
        const pendingApprovals = Math.max(
          0,
          (state.runtime?.pendingApprovals ?? 1) - 1,
        );
        return {
          runtime: state.runtime
            ? {
                ...state.runtime,
                state: pendingApprovals > 0 ? "waiting-approval" : "working",
                pendingApprovals,
              }
            : state.runtime,
          timeline: state.timeline.map((item) =>
            item.requestId === requestId
              ? {
                  ...item,
                  pending: false,
                  approvalDecision: decision,
                  status,
                }
              : item,
          ),
        };
      });
    } catch (error) {
      const message = errorMessage(error);
      set((state) => ({
        timeline: state.timeline.map((item) =>
          item.requestId === requestId
            ? {
                ...item,
                pending: true,
                status: "提交失败",
                text: `${item.text}\n\n${message}`,
              }
            : item,
        ),
      }));
    }
  },

  resolveUserInput: async (requestId, answers) => {
    set((state) => ({
      timeline: state.timeline.map((item) =>
        item.requestId === requestId
          ? { ...item, status: "正在提交回答" }
          : item,
      ),
    }));
    try {
      await desktopClient.resolveUserInput(requestId, answers);
      set((state) => ({
        runtime: state.runtime
          ? { ...state.runtime, state: "working" }
          : state.runtime,
        timeline: state.timeline.map((item) =>
          item.requestId === requestId
            ? {
                ...item,
                pending: false,
                status: "已回答",
                userInputAnswers: answers,
              }
            : item,
        ),
      }));
    } catch (error) {
      set((state) => ({
        timeline: state.timeline.map((item) =>
          item.requestId === requestId ? { ...item, status: "提交失败" } : item,
        ),
        error: errorMessage(error),
      }));
    }
  },

  interrupt: async () => {
    const threadId = get().selectedThreadId;
    if (!threadId) return;
    const activeGoal = get().status?.goal;
    let pauseError: unknown;
    if (activeGoal?.threadId === threadId && activeGoal.status === "active") {
      try {
        const goal = await desktopClient.updateGoal({
          threadId,
          action: "pause",
        });
        set((state) => ({
          status: state.status
            ? { ...state.status, goal: goal ?? state.status.goal }
            : state.status,
        }));
      } catch (error) {
        pauseError = error;
      }
    }
    await desktopClient.interrupt(threadId);
    set((state) => ({
      runtime: state.runtime
        ? { ...state.runtime, state: "ready", turnId: null }
        : state.runtime,
      threadActivity: {
        ...state.threadActivity,
        [threadId]: "idle",
      },
      timeline: withoutInterruptionArtifacts(
        completeTurnTimeline(state.timeline, state.runtime?.turnId ?? ""),
      ),
      ...(pauseError
        ? {
            error: `当前回合已停止，但目标暂停失败：${errorMessage(pauseError)}`,
          }
        : {}),
    }));
  },

  newTask: (cwd) =>
    set((state) => ({
      selectedThreadId: null,
      draftCwd: cwd ?? null,
      timeline: [],
      queuedMessages: [],
      timelineByThread: state.selectedThreadId
        ? {
            ...state.timelineByThread,
            [state.selectedThreadId]: state.timeline,
          }
        : state.timelineByThread,
      turnStartedAt: {},
      turnDurations: {},
      primaryView: "tasks",
      utilityOpen: false,
      localArtifactPreview: null,
      runtime: state.runtime
        ? { ...state.runtime, state: "ready", threadId: null, turnId: null }
        : state.runtime,
    })),
}));
