import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  readText as readClipboardText,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { sendNotification } from "@tauri-apps/plugin-notification";

import type {
  ApprovalDecision,
  AppError,
  AppUpdateState,
  BrowserAnnotation,
  BrowserBoundsRequest,
  BrowserFrame,
  BrowserState,
  DesktopEvent,
  DesktopRecoveryRequired,
  EventReplay,
  EventEnvelope,
  Policy,
  Preferences,
  PromptSubmission,
  ProviderKind,
  SchedulerSnapshot,
  StreamEnvelope,
  TaskStartRequest,
  TaskApprovalResolution,
  TaskInputResolution,
  TaskQueueDeletion,
  TaskQueueSteerReceipt,
  TaskSteerReceipt,
  QueuedTaskMessage,
  TerminalExit,
} from "../types";
import type { BrowserAction } from "../bindings/BrowserAction";
import type { DesktopBrowserCommand } from "../bindings/DesktopBrowserCommand";
import type { JsonValue } from "../bindings/serde_json/JsonValue";
import {
  createDesktopApiClient,
  legacyQueuedSteerResult,
  legacySteerResult,
} from "./desktopApi";

export type BrowserCommand = DesktopBrowserCommand;

export interface TerminalOutput {
  processId: string;
  data: string;
}

export interface BrowserEvent {
  kind: "frame" | "navigation" | "new-tab" | "crash";
  routeId?: string;
  url?: string;
  message?: string;
  value?: unknown;
}

export interface AppMenuAction {
  action:
    | "settings"
    | "check-updates"
    | "new-window"
    | "new-chat"
    | "open-folder"
    | "toggle-sidebar"
    | "toggle-bottom-panel"
    | "toggle-summary"
    | "open-terminal"
    | "toggle-files"
    | "toggle-review"
    | "browser"
    | "find"
    | "previous-chat"
    | "next-chat"
    | "back"
    | "forward"
    | "keyboard-shortcuts"
    | "troubleshooting"
    | "task-manager";
}

export interface StartTaskInput {
  threadId?: string | null;
  text: string;
  cwd?: string | null;
  workspaceMode?: string | null;
  images?: string[];
  attachments?: string[];
  capability?: string | null;
  mode?: string | null;
  industryPlugin?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}

function normalizeError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = error as Partial<AppError>;
    return {
      code: value.code ?? "INTERNAL",
      message: String(value.message),
      retryable: Boolean(value.retryable),
      ...(value.context ? { context: value.context } : {}),
    };
  }
  return {
    code: "INTERNAL",
    message: typeof error === "string" ? error : "OnPeople 桌面服务不可用",
    retryable: false,
  };
}

async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (import.meta.env.DEV && window.__ONPEOPLE_DEV__?.invoke) {
    return (await window.__ONPEOPLE_DEV__.invoke(command, args)) as T;
  }
  if (!isTauriRuntime()) {
    throw normalizeError({
      code: "RUNTIME_UNAVAILABLE",
      message: "OnPeople 桌面服务尚未就绪",
      retryable: true,
    });
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

async function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<T>(event, ({ payload }) => handler(payload));
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const internals = (
    window as Window & {
      __TAURI_INTERNALS__?: {
        invoke?: unknown;
        transformCallback?: unknown;
      };
    }
  ).__TAURI_INTERNALS__;
  return (
    typeof internals?.invoke === "function" &&
    typeof internals.transformCallback === "function"
  );
}

const desktopApi = createDesktopApiClient(
  (request) => call("desktop_request", { request }),
  undefined,
  (handler) => subscribe("desktop:event", handler),
);

function jsonRecord(value: Record<string, unknown>): Record<string, JsonValue> {
  return value as Record<string, JsonValue>;
}

async function browserAction(
  action: BrowserAction,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return (await desktopApi.request("browser.action", {
    action,
    payload: jsonRecord(payload),
  })) as Record<string, unknown>;
}

function legacyEventEnvelope(event: DesktopEvent): EventEnvelope {
  return {
    sequence: event.sequence,
    kind: event.topic as EventEnvelope["kind"],
    emittedAt: event.emittedAt,
    windowLabel: null,
    threadId: event.threadId,
    payload: event.payload,
  };
}

function taskStartRequest(request: StartTaskInput): TaskStartRequest {
  return {
    threadId: request.threadId ?? null,
    text: request.text,
    cwd: request.cwd ?? null,
    workspaceMode: request.workspaceMode ?? null,
    images: request.images ?? [],
    attachments: request.attachments ?? [],
    capability: request.capability ?? null,
    mode: request.mode ?? null,
    industryPlugin: request.industryPlugin ?? null,
    model: request.model ?? null,
    reasoningEffort: request.reasoningEffort ?? null,
  };
}

function taskQueue(
  text: string,
  threadId?: string | null,
): Promise<QueuedTaskMessage> {
  return desktopApi.request("task.queue", {
    text,
    threadId: threadId ?? null,
  });
}

function taskQueueDelete(
  queueId: string,
  threadId?: string | null,
): Promise<TaskQueueDeletion> {
  return desktopApi.request("task.queue.delete", {
    queueId,
    threadId: threadId ?? null,
  });
}

