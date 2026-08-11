import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  readText as readClipboardText,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { sendNotification } from "@tauri-apps/plugin-notification";

import type {
  AppError,
  AppUpdateState,
  BrowserAnnotation,
  BrowserBoundsRequest,
  BrowserState,
  CloudAccountState,
  DesktopEvent,
  EventEnvelope,
  FileEntry,
  FileSearchResult,
  GitDiff,
  GitState,
  Goal,
  LiveStatus,
  Preferences,
  ProjectAction,
  PromptSubmission,
  ProviderKind,
  ProviderSettings,
  RuntimeDiagnostics,
  SchedulerSnapshot,
  StreamEnvelope,
  TaskStartRequest,
  TerminalExit,
  TerminalSession,
} from "../types";
import { createDesktopApiClient } from "./desktopApi";

export type BrowserCommand =
  | {
      command: "createRoute";
      payload: { routeId: string; threadId: string; url: string };
    }
  | { command: "navigate"; payload: { routeId: string; url: string } }
  | {
      command:
        | "back"
        | "forward"
        | "reload"
        | "domSnapshot"
        | "visualSnapshot"
        | "developerInspect"
        | "closeRoute";
      payload: { routeId: string };
    }
  | {
      command: "resize";
      payload: {
        routeId: string;
        width: number;
        height: number;
        scaleFactor: number;
        visible: boolean;
      };
    }
  | {
      command: "click" | "hover";
      payload: { routeId: string; selector: string };
    }
  | {
      command: "fill";
      payload: { routeId: string; selector: string; value: string };
    }
  | {
      command: "select";
      payload: { routeId: string; selector: string; value: string };
    }
  | { command: "press"; payload: { routeId: string; key: string } }
  | { command: "scroll"; payload: { routeId: string; x: number; y: number } }
  | { command: "evaluate"; payload: { routeId: string; expression: string } }
  | {
      command: "pointer";
      payload: {
        routeId: string;
        kind: "move" | "down" | "up" | "wheel" | "leave";
        x: number;
        y: number;
        deltaX: number;
        deltaY: number;
        button: number;
        clickCount: number;
        modifiers: number;
      };
    }
  | {
      command: "key";
      payload: {
        routeId: string;
        kind: "down" | "up";
        keyCode: number;
        nativeKeyCode: number;
        character: string;
        modifiers: number;
      };
    };

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

