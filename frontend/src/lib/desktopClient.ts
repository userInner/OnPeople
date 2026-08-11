import { Channel, invoke } from "@tauri-apps/api/core";
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
  CloudAccountState,
  DesktopEvent,
  DesktopRecoveryRequired,
  EventReplay,
  EventEnvelope,
  LiveStatus,
  Preferences,
  PromptSubmission,
  ProviderKind,
  ProviderSettings,
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
  activateDeepLinks: () => call<string[]>("activate_deep_links"),
  frontendReady: () => call<void>("frontend_ready"),
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
    call<ProviderSettings>("get_provider", {
      request: { kind, threadId: threadId ?? null },
    }),
  saveProvider: (request: {
    kind: ProviderKind;
    model: string;
    baseUrl: string;
    apiKey?: string | null;
    threadId?: string | null;
    extra?: Record<string, unknown>;
  }) =>
    call<ProviderSettings>("save_provider", {
      request: {
        ...request,
        apiKey: request.apiKey ?? null,
        threadId: request.threadId ?? null,
        extra: request.extra ?? {},
      },
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
  }) => call("create_scheduled_task", { request }),
  runScheduledTask: (id: string) =>
    call("run_scheduled_task", { request: { id } }),
  deleteScheduledTask: (id: string) =>
    call<boolean>("delete_scheduled_task", { request: { id } }),
  liveStatus: () => call<LiveStatus>("get_live_status"),
  getLiveStatus: () => call<LiveStatus>("get_live_status"),
  requestMicrophoneAccess: () =>
    call<{ granted: boolean; status: string }>("request_microphone_access"),
  cloudAccount: () => call<CloudAccountState>("get_cloud_account"),
  getCloudAccount: () => call<CloudAccountState>("get_cloud_account"),
  appUpdateState: () => call<AppUpdateState>("get_app_update_state"),
  getAppUpdateState: () => call<AppUpdateState>("get_app_update_state"),
  checkForAppUpdate: () =>
    call<Record<string, unknown>>("check_for_app_update"),
  downloadAppUpdate: () => call<Record<string, unknown>>("download_app_update"),
  installAppUpdate: () => call<Record<string, unknown>>("install_app_update"),
  openAppDownload: () => call<Record<string, unknown>>("open_app_download"),
  openScheduler: () => call<SchedulerSnapshot>("open_scheduler"),
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
  streamTerminal: (
    processId: string,
    handler: (event: StreamEnvelope) => void,
  ) => {
    if (!isTauriRuntime()) return Promise.resolve();
    const channel = new Channel<StreamEnvelope>(handler);
    return call<void>("stream_terminal", {
      request: { processId },
      channel,
    });
  },
  streamAgent: (handler: (event: StreamEnvelope) => void) => {
    if (!isTauriRuntime()) return Promise.resolve();
    const channel = new Channel<StreamEnvelope>(handler);
    return call<void>("stream_agent", { channel });
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
  streamLive: (handler: (event: StreamEnvelope) => void) => {
    if (!isTauriRuntime()) return Promise.resolve();
    const channel = new Channel<StreamEnvelope>(handler);
    return call<void>("stream_live", { channel });
  },
  listBrowserAnnotations: (routeId: string) =>
    desktopApi.request("browser.annotation.list", { routeId }),
  saveBrowserAnnotation: (annotation: BrowserAnnotation) =>
    desktopApi.request("browser.annotation.save", annotation),
  deleteBrowserAnnotation: (id: string) =>
    desktopApi.request("browser.annotation.delete", { id }),
  openTaskWindow: (threadId?: string | null) =>
    call<void>("open_task_window", { threadId: threadId ?? null }),
  pickImages: () =>
    call<Record<string, unknown>>("pick_images", { request: {} }),
  pickAttachments: () =>
    call<Record<string, unknown>>("pick_attachments", { request: {} }),
  pasteImage: () =>
    call<Record<string, unknown>>("paste_image", { request: {} }),
  pasteFiles: async () => {
    const result = await call<Record<string, unknown>>("paste_image", {
      request: {},
    });
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
    call<Record<string, unknown>>("reveal_generated_image", {
      request: { imagePath, threadId: threadId ?? null },
    }),
  copyGeneratedImage: (imagePath: string, threadId?: string | null) =>
    call<Record<string, unknown>>("copy_generated_image", {
      request: { imagePath, threadId: threadId ?? null },
    }),
  openLocalArtifact: (path: string, threadId?: string | null) =>
    call<Record<string, unknown>>("open_local_artifact", {
      request: { path, threadId: threadId ?? null },
    }),
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
    call<ProviderSettings>("get_provider_settings", {
      request: { type, threadId: threadId ?? null },
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
    call<Record<string, unknown>>("login_cloud_account", { request: payload }),
  sendCloudRegistrationCode: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("send_cloud_registration_code", {
      request: payload,
    }),
  registerCloudAccount: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("register_cloud_account", {
      request: payload,
    }),
  logoutCloudAccount: () =>
    call<Record<string, unknown>>("logout_cloud_account", { request: {} }),
  redeemCloudCode: (code: string) =>
    call<Record<string, unknown>>("redeem_cloud_code", { request: { code } }),
  openCloudConsole: () =>
    call<Record<string, unknown>>("open_cloud_console", { request: {} }),
  openExternalUrl: (url: string) =>
    call<Record<string, unknown>>("open_external_url", { request: { url } }),
  listCloudGroups: () =>
    call<Record<string, unknown>>("list_cloud_groups", { request: {} }),
  selectCloudGroup: (groupId: string) =>
    call<Record<string, unknown>>("select_cloud_group", {
      request: { groupId },
    }),
  getCloudUsageProfile: (payload: Record<string, unknown> = {}) =>
    call<Record<string, unknown>>("get_cloud_usage_profile", {
      request: payload,
    }),
  saveCloudLeaderboardPreference: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("save_cloud_leaderboard_preference", {
      request: payload,
    }),
  createLiveSession: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("create_live_session", { request: payload }),
  closeLiveSession: (callId: string) =>
    call<Record<string, unknown>>("close_live_session", {
      request: { callId },
    }),
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
    call<Record<string, unknown>>("reveal_thread", { request: { threadId } }),
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
    call<Record<string, unknown>>("reveal_project", {
      request: { projectPath },
    }),
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
    call<Record<string, unknown>>("open_editor", { request: payload }),
  restartRuntime: () => desktopApi.request("runtime.restart", {}),
  listExtensions: (cwd?: string | null) =>
    call<Record<string, unknown>>("list_extensions", {
      request: { cwd: cwd ?? null },
    }),
  setSkillEnabled: (skillPath: string, enabled: boolean) =>
    call<Record<string, unknown>>("set_skill_enabled", {
      request: { skillPath, enabled },
    }),
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
    call<Record<string, unknown>>("discover_models", { request: {} }),
  validateModel: (providerType: string, modelId: string) =>
    call<Record<string, unknown>>("validate_model", {
      request: { providerType, modelId },
    }),
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
  getPolicy: () => call<Record<string, unknown>>("get_policy", { request: {} }),
  savePolicy: (threadId: string, policy: unknown) =>
    call<Record<string, unknown>>("save_policy", {
      request: { threadId, policy },
    }),
  pickDownloadDirectory: (path?: string | null) =>
    call<Preferences>("pick_download_directory", {
      request: { path: path ?? null },
    }),
  getEffectiveConfig: (payload: Record<string, unknown> = {}) =>
    call<Record<string, unknown>>("get_effective_config", { request: payload }),
  listMemories: (cwd?: string | null, threadId?: string | null) =>
    call<Record<string, unknown>>("list_memories", {
      request: { cwd: cwd ?? null, threadId: threadId ?? null },
    }),
  saveMemory: (memory: Record<string, unknown>) =>
    call<Record<string, unknown>>("save_memory", {
      request: { entry: memory },
    }),
  deleteMemory: (memoryId: string) =>
    call<Record<string, unknown>>("delete_memory", { request: { memoryId } }),
  saveMemorySettings: (settings: Record<string, unknown>) =>
    call<Record<string, unknown>>("save_memory_settings", {
      request: settings,
    }),
  getUsageLedger: () =>
    call<Record<string, unknown>>("get_usage_ledger", { request: {} }),
  saveUsagePrice: (key: string, price: number) =>
    call<Record<string, unknown>>("save_usage_price", {
      request: { key, price },
    }),
  listSecrets: () =>
    call<Record<string, unknown>>("list_secrets", { request: {} }),
  saveSecret: (secret: Record<string, unknown>) =>
    call<Record<string, unknown>>("save_secret", { request: { secret } }),
  deleteSecret: (secretId: string) =>
    call<Record<string, unknown>>("delete_secret", { request: { secretId } }),
  listHooks: (cwd: string) =>
    call<Record<string, unknown>>("list_hooks", { request: { cwd } }),
  listLocalHooks: (cwd: string) =>
    call<Record<string, unknown>>("list_local_hooks", { request: { cwd } }),
  createHook: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("create_hook", { request: payload }),
  listScheduledTasks: () =>
    call<SchedulerSnapshot>("list_scheduled_tasks", { request: {} }),
  createScheduledTaskFromText: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("create_scheduled_task_from_text", {
      request: payload,
    }),
  updateScheduledTask: (taskId: string, patch: Record<string, unknown>) =>
    call<Record<string, unknown>>("update_scheduled_task", {
      request: { taskId, patch },
    }),
  markScheduledNotificationsRead: (runId?: string | null) =>
    call<SchedulerSnapshot>("mark_scheduled_notifications_read", {
      request: { runId: runId ?? null },
    }),
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