function taskSteer(
  text: string,
  threadId?: string | null,
): Promise<TaskSteerReceipt> {
  return desktopApi.request("task.steer", {
    text,
    threadId: threadId ?? null,
  });
}

function taskQueueSteer(
  queueId: string,
  threadId?: string | null,
): Promise<TaskQueueSteerReceipt> {
  return desktopApi.request("task.queue.steer", {
    queueId,
    threadId: threadId ?? null,
  });
}

function taskApprovalResolve(
  requestId: string,
  decision: ApprovalDecision,
): Promise<TaskApprovalResolution> {
  return desktopApi.request("task.approval.resolve", {
    requestId,
    decision,
  });
}

function taskInputResolve(
  requestId: string,
  answers: Record<string, string[]>,
): Promise<TaskInputResolution> {
  return desktopApi.request("task.input.resolve", { requestId, answers });
}

function replayEvents(
  afterSequence: number,
  limit = 256,
): Promise<EventReplay> {
  return desktopApi.request("event.replay", { afterSequence, limit });
}

export const desktopClient = {
  // Every call below crosses the one typed Tauri command boundary.
  activateDeepLinks: () => desktopApi.request("shell.deep-links.activate", {}),
  frontendReady: () => desktopApi.request("shell.frontend.ready", {}),
  listAgents: (parentThreadId?: string | null) =>
    desktopApi.request("agent.list", {
      parentThreadId: parentThreadId ?? null,
    }) as Promise<{ agents?: Array<Record<string, unknown>> }>,
  agentStatus: () => desktopApi.request("runtime.status", {}),
  getPreferences: () => desktopApi.request("preferences.get", {}),
  savePreferences: (preferences: Preferences) =>
    desktopApi.request("preferences.save", { preferences }),
  listThreads: (
    filters: {
      archived?: boolean;
      query?: string;
      projectPath?: string | null;
      limit?: number;
    } = {},
  ) =>
    desktopApi.request("thread.list", {
      archived: filters.archived ?? false,
      query: filters.query ?? "",
      projectPath: filters.projectPath ?? null,
      limit: filters.limit ?? 200,
    }),
  threadTimeline: (threadId: string) =>
    desktopApi.request("thread.timeline", { threadId }) as Promise<
      Array<Record<string, unknown>>
    >,
  runtimeSnapshot: (threadId?: string | null) =>
    desktopApi.request("runtime.snapshot", { threadId: threadId ?? null }),
  getRuntimeSnapshot: (threadId?: string | null) =>
    desktopApi.request("runtime.snapshot", { threadId: threadId ?? null }),
  runtimeDiagnostics: () => desktopApi.request("runtime.diagnostics", {}),
  getRuntimeDiagnostics: () => desktopApi.request("runtime.diagnostics", {}),
  replayEvents,
  startRuntime: () => desktopApi.request("runtime.start", {}),
  stopRuntime: () => desktopApi.request("runtime.stop", {}),
  startTask: (request: StartTaskInput) =>
    desktopApi.request("task.start", taskStartRequest(request)),
  sendPrompt: async (request: StartTaskInput): Promise<PromptSubmission> => {
    const task = await desktopApi.request(
      "task.start",
      taskStartRequest(request),
    );
    return {
      threadId: task.threadId,
      turnId: task.taskId,
      queued: task.state === "queued",
    };
  },
  setGoal: (request: {
    objective: string;
    tokenBudget?: number | null;
    threadId?: string | null;
  }) =>
    desktopApi.request("goal.set", {
      objective: request.objective,
      tokenBudget: request.tokenBudget ?? null,
      threadId: request.threadId ?? null,
    }),
  updateGoal: (request: {
    threadId: string;
    action: string;
    value?: unknown;
  }) =>
    desktopApi.request("goal.update", {
      threadId: request.threadId,
      action: request.action,
      value: (request.value ?? null) as JsonValue,
    }),
  getProvider: (kind: ProviderKind, threadId?: string | null) =>
    desktopApi.request("provider.get", {
      kind,
      threadId: threadId ?? null,
    }),
  saveProvider: (request: {
    kind: ProviderKind;
    model: string;
    baseUrl: string;
    apiKey?: string | null;
    threadId?: string | null;
    extra?: Record<string, unknown>;
  }) =>
    desktopApi.request("provider.save", {
      kind: request.kind,
      model: request.model,
      baseUrl: request.baseUrl,
      apiKey: request.apiKey ?? null,
      threadId: request.threadId ?? null,
      extra: jsonRecord(request.extra ?? {}),
    }),
  startTerminal: (request: {
    cwd: string;
    cols: number;
    rows: number;
    shell?: string | null;
    windowLabel?: string | null;
  }) =>
    desktopApi.request("terminal.start", {
      ...request,
      shell: request.shell ?? null,
      windowLabel: request.windowLabel ?? null,
    }),
  writeTerminal: (processId: string, data: string) =>
    desktopApi.request("terminal.write", { processId, data }),
  resizeTerminal: (processId: string, cols: number, rows: number) =>
    desktopApi.request("terminal.resize", { processId, cols, rows }),
  terminateTerminal: (processId: string) =>
    desktopApi.request("terminal.terminate", { processId }),
  gitState: (cwd: string) => desktopApi.request("git.state", { cwd }),
  getGitState: (cwd: string) => desktopApi.request("git.state", { cwd }),
  gitDiff: (cwd: string, filePath: string) =>
    desktopApi.request("git.diff", { cwd, filePath }),
  getGitDiff: (cwd: string, filePath: string) =>
    desktopApi.request("git.diff", { cwd, filePath }),
  mutateGit: (request: {
    cwd: string;
    action: string;
    paths?: string[];
    patch?: string | null;
  }) =>
    desktopApi.request("git.mutate", {
      ...request,
      paths: request.paths ?? [],
      patch: request.patch ?? null,
    }),
  commitGit: (cwd: string, message: string) =>
    desktopApi.request("git.commit", { cwd, message }),
  pushGit: (cwd: string, remote?: string | null) =>
    desktopApi.request("git.push", { cwd, remote: remote ?? null }),
  listProjectFiles: (cwd: string, relative = "") =>
    desktopApi.request("file.list", { cwd, relative }),
  searchProjectFiles: (cwd: string, query: string) =>
    desktopApi.request("file.search", { cwd, query }),
  scheduler: () => desktopApi.request("scheduler.get", {}),
  createScheduledTask: (request: {
    name: string;
    prompt: string;
    cwd: string;
    schedule: unknown;
    runtime: unknown;
  }) =>
    desktopApi.request("scheduler.create", {
      name: request.name,
      prompt: request.prompt,
      cwd: request.cwd,
      schedule: request.schedule as JsonValue,
      runtime: (request.runtime ?? null) as JsonValue,
    }),
  runScheduledTask: (id: string) =>
    desktopApi.request("scheduler.run", { id }) as Promise<
      Record<string, unknown>
    >,
  deleteScheduledTask: (id: string) =>
    desktopApi.request("scheduler.delete", { id }),
  liveStatus: () => desktopApi.request("live.status", {}),
  getLiveStatus: () => desktopApi.request("live.status", {}),
  requestMicrophoneAccess: () =>
    desktopApi.request("shell.microphone.request", {}),
  cloudAccount: () => desktopApi.request("cloud.account", {}),
  getCloudAccount: () => desktopApi.request("cloud.account", {}),
  appUpdateState: () => desktopApi.request("shell.app-update.state", {}),
  getAppUpdateState: () => desktopApi.request("shell.app-update.state", {}),
  checkForAppUpdate: () =>
    desktopApi.request("shell.app-update.check", {}) as Promise<
      Record<string, unknown>
    >,
  downloadAppUpdate: () =>
    desktopApi.request("shell.app-update.download", {}) as Promise<
      Record<string, unknown>
    >,
  installAppUpdate: () =>
    desktopApi.request("shell.app-update.install", {}) as Promise<
      Record<string, unknown>
    >,
  openAppDownload: () =>
    desktopApi.request("shell.app-update.open-download", {}) as Promise<
      Record<string, unknown>
    >,
  openScheduler: () => desktopApi.request("shell.scheduler.open", {}),
  copyText: (text: string) => writeClipboardText(text),
  readText: () => readClipboardText(),
  pickProject: async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },
  notify: (title: string, body: string) => sendNotification({ title, body }),
  browserState: () => desktopApi.request("browser.state", {}),
  restartBrowserHost: () => desktopApi.request("browser.restart", {}),
  browserCommand: (command: BrowserCommand) =>
    desktopApi.request("browser.command", { command }) as Promise<
      Record<string, unknown>
    >,
  browserSurfaceBounds: (request: BrowserBoundsRequest) =>
    desktopApi.request("browser.surface.bounds", request) as Promise<
      Record<string, unknown>
    >,
  pickFiles: async (multiple = true) => {
    const selected = await openDialog({ multiple, directory: false });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  },
  pickDirectory: async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },
  streamBrowser: async (handler: (event: StreamEnvelope) => void) => {
    await subscribe<BrowserFrame>("browser:preview-updated", (frame) =>
      handler({
        sequence: Number(frame.sequence),
        kind: "browser-frame",
        streamId: frame.routeId,
        payload: frame as unknown as JsonValue,
        terminal: false,
      }),
    );
  },
  listBrowserAnnotations: (routeId: string) =>
    desktopApi.request("browser.annotation.list", { routeId }),
  saveBrowserAnnotation: (annotation: BrowserAnnotation) =>
    desktopApi.request("browser.annotation.save", annotation),
  deleteBrowserAnnotation: (id: string) =>
    desktopApi.request("browser.annotation.delete", { id }),
  openTaskWindow: (threadId?: string | null) =>
    desktopApi.request("shell.task-window.open", {
      threadId: threadId ?? null,
    }),
  pickImages: () =>
    desktopApi.request("shell.images.pick", { paths: [] }) as Promise<
      Record<string, unknown>
    >,
  pickAttachments: () =>
    desktopApi.request("shell.attachments.pick", { paths: [] }) as Promise<
      Record<string, unknown>
    >,
  pasteImage: () =>
    desktopApi.request("shell.image.paste", { paths: [] }) as Promise<
      Record<string, unknown>
    >,
  pasteFiles: async () => {
    const result = await desktopApi.request("shell.image.paste", { paths: [] });
    const selected = result.selected;
    return Array.isArray(selected)
      ? selected.filter((path): path is string => typeof path === "string")
      : [];
  },
  readGeneratedImage: (imagePath: string, threadId?: string | null) =>
    desktopApi.request("file.generated-image.read", {
      path: imagePath,
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  revealGeneratedImage: (imagePath: string, threadId?: string | null) =>
    desktopApi.request("shell.generated-image.reveal", {
      imagePath,
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  copyGeneratedImage: (imagePath: string, threadId?: string | null) =>
    desktopApi.request("shell.generated-image.copy", {
      imagePath,
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  openLocalArtifact: (path: string, threadId?: string | null) =>
    desktopApi.request("shell.local-artifact.open", {
      path,
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  previewLocalArtifact: (path: string, threadId?: string | null) =>
    desktopApi.request("file.artifact.preview", {
      path,
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  newTask: (cwd?: string) =>
    desktopApi.request("thread.new", { cwd: cwd ?? null }) as Promise<
      Record<string, unknown>
    >,
  getProviderSettings: (type: ProviderKind, threadId?: string | null) =>
    desktopApi.request("provider.get", {
      kind: type,
      threadId: threadId ?? null,
    }),
  setThreadReasoningEffort: (
    threadId: string,
    effort: string,
    model?: string | null,
  ) =>
    desktopApi.request("thread.reasoning", {
      threadId,
      effort,
      model: model ?? null,
    }) as Promise<Record<string, unknown>>,
  loginCloudAccount: (payload: Record<string, unknown>) =>
    desktopApi.request("cloud.login", {
      email: String(payload.email ?? ""),
      password: String(payload.password ?? ""),
    }) as Promise<Record<string, unknown>>,
  sendCloudRegistrationCode: (payload: Record<string, unknown>) =>
    desktopApi.request("cloud.registration-code.send", {
      email: String(payload.email ?? ""),
    }) as Promise<Record<string, unknown>>,
  registerCloudAccount: (payload: Record<string, unknown>) =>
    desktopApi.request("cloud.register", {
      email: String(payload.email ?? ""),
      password: String(payload.password ?? ""),
      code: String(payload.code ?? ""),
    }) as Promise<Record<string, unknown>>,
  logoutCloudAccount: () =>
    desktopApi.request("cloud.logout", {}) as Promise<Record<string, unknown>>,
  redeemCloudCode: (code: string) =>
    desktopApi.request("cloud.redeem", { code }) as Promise<
      Record<string, unknown>
    >,
  openCloudConsole: () =>
    desktopApi.request("shell.cloud-console.open", {}) as Promise<
      Record<string, unknown>
    >,
  openExternalUrl: (url: string) =>
    desktopApi.request("shell.external-url.open", { url }) as Promise<
      Record<string, unknown>
    >,
  listCloudGroups: () =>
    desktopApi.request("cloud.groups", {}) as Promise<Record<string, unknown>>,
  selectCloudGroup: (groupId: string) =>
    desktopApi.request("cloud.group.select", { groupId }) as Promise<
      Record<string, unknown>
    >,
  getCloudUsageProfile: (payload: Record<string, unknown> = {}) =>
    desktopApi.request("cloud.usage", {
      payload: jsonRecord(payload),
    }) as Promise<Record<string, unknown>>,
  saveCloudLeaderboardPreference: (payload: Record<string, unknown>) =>
    desktopApi.request("cloud.leaderboard.save", {
      payload: jsonRecord(payload),
    }) as Promise<Record<string, unknown>>,
  createLiveSession: (payload: Record<string, unknown>) =>
    desktopApi.request("live.create", {
      sdp: String(payload.sdp ?? ""),
      voice: typeof payload.voice === "string" ? payload.voice : null,
      instructions:
        typeof payload.instructions === "string" ? payload.instructions : null,
      initialItems: Array.isArray(payload.initialItems)
        ? (payload.initialItems as JsonValue[])
        : [],
    }) as Promise<Record<string, unknown>>,
  closeLiveSession: (callId: string) =>
    desktopApi.request("live.close", { callId }) as Promise<
      Record<string, unknown>
    >,
  resumeTask: (threadId: string) =>
    desktopApi.request("task.resume", { threadId }),
  resumeThread: async (threadId: string): Promise<Record<string, unknown>> => {
    const recovery = await desktopApi.request("task.resume", { threadId });
    return recovery.resumePayload as Record<string, unknown>;
  },
  forkThread: (threadId: string) =>
    desktopApi.request("thread.fork", { threadId }) as Promise<
      Record<string, unknown>
    >,
  archiveThread: (threadId: string) =>
    desktopApi.request("thread.archive", { threadId }) as Promise<
      Record<string, unknown>
    >,
  unarchiveThread: (threadId: string) =>
    desktopApi.request("thread.unarchive", { threadId }) as Promise<
      Record<string, unknown>
    >,
  pinThread: (threadId: string, pinned: boolean) =>
    desktopApi.request("thread.pin", { threadId, value: pinned }) as Promise<
      Record<string, unknown>
    >,
  markThreadUnread: (threadId: string, unread: boolean) =>
    desktopApi.request("thread.unread", { threadId, value: unread }) as Promise<
      Record<string, unknown>
    >,
  renameThread: (threadId: string, name: string) =>
    desktopApi.request("thread.rename", { threadId, value: name }) as Promise<
      Record<string, unknown>
    >,
  autoNameThread: (threadId: string, text: string, model?: string | null) =>
    desktopApi.request("thread.auto-name", {
      threadId,
      text,
      model: model ?? null,
    }) as Promise<Record<string, unknown>>,
  revealThread: (threadId: string) =>
    desktopApi.request("shell.thread.reveal", { threadId }) as Promise<
      Record<string, unknown>
    >,
  showTerminalContextMenu: (payload: Record<string, unknown>) =>
    desktopApi.request("terminal.context-menu", {
      processId: String(payload.processId ?? ""),
      hasSelection: Boolean(payload.hasSelection),
    }) as Promise<Record<string, unknown>>,
  setTerminalFocused: (focused: boolean, processId?: string | null) =>
    desktopApi.request("terminal.focus", {
      focused,
      processId: processId ?? null,
    }) as Promise<Record<string, unknown>>,
  updateProject: (projectPath: string, action: string, value?: unknown) =>
    desktopApi.request("project.update", {
      projectPath,
      action,
      value: (value ?? null) as JsonValue,
    }) as Promise<Record<string, unknown>>,
  revealProject: (projectPath: string) =>
    desktopApi.request("shell.project.reveal", { projectPath }) as Promise<
      Record<string, unknown>
    >,
  archiveProjectTasks: (projectPath: string) =>
    desktopApi.request("project.archive-tasks", { projectPath }) as Promise<
      Record<string, unknown>
    >,
  readyTerminal: (processId: string) =>
    desktopApi.request("terminal.ready", { processId }) as Promise<
      Record<string, unknown>
    >,
  initGitRepository: (cwd: string) =>
    desktopApi.request("git.initialize", { cwd }),
  getGitHunks: (cwd: string, filePath: string) =>
    desktopApi.request("git.hunks", { cwd, filePath }) as Promise<
      Record<string, unknown>
    >,
  mutateGitHunk: (payload: Record<string, unknown>) =>
    desktopApi.request("git.hunk.mutate", {
      cwd: String(payload.cwd ?? ""),
      patch: String(payload.patch ?? ""),
      action: String(payload.action ?? "apply"),
    }),
  preparePullRequest: (cwd: string, base?: string | null) =>
    desktopApi.request("git.pull-request.prepare", {
      cwd,
      base: base ?? null,
    }) as Promise<Record<string, unknown>>,
  startReview: (payload: Record<string, unknown>) =>
    desktopApi.request("git.review.start", {
      cwd: String(payload.cwd ?? ""),
      threadId: typeof payload.threadId === "string" ? payload.threadId : null,
      targetType:
        typeof payload.targetType === "string" ? payload.targetType : null,
      value: typeof payload.value === "string" ? payload.value : null,
      base: typeof payload.base === "string" ? payload.base : null,
    }) as Promise<Record<string, unknown>>,
  submitReviewComments: (payload: Record<string, unknown>) =>
    desktopApi.request("git.review.submit", {
      comments: (payload.comments ?? []) as never,
      threadId: typeof payload.threadId === "string" ? payload.threadId : null,
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
      review:
        payload.review && typeof payload.review === "object"
          ? (payload.review as never)
          : null,
    }) as Promise<Record<string, unknown>>,
  openEditor: (payload: Record<string, unknown>) =>
    desktopApi.request("shell.editor.open", {
      cwd: String(payload.cwd ?? ""),
      path: String(payload.path ?? payload.filePath ?? ""),
    }) as Promise<Record<string, unknown>>,
  restartRuntime: () => desktopApi.request("runtime.restart", {}),
  listExtensions: (cwd?: string | null) =>
    desktopApi.request("extensions.list", { cwd: cwd ?? null }) as Promise<
      Record<string, unknown>
    >,
  setSkillEnabled: (skillPath: string, enabled: boolean) =>
    desktopApi.request("extensions.skill.set-enabled", {
      skillPath,
      enabled,
    }) as Promise<Record<string, unknown>>,
  installPlugin: (plugin: Record<string, unknown>) =>
    desktopApi.request("plugin.install", {
      plugin: jsonRecord(plugin),
    }) as Promise<Record<string, unknown>>,
  uninstallPlugin: (pluginId: string) =>
    desktopApi.request("plugin.uninstall", { pluginId }) as Promise<
      Record<string, unknown>
    >,
  activateIndustryPlugin: (payload: Record<string, unknown>) =>
    desktopApi.request("plugin.industry.activate", {
      plugin: jsonRecord(payload),
    }) as Promise<Record<string, unknown>>,
  deactivateIndustryPlugin: (pluginId: string) =>
    desktopApi.request("plugin.industry.deactivate", { pluginId }) as Promise<
      Record<string, unknown>
    >,
  reloadMcp: () =>
    desktopApi.request("plugin.mcp.reload", {}) as Promise<
      Record<string, unknown>
    >,
  syncPluginCatalog: (url?: string | null) =>
    desktopApi.request("plugin.catalog.sync", {
      url: url ?? null,
    }) as Promise<Record<string, unknown>>,
  startConnectorOauth: (pluginId: string) =>
    desktopApi.request("connector.oauth.start", { pluginId }) as Promise<
      Record<string, unknown>
    >,
  completeConnectorOauth: (payload: Record<string, unknown>) =>
    desktopApi.request("connector.oauth.complete", {
      state: String(payload.state ?? ""),
      code: typeof payload.code === "string" ? payload.code : null,
      error: typeof payload.error === "string" ? payload.error : null,
    }) as Promise<Record<string, unknown>>,
  disconnectConnector: (pluginId: string) =>
    desktopApi.request("connector.disconnect", { pluginId }) as Promise<
      Record<string, unknown>
    >,
  discoverModels: () =>
    desktopApi.request("models.discover", {}) as Promise<
      Record<string, unknown>
    >,
  validateModel: (providerType: string, modelId: string) =>
    desktopApi.request("models.validate", {
      providerType,
      modelId,
    }) as Promise<Record<string, unknown>>,
  listAgentProfiles: () =>
    desktopApi.request("agent.profile.list", {}) as Promise<
      Record<string, unknown>
    >,
  saveAgentProfile: (profile: Record<string, unknown>) =>
    desktopApi.request("agent.profile.save", {
      profile: jsonRecord(profile),
    }) as Promise<Record<string, unknown>>,
  deleteAgentProfile: (profileId: string) =>
    desktopApi.request("agent.profile.delete", { profileId }) as Promise<
      Record<string, unknown>
    >,
  messageAgent: (agentId: string, text: string) =>
    desktopApi.request("agent.message", { agentId, text }) as Promise<
      Record<string, unknown>
    >,
  stopAgent: (agentId: string) =>
    desktopApi.request("agent.stop", { agentId }) as Promise<
      Record<string, unknown>
    >,
  readAgent: (agentId: string) =>
    desktopApi.request("agent.read", { agentId }) as Promise<
      Record<string, unknown>
    >,
  listWorktrees: (cwd: string) =>
    desktopApi.request("git.worktree", {
      root: cwd,
      path: null,
      branch: null,
      threadId: null,
      removeBranch: false,
    }) as Promise<Record<string, unknown>>,
  createWorktree: (payload: Record<string, unknown>) =>
    desktopApi.request("git.worktree", {
      root: String(payload.root ?? payload.cwd ?? ""),
      path: typeof payload.path === "string" ? payload.path : null,
      branch: typeof payload.branch === "string" ? payload.branch : null,
      threadId: typeof payload.threadId === "string" ? payload.threadId : null,
      removeBranch: false,
    }) as Promise<Record<string, unknown>>,
  handoffWorktree: (worktreePath: string) =>
    desktopApi.request("worktree.handoff", {
      worktreePath,
      output: null,
    }) as Promise<Record<string, unknown>>,
  snapshotWorktree: (worktreePath: string) =>
    desktopApi.request("worktree.snapshot", {
      worktreePath,
      output: null,
    }) as Promise<Record<string, unknown>>,
  removeWorktree: (worktreePath: string, root?: string | null) =>
    desktopApi.request("git.worktree", {
      root: root ?? "",
      path: worktreePath,
      branch: null,
      threadId: null,
      removeBranch: true,
    }) as Promise<Record<string, unknown>>,
  getContextState: (threadId?: string | null) =>
    desktopApi.request("context.state", {
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  compactContext: (threadId?: string | null) =>
    desktopApi.request("context.compact", {
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  recalibrateContext: (threadId?: string | null) =>
    desktopApi.request("context.recalibrate", {
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  taskSteer,
  steerTurn: async (
    text: string,
    threadId?: string | null,
  ): Promise<Record<string, unknown>> => {
    const receipt = await taskSteer(text, threadId);
    return legacySteerResult(receipt);
  },
  taskQueue,
  queueMessage: async (
    text: string,
    threadId?: string | null,
  ): Promise<Record<string, unknown>> =>
    (await taskQueue(text, threadId)) as unknown as Record<string, unknown>,
  taskQueueDelete,
  deleteQueuedMessage: async (
    queueId: string,
    threadId?: string | null,
  ): Promise<Record<string, unknown>> =>
    (await taskQueueDelete(queueId, threadId)) as unknown as Record<
      string,
      unknown
    >,
  taskQueueSteer,
  steerQueuedMessage: async (
    queueId: string,
    threadId?: string | null,
  ): Promise<Record<string, unknown>> => {
    const receipt = await taskQueueSteer(queueId, threadId);
    return legacyQueuedSteerResult(receipt);
  },
  getPolicy: () =>
    desktopApi.request("policy.get", {}) as Promise<Record<string, unknown>>,
  savePolicy: (threadId: string, policy: Policy) =>
    desktopApi.request("policy.save", {
      threadId,
      policy,
    }) as Promise<Record<string, unknown>>,
  pickDownloadDirectory: (path?: string | null) =>
    desktopApi.request("shell.download-directory.pick", {
      path: path ?? null,
    }),
  getEffectiveConfig: (payload: Record<string, unknown> = {}) =>
    desktopApi.request("config.effective", {
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
    }) as Promise<Record<string, unknown>>,
  listMemories: (cwd?: string | null, threadId?: string | null) =>
    desktopApi.request("memory.list", {
      cwd: cwd ?? null,
      threadId: threadId ?? null,
    }) as Promise<Record<string, unknown>>,
  saveMemory: (memory: Record<string, unknown>) =>
    desktopApi.request("memory.save", {
      entry: jsonRecord(memory),
      threadId: null,
    }) as Promise<Record<string, unknown>>,
  deleteMemory: (memoryId: string) =>
    desktopApi.request("memory.delete", { memoryId }) as Promise<
      Record<string, unknown>
    >,
  saveMemorySettings: (settings: Record<string, unknown>) =>
    desktopApi.request("memory.settings.save", {
      settings: jsonRecord(settings),
    }) as Promise<Record<string, unknown>>,
  getUsageLedger: () =>
    desktopApi.request("usage.get", {}) as Promise<Record<string, unknown>>,
  saveUsagePrice: (key: string, price: number) =>
    desktopApi.request("usage.price.save", { key, price }) as Promise<
      Record<string, unknown>
    >,
  listSecrets: () =>
    desktopApi.request("secret.list", {}) as Promise<Record<string, unknown>>,
  saveSecret: (secret: Record<string, unknown>) =>
    desktopApi.request("secret.save", {
      secret: jsonRecord(secret),
    }) as Promise<Record<string, unknown>>,
  deleteSecret: (secretId: string) =>
    desktopApi.request("secret.delete", { secretId }) as Promise<
      Record<string, unknown>
    >,
  listHooks: (cwd: string) => desktopApi.request("hook.list", { cwd }),
  listLocalHooks: (cwd: string) =>
    desktopApi.request("hook.local.list", { cwd }),
  createHook: (payload: Record<string, unknown>) =>
    desktopApi.request("hook.create", {
      cwd: String(payload.cwd ?? ""),
      id: typeof payload.id === "string" ? payload.id : null,
      event: (payload.event ?? null) as JsonValue,
      command: (payload.command ?? null) as JsonValue,
      enabled: typeof payload.enabled === "boolean" ? payload.enabled : null,
    }) as Promise<Record<string, unknown>>,
  listScheduledTasks: () => desktopApi.request("scheduler.get", {}),
  createScheduledTaskFromText: (payload: Record<string, unknown>) =>
    desktopApi.request("scheduler.create-from-text", {
      name: typeof payload.name === "string" ? payload.name : null,
      prompt: typeof payload.prompt === "string" ? payload.prompt : null,
      text: typeof payload.text === "string" ? payload.text : null,
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
      schedule: (payload.schedule ?? null) as JsonValue,
      runtime: (payload.runtime ?? null) as JsonValue,
    }) as Promise<Record<string, unknown>>,
  updateScheduledTask: (taskId: string, patch: Record<string, unknown>) =>
    desktopApi.request("scheduler.update", {
      taskId,
      patch: jsonRecord(patch) as JsonValue,
    }) as Promise<Record<string, unknown>>,
  markScheduledNotificationsRead: (runId?: string | null) =>
    desktopApi.request("scheduler.mark-read", { runId: runId ?? null }),
  cancelTask: (threadId: string, taskId?: string | null) =>
    desktopApi.request("task.cancel", {
      threadId,
      taskId: taskId ?? null,
    }),
  taskSnapshot: (threadId: string, taskId?: string | null) =>
    desktopApi.request("task.snapshot", {
      threadId,
      taskId: taskId ?? null,
    }),
  interrupt: async (
    threadId: string,
    turnId?: string | null,
  ): Promise<Record<string, unknown>> => {
    const task = await desktopApi.request("task.cancel", {
      threadId,
      taskId: turnId ?? null,
    });
    return { interrupted: true, task };
  },
  taskApprovalResolve,
  resolveApproval: async (
    requestId: string,
    decision: string,
  ): Promise<Record<string, unknown>> =>
    (await taskApprovalResolve(
      requestId,
      decision as ApprovalDecision,
    )) as unknown as Record<string, unknown>,
  taskInputResolve,
  resolveUserInput: async (
    requestId: string,
    answers: Record<string, string[]>,
  ): Promise<Record<string, unknown>> =>
    (await taskInputResolve(requestId, answers)) as unknown as Record<
      string,
      unknown
    >,
  navigate: (url: string, routeId: string) =>
    browserAction("navigate", { url, routeId }),
  getQuickLauncherSuggestions: (
    cwd: string,
    routeId?: string | null,
    query = "",
  ) =>
    desktopApi.request("project.quick-launcher", {
      cwd,
      routeId: routeId ?? null,
      query,
    }) as Promise<Array<Record<string, unknown>>>,
  getProjectActions: (cwd: string) =>
    desktopApi.request("file.project-actions", { cwd }),
  authorizeProjectAction: (payload: Record<string, unknown>) =>
    desktopApi.request("file.project-action.authorize", {
      cwd: String(payload.cwd ?? ""),
      actionId: String(payload.actionId ?? payload.id ?? ""),
      fingerprint:
        typeof payload.fingerprint === "string" ? payload.fingerprint : null,
    }),
  openWorkspaceFile: (cwd: string, filePath: string, routeId?: string | null) =>
    desktopApi.request("file.preview", {
      cwd,
      path: filePath,
      routeId: routeId ?? null,
    }) as Promise<Record<string, unknown>>,
  back: (routeId: string) => browserAction("back", { routeId }),
  forward: (routeId: string) => browserAction("forward", { routeId }),
  reload: (routeId: string) => browserAction("reload", { routeId }),
  captureBrowserVisualSnapshot: (routeId: string) =>
    browserAction("captureVisualSnapshot", { routeId }),
  inspectBrowserDeveloperState: (routeId: string) =>
    browserAction("inspectDeveloperState", { routeId }),
  beginBrowserAnnotation: (routeId: string) =>
    browserAction("beginAnnotation", { routeId }),
  cancelBrowserAnnotation: (routeId: string) =>
    browserAction("cancelAnnotation", { routeId }),
  getBrowserSessionStatus: (routeId: string) =>
    browserAction("sessionStatus", { routeId }),
  openBrowserSignIn: (providerId: string, routeId: string) =>
    browserAction("openSignIn", { providerId, routeId }),
  clearBrowserSession: (providerId: string, routeId: string) =>
    browserAction("clearSession", { providerId, routeId }),
  clearAllBrowserData: (routeId: string) =>
    browserAction("clearAllData", { routeId, all: true }),
  clearBrowserDataFromSettings: () =>
    browserAction("clearSettingsData", { all: true }),
  fillSavedBrowserCredential: (routeId: string) =>
    browserAction("fillSavedCredential", { routeId }),
  listBrowserImportProfiles: () => browserAction("listImportProfiles"),
  importBrowserProfile: (
    payload: Record<string, unknown>,
    routeId?: string | null,
  ) =>
    browserAction("importProfile", {
      ...payload,
      routeId: routeId ?? payload.routeId ?? null,
    }),
  attachBrowser: (webContentsId: string, routeId: string) =>
    browserAction("attach", { webContentsId, routeId }),
  activateBrowserTab: (threadId: string, routeId: string) =>
    browserAction("activateTab", { threadId, routeId }),
  detachBrowserTab: (routeId: string) =>
    browserAction("detachTab", { routeId }),
  onDesktopEvent: (handler: (event: DesktopEvent) => void) =>
    desktopApi.subscribe(handler),
  onDesktopEventRecoveryRequired: (
    handler: (event: DesktopRecoveryRequired) => void,
  ) => subscribe("desktop:event-recovery-required", handler),
  onRuntimeEvent: (handler: (event: EventEnvelope) => void) =>
    desktopApi.subscribe((event) => handler(legacyEventEnvelope(event))),
  onAgentEvent: (handler: (event: EventEnvelope) => void) =>
    desktopApi.subscribe((event) => {
      if (event.topic === "agent") handler(legacyEventEnvelope(event));
    }),
  onTurnEvent: (handler: (event: EventEnvelope) => void) =>
    desktopApi.subscribe((event) => handler(legacyEventEnvelope(event))),
  onSchedulerUpdated: (handler: (snapshot: SchedulerSnapshot) => void) =>
    subscribe("scheduler:updated", handler),
  onSchedulerOpen: (handler: (payload: unknown) => void) =>
    subscribe("scheduler:open", handler),
  onRuntimeUpdated: (handler: (event: EventEnvelope) => void) =>
    subscribe("runtime:updated", handler),
  onBrowserState: (handler: (state: BrowserState) => void) =>
    subscribe("browser:state", handler),
  onBrowserEvent: (handler: (event: BrowserEvent) => void) =>
    subscribe("browser:event", handler),
  onAgentBrowserNavigation: (handler: (payload: unknown) => void) =>
    subscribe("browser:agent-navigation", handler),
  onBrowserPreviewUpdated: (handler: (payload: unknown) => void) =>
    subscribe("browser:preview-updated", handler),
  onBrowserNewTabRequested: (handler: (payload: unknown) => void) =>
    subscribe("browser:new-tab-requested", handler),
  onCloudAccountUpdated: (handler: (payload: unknown) => void) =>
    subscribe("cloud:account:updated", handler),
  onAppUpdateState: (handler: (payload: AppUpdateState) => void) =>
    subscribe("app-update:state", handler),
  onLiveSidebandEvent: (handler: (payload: unknown) => void) =>
    subscribe("live:sideband-event", handler),
  onLiveSidebandStatus: (handler: (payload: unknown) => void) =>
    subscribe("live:sideband-status", handler),
  onPreferencesChanged: (handler: (payload: Preferences) => void) =>
    subscribe("preferences:changed", handler),
  onDeepLink: (handler: (payload: unknown) => void) =>
    subscribe("app:deep-link", handler),
  onSecondInstance: (handler: (payload: unknown) => void) =>
    subscribe("app:second-instance", handler),
  onNewTaskRequested: (handler: () => void) =>
    subscribe("app:new-task", () => handler()),
  onAppMenuAction: (handler: (payload: AppMenuAction) => void) =>
    subscribe("app:menu-action", handler),
  onCommandPalette: (handler: () => void) =>
    subscribe("app:command-palette", () => handler()),
  onTerminalMenuAction: (handler: (payload: unknown) => void) =>
    subscribe("terminal:menu-action", handler),
  onTerminalOutput: (handler: (event: TerminalOutput) => void) =>
    subscribe("terminal:output", handler),
  onTerminalExit: (handler: (event: TerminalExit) => void) =>
    subscribe("terminal:exit", handler),
};

export type DesktopClient = typeof desktopClient;