export const desktopClient = {
  // Every call below crosses the one typed Tauri command boundary.
  activateDeepLinks: () => call<string[]>("activate_deep_links"),
  frontendReady: () => call<void>("frontend_ready"),
  listAgents: (parentThreadId?: string | null) =>
    call<{ agents?: Array<Record<string, unknown>> }>("list_agents", {
      request: { parentThreadId: parentThreadId ?? null },
    }),
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
    call<Array<Record<string, unknown>>>("get_thread_timeline", { threadId }),
  runtimeSnapshot: (threadId?: string | null) =>
    desktopApi.request("runtime.snapshot", { threadId: threadId ?? null }),
  getRuntimeSnapshot: (threadId?: string | null) =>
    desktopApi.request("runtime.snapshot", { threadId: threadId ?? null }),
  runtimeDiagnostics: () => desktopApi.request("runtime.diagnostics", {}),
  getRuntimeDiagnostics: () => desktopApi.request("runtime.diagnostics", {}),
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
    call<Goal>("set_goal", {
      request: {
        objective: request.objective,
        tokenBudget: request.tokenBudget ?? null,
        threadId: request.threadId ?? null,
      },
    }),
  updateGoal: (request: {
    threadId: string;
    action: string;
    value?: unknown;
  }) =>
    call<Goal | null>("update_goal", {
      request: { ...request, value: request.value ?? null },
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
    call<TerminalSession>("start_terminal", {
      request: {
        ...request,
        shell: request.shell ?? null,
        windowLabel: request.windowLabel ?? null,
      },
    }),
  writeTerminal: (processId: string, data: string) =>
    call<void>("write_terminal", { request: { processId, data } }),
  resizeTerminal: (processId: string, cols: number, rows: number) =>
    call<void>("resize_terminal", { request: { processId, cols, rows } }),
  terminateTerminal: (processId: string) =>
    call<void>("terminate_terminal", { request: { processId } }),
  gitState: (cwd: string) =>
    call<GitState>("get_git_state", { request: { cwd } }),
  getGitState: (cwd: string) =>
    call<GitState>("get_git_state", { request: { cwd } }),
  gitDiff: (cwd: string, filePath: string) =>
    call<GitDiff>("get_git_diff", { request: { cwd, filePath } }),
  getGitDiff: (cwd: string, filePath: string) =>
    call<GitDiff>("get_git_diff", { request: { cwd, filePath } }),
  mutateGit: (request: {
    cwd: string;
    action: string;
    paths?: string[];
    patch?: string | null;
  }) =>
    call<GitState>("mutate_git", {
      request: {
        ...request,
        paths: request.paths ?? [],
        patch: request.patch ?? null,
      },
    }),
  commitGit: (cwd: string, message: string) =>
    call<GitState>("commit_git", { request: { cwd, message } }),
  pushGit: (cwd: string, remote?: string | null) =>
    call<GitState>("push_git", { request: { cwd, remote: remote ?? null } }),
  listProjectFiles: (cwd: string, relative = "") =>
    call<FileEntry[]>("list_project_files", { request: { cwd, relative } }),
  searchProjectFiles: (cwd: string, query: string) =>
    call<FileSearchResult>("search_project_files", { request: { cwd, query } }),
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
  browserState: () => call<BrowserState>("get_browser_state"),
  restartBrowserHost: () => call<BrowserState>("restart_browser_host"),
  browserCommand: (command: BrowserCommand) =>
    call<Record<string, unknown>>("browser_command", { command }),
  browserSurfaceBounds: (request: BrowserBoundsRequest) =>
    call<Record<string, unknown>>("browser_surface_bounds", { request }),
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
  streamBrowser: (handler: (event: StreamEnvelope) => void) => {
    if (!isTauriRuntime()) return Promise.resolve();
    const channel = new Channel<StreamEnvelope>(handler);
    return call<void>("stream_browser", { channel });
  },
  streamLive: (handler: (event: StreamEnvelope) => void) => {
    if (!isTauriRuntime()) return Promise.resolve();
    const channel = new Channel<StreamEnvelope>(handler);
    return call<void>("stream_live", { channel });
  },
  listBrowserAnnotations: (routeId: string) =>
    call<BrowserAnnotation[]>("list_browser_annotations", { routeId }),
  saveBrowserAnnotation: (annotation: BrowserAnnotation) =>
    call<BrowserAnnotation>("save_browser_annotation", { annotation }),
  deleteBrowserAnnotation: (id: string) =>
    call<boolean>("delete_browser_annotation", { request: { id } }),
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
    call<Record<string, unknown>>("read_generated_image", {
      request: { imagePath, threadId: threadId ?? null },
    }),
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
    call<Record<string, unknown>>("open_local_artifact", {
      request: { path, threadId: threadId ?? null, preview: true },
    }),
  newTask: (cwd?: string) =>
    call<Record<string, unknown>>("new_task", {
      request: { cwd: cwd ?? null },
    }),
  getProviderSettings: (type: ProviderKind, threadId?: string | null) =>
    call<ProviderSettings>("get_provider_settings", {
      request: { type, threadId: threadId ?? null },
    }),
  setThreadReasoningEffort: (
    threadId: string,
    effort: string,
    model?: string | null,
  ) =>
    call<Record<string, unknown>>("set_thread_reasoning_effort", {
      request: { threadId, effort, model: model ?? null },
    }),
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
  resumeThread: (threadId: string) =>
    call<Record<string, unknown>>("resume_thread", { request: { threadId } }),
  forkThread: (threadId: string) =>
    call<Record<string, unknown>>("fork_thread", { request: { threadId } }),
  archiveThread: (threadId: string) =>
    call<Record<string, unknown>>("archive_thread", { request: { threadId } }),
  unarchiveThread: (threadId: string) =>
    call<Record<string, unknown>>("unarchive_thread", {
      request: { threadId },
    }),
  pinThread: (threadId: string, pinned: boolean) =>
    call<Record<string, unknown>>("pin_thread", {
      request: { threadId, pinned },
    }),
  markThreadUnread: (threadId: string, unread: boolean) =>
    call<Record<string, unknown>>("mark_thread_unread", {
      request: { threadId, unread },
    }),
  renameThread: (threadId: string, name: string) =>
    call<Record<string, unknown>>("rename_thread", {
      request: { threadId, name },
    }),
  autoNameThread: (threadId: string, text: string, model?: string | null) =>
    call<Record<string, unknown>>("auto_name_thread", {
      request: { threadId, text, model: model ?? null },
    }),
  revealThread: (threadId: string) =>
    call<Record<string, unknown>>("reveal_thread", { request: { threadId } }),
  showTerminalContextMenu: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("show_terminal_context_menu", {
      request: payload,
    }),
  setTerminalFocused: (focused: boolean, processId?: string | null) =>
    call<Record<string, unknown>>("set_terminal_focused", {
      request: { focused, processId: processId ?? null },
    }),
  updateProject: (projectPath: string, action: string, value?: unknown) =>
    call<Record<string, unknown>>("update_project", {
      request: { projectPath, action, value: value ?? null },
    }),
  revealProject: (projectPath: string) =>
    call<Record<string, unknown>>("reveal_project", {
      request: { projectPath },
    }),
  archiveProjectTasks: (projectPath: string) =>
    call<Record<string, unknown>>("archive_project_tasks", {
      request: { projectPath },
    }),
  readyTerminal: (processId: string) =>
    call<Record<string, unknown>>("ready_terminal", { request: { processId } }),
  initGitRepository: (cwd: string) =>
    call<GitState>("init_git_repository", { request: { cwd } }),
  getGitHunks: (cwd: string, filePath: string) =>
    call<Record<string, unknown>>("get_git_hunks", {
      request: { cwd, filePath },
    }),
  mutateGitHunk: (payload: Record<string, unknown>) =>
    call<GitState>("mutate_git_hunk", { request: payload }),
  preparePullRequest: (cwd: string, base?: string | null) =>
    call<Record<string, unknown>>("prepare_pull_request", {
      request: { cwd, base: base ?? null },
    }),
  startReview: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("start_review", { request: payload }),
  submitReviewComments: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("submit_review_comments", {
      request: payload,
    }),
  openEditor: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("open_editor", { request: payload }),
  restartRuntime: () =>
    call<RuntimeDiagnostics>("restart_runtime", { request: {} }),
  listExtensions: (cwd?: string | null) =>
    call<Record<string, unknown>>("list_extensions", {
      request: { cwd: cwd ?? null },
    }),
  setSkillEnabled: (skillPath: string, enabled: boolean) =>
    call<Record<string, unknown>>("set_skill_enabled", {
      request: { skillPath, enabled },
    }),
  installPlugin: (plugin: Record<string, unknown>) =>
    call<Record<string, unknown>>("install_plugin", { request: plugin }),
  uninstallPlugin: (pluginId: string) =>
    call<Record<string, unknown>>("uninstall_plugin", {
      request: { pluginId },
    }),
  activateIndustryPlugin: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("activate_industry_plugin", {
      request: payload,
    }),
  deactivateIndustryPlugin: (pluginId: string) =>
    call<Record<string, unknown>>("deactivate_industry_plugin", {
      request: { pluginId },
    }),
  reloadMcp: () => call<Record<string, unknown>>("reload_mcp", { request: {} }),
  syncPluginCatalog: (url?: string | null) =>
    call<Record<string, unknown>>("sync_plugin_catalog", {
      request: { url: url ?? null },
    }),
  startConnectorOauth: (pluginId: string) =>
    call<Record<string, unknown>>("start_connector_oauth", {
      request: { pluginId },
    }),
  completeConnectorOauth: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("complete_connector_oauth", {
      request: payload,
    }),
  disconnectConnector: (pluginId: string) =>
    call<Record<string, unknown>>("disconnect_connector", {
      request: { pluginId },
    }),
  discoverModels: () =>
    call<Record<string, unknown>>("discover_models", { request: {} }),
  validateModel: (providerType: string, modelId: string) =>
    call<Record<string, unknown>>("validate_model", {
      request: { providerType, modelId },
    }),
  listAgentProfiles: () =>
    call<Record<string, unknown>>("list_agent_profiles", { request: {} }),
  saveAgentProfile: (profile: Record<string, unknown>) =>
    call<Record<string, unknown>>("save_agent_profile", {
      request: { profile },
    }),
  deleteAgentProfile: (profileId: string) =>
    call<Record<string, unknown>>("delete_agent_profile", {
      request: { profileId },
    }),
  spawnAgent: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("spawn_agent", { request: payload }),
  createAgentTask: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("create_agent_task", { request: payload }),
  dispatchAgentTask: (taskId: string) =>
    call<Record<string, unknown>>("dispatch_agent_task", {
      request: { taskId },
    }),
  removeAgentTask: (taskId: string) =>
    call<Record<string, unknown>>("remove_agent_task", { request: { taskId } }),
  messageAgent: (agentId: string, text: string) =>
    call<Record<string, unknown>>("message_agent", {
      request: { agentId, text },
    }),
  stopAgent: (agentId: string) =>
    call<Record<string, unknown>>("stop_agent", { request: { agentId } }),
  readAgent: (agentId: string) =>
    call<Record<string, unknown>>("read_agent", { request: { agentId } }),
  listWorktrees: (cwd: string) =>
    call<Record<string, unknown>>("list_worktrees", { request: { cwd } }),
  createWorktree: (payload: Record<string, unknown>) =>
    call<Record<string, unknown>>("create_worktree", { request: payload }),
  handoffWorktree: (worktreePath: string) =>
    call<Record<string, unknown>>("handoff_worktree", {
      request: { worktreePath },
    }),
  snapshotWorktree: (worktreePath: string) =>
    call<Record<string, unknown>>("snapshot_worktree", {
      request: { worktreePath },
    }),
  removeWorktree: (worktreePath: string, root?: string | null) =>
    call<Record<string, unknown>>("remove_worktree", {
      request: { worktreePath, root: root ?? null },
    }),
  getContextState: (threadId?: string | null) =>
    call<Record<string, unknown>>("get_context_state", {
      request: { threadId: threadId ?? null },
    }),
  compactContext: (threadId?: string | null) =>
    call<Record<string, unknown>>("compact_context", {
      request: { threadId: threadId ?? null },
    }),
  recalibrateContext: (threadId?: string | null) =>
    call<Record<string, unknown>>("recalibrate_context", {
      request: { threadId: threadId ?? null },
    }),
  steerTurn: (text: string, threadId?: string | null) =>
    call<Record<string, unknown>>("steer_turn", {
      request: { text, threadId: threadId ?? null },
    }),
  queueMessage: (text: string, threadId?: string | null) =>
    call<Record<string, unknown>>("queue_message", {
      request: { text, threadId: threadId ?? null },
    }),
  deleteQueuedMessage: (queueId: string, threadId?: string | null) =>
    call<Record<string, unknown>>("delete_queued_message", {
      request: { queueId, threadId: threadId ?? null },
    }),
  steerQueuedMessage: (queueId: string, threadId?: string | null) =>
    call<Record<string, unknown>>("steer_queued_message", {
      request: { queueId, threadId: threadId ?? null },
    }),
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
  resolveApproval: (requestId: string, decision: string) =>
    call<Record<string, unknown>>("resolve_approval", {
      request: { requestId, decision },
    }),
  resolveUserInput: (requestId: string, answers: Record<string, string[]>) =>
    call<Record<string, unknown>>("resolve_user_input", {
      request: { requestId, answers },
    }),
  navigate: (url: string, routeId: string) =>
    call<Record<string, unknown>>("browser_navigate", {
      request: { url, routeId },
    }),
  getQuickLauncherSuggestions: (
    cwd: string,
    routeId?: string | null,
    query = "",
  ) =>
    call<Array<Record<string, unknown>>>("get_quick_launcher_suggestions", {
      request: { cwd, routeId: routeId ?? null, query },
    }),
  getProjectActions: (cwd: string) =>
    call<ProjectAction[]>("get_project_actions", { request: { cwd } }),
  authorizeProjectAction: (payload: Record<string, unknown>) =>
    call<ProjectAction & { authorized?: boolean }>("authorize_project_action", {
      request: payload,
    }),
  openWorkspaceFile: (cwd: string, filePath: string, routeId?: string | null) =>
    call<Record<string, unknown>>("open_workspace_file", {
      request: { cwd, path: filePath, routeId: routeId ?? null },
    }),
  back: (routeId: string) =>
    call<Record<string, unknown>>("browser_back", { request: { routeId } }),
  forward: (routeId: string) =>
    call<Record<string, unknown>>("browser_forward", { request: { routeId } }),
  reload: (routeId: string) =>
    call<Record<string, unknown>>("browser_reload", { request: { routeId } }),
  captureBrowserVisualSnapshot: (routeId: string) =>
    call<Record<string, unknown>>("capture_browser_visual_snapshot", {
      request: { routeId },
    }),
  inspectBrowserDeveloperState: (routeId: string) =>
    call<Record<string, unknown>>("inspect_browser_developer_state", {
      request: { routeId },
    }),
  beginBrowserAnnotation: (routeId: string) =>
    call<Record<string, unknown>>("begin_browser_annotation", {
      request: { routeId },
    }),
  cancelBrowserAnnotation: (routeId: string) =>
    call<Record<string, unknown>>("cancel_browser_annotation", {
      request: { routeId },
    }),
  getBrowserSessionStatus: (routeId: string) =>
    call<Record<string, unknown>>("get_browser_session_status", {
      request: { routeId },
    }),
  openBrowserSignIn: (providerId: string, routeId: string) =>
    call<Record<string, unknown>>("open_browser_sign_in", {
      request: { providerId, routeId },
    }),
  clearBrowserSession: (providerId: string, routeId: string) =>
    call<Record<string, unknown>>("clear_browser_session", {
      request: { providerId, routeId },
    }),
  clearAllBrowserData: (routeId: string) =>
    call<Record<string, unknown>>("clear_all_browser_data", {
      request: { routeId, all: true },
    }),
  clearBrowserDataFromSettings: () =>
    call<Record<string, unknown>>("clear_browser_data_from_settings", {
      request: { all: true },
    }),
  fillSavedBrowserCredential: (routeId: string) =>
    call<Record<string, unknown>>("fill_saved_browser_credential", {
      request: { routeId },
    }),
  listBrowserImportProfiles: () =>
    call<Record<string, unknown>>("list_browser_import_profiles", {
      request: {},
    }),
  importBrowserProfile: (
    payload: Record<string, unknown>,
    routeId?: string | null,
  ) =>
    call<Record<string, unknown>>("import_browser_profile", {
      request: { ...payload, routeId: routeId ?? payload.routeId ?? null },
    }),
  attachBrowser: (webContentsId: string, routeId: string) =>
    call<Record<string, unknown>>("attach_browser", {
      request: { webContentsId, routeId },
    }),
  activateBrowserTab: (threadId: string, routeId: string) =>
    call<Record<string, unknown>>("activate_browser_tab", {
      request: { threadId, routeId },
    }),
  detachBrowserTab: (routeId: string) =>
    call<Record<string, unknown>>("detach_browser_tab", {
      request: { routeId },
    }),
  onDesktopEvent: (handler: (event: DesktopEvent) => void) =>
    desktopApi.subscribe(handler),
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
