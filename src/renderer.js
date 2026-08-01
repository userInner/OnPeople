const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const isMacOS = navigator.userAgent.includes("Macintosh");
const isWindows = navigator.userAgent.includes("Windows");
document.documentElement.classList.toggle("platform-macos", isMacOS);
document.documentElement.classList.toggle("platform-windows", isWindows);
const confirmAction = (message, options = {}) => window.OnPeopleUI.confirm(message, options);

if (isWindows) {
  $("#computer-capability-copy").textContent = "控制 Windows 前台应用";
  $("#composer-hint").textContent = "Enter 发送 · Shift Enter 换行 · Ctrl+V 粘贴图片 · 原生工具操作会按策略请求批准";
  $("#task-shortcut").textContent = "Ctrl+Alt+S";
  $("#browser-shortcut").textContent = "Ctrl+T";
  $("#profile-import-copy").textContent = "Windows 浏览器资料导入需要兼容的本机模块；OnPeople 独立浏览器登录状态仍会持续保存。";
  $("#secret-storage-copy").textContent = "Windows 系统安全存储加密";
}

const runtime = $(".runtime-status");
const runtimeLabel = $("#runtime-label");
const timeline = $("#timeline");
// Auto-scroll only while the user is already at the bottom — scrolling up to
// read earlier output must not be hijacked by streaming updates.
let timelineStickToBottom = true;
timeline.addEventListener("scroll", () => {
  timelineStickToBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 48;
}, { passive: true });

function scrollTimelineToBottom(force = false) {
  if (!force && !timelineStickToBottom) return;
  timeline.scrollTop = timeline.scrollHeight;
  timelineStickToBottom = true;
}

function scrollTimelineToBottomImmediately() {
  const alreadyInstant = timeline.classList.contains("instant-scroll");
  timeline.classList.add("instant-scroll");
  timeline.scrollTop = timeline.scrollHeight;
  timelineStickToBottom = true;
  if (!alreadyInstant) {
    requestAnimationFrame(() => timeline.classList.remove("instant-scroll"));
  }
}

const composerDock = $(".composer-dock");
const composer = $("#composer");
let composerClearanceFrame = 0;

function syncComposerClearance() {
  if (composerClearanceFrame) cancelAnimationFrame(composerClearanceFrame);
  composerClearanceFrame = requestAnimationFrame(() => {
    composerClearanceFrame = 0;
    const wasPinnedToBottom = timelineStickToBottom;
    const clearance = Math.ceil(composerDock.getBoundingClientRect().height + 20);
    timeline.style.setProperty("--composer-clearance", `${clearance}px`);
    if (wasPinnedToBottom) scrollTimelineToBottomImmediately();
  });
}

const composerResizeObserver = new ResizeObserver(syncComposerClearance);
composerResizeObserver.observe(composerDock);
syncComposerClearance();

const promptInput = $("#prompt");
const sendButton = $("#send");
const liveStartButton = $("#live-start");
const liveCallPanel = $("#live-call-panel");
const liveCallTitle = $("#live-call-title");
const liveCallStatus = $("#live-call-status");
const liveCallTranscript = $("#live-call-transcript");
const liveCallDuration = $("#live-call-duration");
const liveMuteButton = $("#live-mute");
const liveMuteLabel = $("#live-mute-label");
const liveEndButton = $("#live-end");
const liveAudio = $("#live-audio");
const threadLabel = $("#thread-label");
const taskTitle = $("#task-title");
const taskList = $("#task-list");
const pinnedTaskList = $("#pinned-task-list");
const pinnedSection = $("#pinned-section");
const taskSearch = $("#task-search");
const providerSelect = $("#provider");
const providerWrap = $("#provider-wrap");
const providerLabel = $("#provider-label");
const modelSourceSwitch = $("#model-source-switch");
const modelSourceCopy = $("#model-source-copy");
const modelSourceIndicator = $("#model-source-indicator");
const modelSourceAccount = $("#model-source-account");
const modelInput = $("#model");
const modelOptions = $("#model-options");
const modelInputWrap = $("#model-input-wrap");
const onpeopleModelWrap = $("#onpeople-model-wrap");
const onpeopleModelSelect = $("#onpeople-model");
const taskModelPicker = $("#task-model-picker");
const taskModelTrigger = $("#task-model-trigger");
const taskModelPopover = $("#task-model-popover");
const taskModelLabel = $("#task-model-label");
const taskEffortLabel = $("#task-effort-label");
const taskModelOptions = $("#task-model-options");
const taskEffortOptions = $("#task-effort-options");
const baseUrlInput = $("#base-url");
const apiKeyInput = $("#api-key");
const providerStatus = $("#provider-status");
const modelCapability = $("#model-capability");
const appUpdateVersion = $("#app-update-version");
const appUpdateStatus = $("#app-update-status");
const appUpdateAction = $("#app-update-action");
const appUpdateProgress = $("#app-update-progress");
const cloudAccountDialog = $("#cloud-account-dialog");
const cloudAccountStatus = $("#cloud-account-status");
const usageProfileDialog = $("#usage-profile-dialog");
const settingsCenter = $("#settings-center");
const settingsGeneralPage = $("#settings-general-page");
const settingsProfilePage = $("#settings-profile-page");
const settingsRuntimePage = $("#settings-runtime-page");
const settingsAppearancePage = $("#settings-appearance-page");
const settingsVoicePage = $("#settings-voice-page");
const settingsPersonalizationPage = $("#settings-personalization-page");
const settingsPetPage = $("#settings-pet-page");
const settingsShortcutsPage = $("#settings-shortcuts-page");
const settingsBrowserPage = $("#settings-browser-page");
const settingsLivePage = $("#settings-live-page");
const settingsLiveHost = $("#settings-live-host");
const settingsFeaturePage = $("#settings-feature-page");
const attachImageButton = $("#attach-image");
const imageAttachments = $("#image-attachments");
const capabilityMenu = $("#capability-menu");
const capabilitySelection = $("#capability-selection");
const cwdInput = $("#cwd");
const composerWorkspace = $("#composer-workspace");
const composerWorkspaceLabel = $("#composer-workspace-label");
const composerWorkspaceMenu = $("#composer-workspace-menu");
const composerWorkspaceDetail = $("#composer-workspace-detail");
const composerWorkspaceSearch = $("#composer-workspace-search");
const composerWorkspaceSection = $(".composer-workspace-section");
const composerWorkspaceRecents = $("#composer-workspace-recents");
const appShell = $("#app-shell");
const contentArea = $("#content-area");
const primaryWorkspace = $("#primary-workspace");
const utilityPanel = $("#utility-panel");
const controlViewContainer = $(".control-view");
let activeSettingsLivePanel = null;
let activeSettingsLivePanelOrigin = null;
let activeSettingsLiveUtilityView = null;
let activeSettingsPreviousControlView = null;
const terminalDock = $("#terminal-dock");
const terminalResizer = $("#terminal-resizer");
const workspaceResizer = $("#workspace-resizer");
const browserSlot = $("#browser-slot");
const browserView = $(".browser-view");
let embeddedBrowser = $("#embedded-browser");
const browserHomeUrl = embeddedBrowser.getAttribute("src");
const address = $("#address");
const permission = $("#site-permission");
const quickLauncher = $("#quick-launcher");
const quickLauncherToggle = $("#quick-launcher-toggle");
const quickLauncherRecommendations = $("#quick-launcher-recommendations");
const browserAccountSheet = $("#browser-account-sheet");
const profileImportDialog = $("#profile-import-dialog");
const profileImportSelect = $("#profile-import-select");
const textInputDialog = $("#text-input-dialog");
const textInputForm = $("#text-input-form");
const textInputTitle = $("#text-input-dialog-title");
const textInputDescription = $("#text-input-dialog-description");
const textInputValue = $("#text-input-value");
const textInputSubmit = $("#text-input-submit");
const modeOptions = $$(".mode-option");
const goalBudgetWrap = $("#goal-budget-wrap");
const goalBudget = $("#goal-budget");
const goalBudgetMode = $("#goal-budget-mode");
const DEFAULT_PROMPT_PLACEHOLDER = "今天帮你做些什么？  通过＋添加文件、技能与能力";
const goalPanel = $("#goal-panel");
const goalStatus = $("#goal-status");
const goalObjective = $("#goal-objective");
const goalUsage = $("#goal-usage");
const goalPause = $("#goal-pause");
const initialTimeline = timeline.innerHTML;
const traceFormatter = window.OnPeopleTrace;

$("#settings-profile-tabs-host").append($(".usage-profile-tabs"));
$("#settings-usage-host").append($("#usage-profile-view"), $("#usage-leaderboard-view"));
const runtimeSettingsPanel = $(".runtime-settings");
runtimeSettingsPanel.open = true;
$("#settings-runtime-host").append(runtimeSettingsPanel);

const PROVIDER_PRESETS = {
  onpeople: { model: "", baseUrl: "https://api.aibro.vip/v1", vision: true, protocol: "OnPeople Responses API", models: [] },
  openai: { model: "gpt-5.6-terra", baseUrl: "https://api.openai.com/v1", vision: true, protocol: "Responses API" },
  deepseek: { model: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com", vision: false, protocol: "内嵌 Chat 适配" },
  minimax: { model: "MiniMax-M2.7", baseUrl: "https://api.minimaxi.com/v1", vision: true, protocol: "内嵌 Chat 适配" },
  kimi: { model: "kimi-k2.6", baseUrl: "https://api.moonshot.cn/v1", vision: true, protocol: "内嵌 Chat 适配" },
  grok: { model: "grok-4.5", baseUrl: "https://api.x.ai/v1", vision: true, protocol: "Responses API" },
  compatible: { model: "", baseUrl: "https://api.openai.com/v1", vision: true, protocol: "Responses API" },
  ollama: { model: "", baseUrl: "", vision: false, protocol: "本地运行时" },
  lmstudio: { model: "", baseUrl: "", vision: false, protocol: "本地运行时" },
};

const MODEL_SOURCE_PROVIDERS = {
  onpeople: ["onpeople"],
  router: ["openai", "deepseek", "minimax", "kimi", "grok", "compatible"],
  local: ["ollama", "lmstudio"],
};
const lastProviderBySource = { router: "openai", local: "ollama" };

const TOOL_COPY = {
  browser: ["浏览器", "隔离会话与 Agent 导航"],
  terminal: ["终端", "工作区交互式 PTY"],
  changes: ["变更", "Git Diff 与代码审阅"],
  files: ["项目文件", "安全导航、搜索与预览"],
  extensions: ["扩展", "Skills、Plugins 与 MCP"],
  control: ["控制", "子 Agent、计划任务与运行状态"],
};

const CAPABILITY_COPY = {
  documents: "Documents · DOCX",
  pdf: "PDF",
  spreadsheets: "Spreadsheets · XLSX",
  presentations: "Presentations · PPTX",
  templates: "Template Creator",
  sites: "Sites",
  browser: "浏览器",
  computer: "电脑",
  visualize: "Visualize",
  imagegen: "Image generation",
  "default-templates": "Default templates",
};

let currentThreadId = null;
const BROWSER_TAB_STORAGE_KEY = "onpeople.browser-tabs.v1";
const MAX_BROWSER_TABS_PER_TASK = 8;
const BROWSER_GROUP_IDLE_UNLOAD_MS = 60_000;
const BUSY_BROWSER_THREAD_STATES = new Set(["working", "running", "waiting-approval", "restoring", "queued"]);
let draftBrowserTaskId = `draft-${crypto.randomUUID()}`;
let activeBrowserTaskId = draftBrowserTaskId;
let activeBrowserRouteId = null;
const browserTabs = new Map();
const browserTaskGroups = new Map();
let cloudAccountState = {
  signedIn: false,
  serviceUrl: "https://api.aibro.vip",
  account: null,
  models: [],
  modelsLive: false,
  modelsError: null,
};
let cloudUsageProfile = null;
let activeUsageProfileView = "profile";
let activeLeaderboardPeriod = "all";
let providerDraftSequence = 0;
let pendingCloudSourceSelection = false;
let selectedProjectPath = null;
let loadedThreads = [];
let loadedProjects = [];
const threadRuntimeStates = new Map();
const pendingUserMessages = new Map();
let currentGoal = null;
let selectedMode = "default";
let selectedImages = [];
let selectedAttachments = [];
let selectedCapability = null;
let providerImageGeneration = { available: false, reason: "当前 Provider 未声明兼容的 Images API" };
let computerCapability = { available: false, reason: "Computer Use 尚未就绪" };
const imagePreviewUrls = new Map();
let selectedModelVision = null;
let selectedReasoningEffort = "high";
let activeAgentMessage = null;
let running = false;
let submitting = false;
let threadSwitchSequence = 0;
let pendingThreadId = null;
let showingArchived = false;
let searchTimer = null;
let threadListRequestSequence = 0;
let agentRequestSequence = 0;
let workspaceStateEpoch = 0;
let defaultWorkspaceCwd = "";
let selectedWorkspaceMode = "isolated";
let selectedWorkspaceBaseCwd = null;
let terminal = null;
let terminalProcessId = null;
let activeTerminalId = null;
const terminalSessions = new Map();
let terminalSequence = 0;
let terminalMenuBound = false;
let terminalCopyStatusTimer = null;
let activeToolView = "browser";
const utilityStateByTask = new Map();
let extensionRefreshTimer = null;
let extensionsRefreshing = false;
let terminalDockOpen = false;
const traceCards = new Map();
const generatedImageCards = new Map();
let traceSequence = 0;
let managedAgentState = [];
let agentBoardState = { tasks: [], counts: {}, states: [] };
let activeAgentBoardFilter = "all";
let agentSurfaceExplicitlyRequested = false;
let policyState = null;
let appPreferences = {
  defaultFileOpener: "smart",
  language: "auto",
  preventSleepWhileRunning: false,
  showComposerFooter: true,
  showSuggestions: true,
  keepInMenuBar: false,
  theme: "system",
  density: "comfortable",
  reduceMotion: false,
  customInstructions: "",
  browserEnabled: true,
  browserOpenLinks: "tab",
  downloadDirectory: "",
  askDownloadLocation: false,
  liveVoice: "cove",
  liveEchoCancellation: true,
  liveNoiseSuppression: true,
  liveAutoGainControl: true,
};
let auditState = [];
let activeControlView = "diagnostics";
let pendingBrowserAnnotationTarget = null;
let currentGitState = null;
let selectedGitFile = null;
let gitBusy = false;
let currentFilePath = "";
let currentFileParent = null;
let fileSearchTimer = null;
let schedulerState = { tasks: [], runs: [], unread: 0 };
let scheduledCenterMode = "inbox";
const reviewComments = new Map();
let agentProfiles = [];
let memoryState = { enabled: true, generate: false, entries: [] };
let commandPaletteItems = [];
let commandPaletteSelection = 0;
let activeTaskContextMenu = null;
let renderingThreadHistory = false;
let pendingTextInputResolve = null;
let activeProcessFlow = null;
let activeAgentMessagePhase = null;
let currentTurnStartedAt = null;
let appUpdateState = null;
let liveConversation = null;
let pendingLiveDelegation = null;
let lastLiveUserTranscript = "";
let liveDelegationFallbackTimer = null;
const liveTranscriptHistory = new Map();
const LIVE_TRANSCRIPT_DEDUPE_WINDOW_MS = 60_000;
const LIVE_DELEGATION_FALLBACK_DELAY_MS = 700;
const liveDelegationPolicy = window.OnPeopleLiveDelegation;

function renderAppUpdate(state = {}) {
  appUpdateState = state;
  appUpdateVersion.textContent = `OnPeople ${state.currentVersion ? `v${state.currentVersion}` : ""}`.trim();
  appUpdateStatus.textContent = state.message || "更新状态不可用";
  const downloading = state.status === "downloading";
  appUpdateProgress.hidden = !downloading;
  if (downloading) appUpdateProgress.value = Number(state.percent) || 0;

  appUpdateAction.disabled = ["checking", "downloading", "installing"].includes(state.status);
  if (state.status === "store-managed") appUpdateAction.textContent = "Microsoft Store";
  else if (!state.supported) appUpdateAction.textContent = "下载最新版";
  else if (state.status === "checking") appUpdateAction.textContent = "检查中…";
  else if (state.status === "available") appUpdateAction.textContent = "下载更新";
  else if (state.status === "downloading") appUpdateAction.textContent = `${Math.round(Number(state.percent) || 0)}%`;
  else if (state.status === "downloaded") appUpdateAction.textContent = "重启安装";
  else if (state.status === "installing") appUpdateAction.textContent = "正在重启…";
  else if (state.status === "error") appUpdateAction.textContent = "重试";
  else appUpdateAction.textContent = "检查更新";
}

function finishTextInput(value = null) {
  const resolve = pendingTextInputResolve;
  pendingTextInputResolve = null;
  if (textInputDialog.open) textInputDialog.close();
  resolve?.(value);
}

function requestText({
  title = "编辑文本",
  description = "输入新的内容。",
  value = "",
  placeholder = "",
  confirmLabel = "保存",
  maxLength = 120,
} = {}) {
  if (pendingTextInputResolve) finishTextInput(null);
  textInputTitle.textContent = title;
  textInputDescription.textContent = description;
  textInputValue.value = String(value || "");
  textInputValue.placeholder = placeholder;
  textInputValue.maxLength = maxLength;
  textInputValue.setCustomValidity("");
  textInputSubmit.textContent = confirmLabel;
  textInputDialog.showModal();
  requestAnimationFrame(() => {
    textInputValue.focus();
    textInputValue.select();
  });
  return new Promise((resolve) => {
    pendingTextInputResolve = resolve;
  });
}

textInputForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = textInputValue.value.trim();
  if (!value) {
    textInputValue.setCustomValidity("请输入内容");
    textInputValue.reportValidity();
    return;
  }
  finishTextInput(value);
});
textInputValue.addEventListener("input", () => textInputValue.setCustomValidity(""));
$("#text-input-cancel").addEventListener("click", () => finishTextInput(null));
$("#text-input-close").addEventListener("click", () => finishTextInput(null));
textInputDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishTextInput(null);
});
textInputDialog.addEventListener("close", () => {
  if (pendingTextInputResolve) finishTextInput(null);
});

function setRuntime(state, label) {
  if (!runtime || !runtimeLabel) return;
  runtime.className = `runtime-status ${state}`;
  runtimeLabel.textContent = label;
}

const WORKSPACE_MODE_LABELS = {
  isolated: "独立空间",
  local: "本地项目",
  worktree: "Git Worktree",
};

function setWorkspaceMenu(open) {
  const visible = Boolean(open);
  if (visible) renderWorkspaceRecents();
  composerWorkspaceMenu.hidden = !visible;
  composerWorkspace.setAttribute("aria-expanded", String(visible));
  if (visible) window.setTimeout(() => {
    const target = composerWorkspaceSearch.parentElement.hidden
      ? composerWorkspaceMenu.querySelector('[aria-checked="true"]')
      : composerWorkspaceSearch;
    target?.focus();
  }, 0);
  else composerWorkspaceSearch.value = "";
}

function recentWorkspaceEntries() {
  const entries = new Map();
  const remember = (candidate, name = null, pinned = false) => {
    const workspacePath = String(candidate || "").trim();
    if (!workspacePath) return;
    const existing = entries.get(workspacePath);
    entries.set(workspacePath, {
      path: workspacePath,
      name: name || existing?.name || workspacePath.split("/").filter(Boolean).at(-1) || "Workspace",
      pinned: Boolean(pinned || existing?.pinned),
    });
  };
  for (const project of loadedProjects) {
    if (!project?.hidden) remember(project?.path, project?.name, project?.pinned);
  }
  for (const thread of loadedThreads) {
    if (thread?.workspaceMode === "local") remember(thread.workspaceBaseCwd || thread.cwd, thread.projectName);
    else if (thread?.workspaceMode === "worktree") remember(thread.workspaceBaseCwd, thread.projectName);
  }
  return [...entries.values()]
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.name.localeCompare(right.name, "zh-CN"))
    .slice(0, 8);
}

function renderWorkspaceRecents() {
  const query = composerWorkspaceSearch.value.trim().toLocaleLowerCase();
  const selectedPath = selectedWorkspaceBaseCwd || cwdInput.value.trim();
  const allEntries = recentWorkspaceEntries();
  composerWorkspaceSearch.parentElement.hidden = allEntries.length < 5;
  composerWorkspaceSection.hidden = allEntries.length === 0;
  const entries = allEntries.filter((entry) => (
    !query || entry.name.toLocaleLowerCase().includes(query) || entry.path.toLocaleLowerCase().includes(query)
  ));
  composerWorkspaceRecents.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("span");
    empty.className = "composer-workspace-empty";
    empty.textContent = query ? "没有匹配的工作空间" : "还没有最近使用的工作空间";
    composerWorkspaceRecents.append(empty);
    return;
  }
  for (const entry of entries) {
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "menuitemradio");
    option.setAttribute("aria-checked", String(selectedWorkspaceMode === "local" && selectedPath === entry.path));
    option.dataset.workspacePath = entry.path;
    option.innerHTML = `<i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 8V6.8A2.8 2.8 0 0 1 6.3 4h3.1l2 2h6.3a2.8 2.8 0 0 1 2.8 2.8V17a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3Z"/></svg></i><span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.path)}</small></span><b>✓</b>`;
    composerWorkspaceRecents.append(option);
  }
}

function renderWorkspaceSelection() {
  const cwd = cwdInput.value.trim();
  const mode = WORKSPACE_MODE_LABELS[selectedWorkspaceMode] ? selectedWorkspaceMode : (cwd ? "local" : "isolated");
  selectedWorkspaceMode = mode;
  const baseName = (selectedWorkspaceBaseCwd || cwd).split("/").filter(Boolean).at(-1);
  composerWorkspaceLabel.textContent = mode === "isolated"
    ? "独立空间"
    : `${WORKSPACE_MODE_LABELS[mode]}${baseName ? ` · ${baseName}` : ""}`;
  composerWorkspace.title = currentThreadId
    ? `当前任务工作空间：${cwd || "未设置"}；选择其他空间会新建任务`
    : mode === "isolated"
      ? "首次发送时创建独立工作空间"
      : `${WORKSPACE_MODE_LABELS[mode]}：${selectedWorkspaceBaseCwd || cwd || "请选择项目"}`;
  for (const option of composerWorkspaceMenu.querySelectorAll("[data-workspace-mode]")) {
    option.setAttribute("aria-checked", String(option.dataset.workspaceMode === mode));
  }
  renderWorkspaceRecents();
  composerWorkspaceDetail.textContent = mode === "isolated"
    ? (currentThreadId ? "当前任务的目录保持不变；选择其他空间会创建新任务。" : "首次发送时创建独立目录，不读取其他任务的文件。")
    : mode === "worktree"
      ? (selectedWorkspaceBaseCwd ? `将从 ${selectedWorkspaceBaseCwd} 的 HEAD 创建隔离副本。` : "选择一个 Git 项目作为 Worktree 起点。")
      : (cwd ? `将直接在 ${cwd} 中工作。` : "选择一个现有项目文件夹。");
}

function updateProject(cwd) {
  const value = String(cwd || "").replace(/\/$/, "");
  const pathLabel = $("#project-path");
  const nameLabel = $("#project-name");
  if (pathLabel) pathLabel.textContent = value || "未设置工作目录";
  if (nameLabel) nameLabel.textContent = value.split("/").filter(Boolean).pop() || "Workspace";
  renderWorkspaceSelection();
  if (!nameLabel && $("#project-list")) renderProjects(loadedThreads);
}

function titleFrom(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > 46 ? `${clean.slice(0, 46)}…` : (clean || "未命名任务");
}

function browserTabRouteId() {
  return `browser-tab-${crypto.randomUUID()}`;
}

function browserTabHomeUrl(url) {
  const value = String(url || "");
  return !value || value.startsWith("data:") || value.endsWith("/browser-home.html");
}

function browserTabTitle(record) {
  const title = String(record?.title || "").replace(/\s+/g, " ").trim();
  if (title && title !== "OnPeople 浏览器") return title.length > 24 ? `${title.slice(0, 24)}…` : title;
  const url = String(record?.url || "");
  if (browserTabHomeUrl(url)) return "新标签页";
  try {
    const parsed = new URL(url);
    const file = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (/\.pdf$/i.test(file)) return file.replace(/\.pdf$/i, "") || "PDF";
    return parsed.hostname || file || "新标签页";
  } catch {
    return "新标签页";
  }
}

function readStoredBrowserGroups() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BROWSER_TAB_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const MAX_STORED_BROWSER_GROUPS = 40;
let persistBrowserGroupsTimer = null;

function persistBrowserGroupsNow() {
  if (persistBrowserGroupsTimer) window.clearTimeout(persistBrowserGroupsTimer);
  persistBrowserGroupsTimer = null;
  const stored = readStoredBrowserGroups();
  for (const [taskId, group] of browserTaskGroups) {
    if (taskId.startsWith("draft-")) continue;
    stored[taskId] = {
      updatedAt: Date.now(),
      activeIndex: Math.max(0, group.tabs.indexOf(group.activeRouteId)),
      tabs: group.tabs.slice(0, MAX_BROWSER_TABS_PER_TASK).map((routeId) => {
        const record = browserTabs.get(routeId);
        return {
          title: browserTabTitle(record),
          url: (record?.workspacePath || browserTabHomeUrl(record?.url)) ? null : record?.url || null,
          workspacePath: record?.workspacePath || null,
          workspaceCwd: record?.workspaceCwd || null,
        };
      }),
    };
  }
  const staleKeys = Object.keys(stored)
    .filter((taskId) => !browserTaskGroups.has(taskId))
    .sort((left, right) => Number(stored[left]?.updatedAt || 0) - Number(stored[right]?.updatedAt || 0));
  for (const key of staleKeys.slice(0, Math.max(0, Object.keys(stored).length - MAX_STORED_BROWSER_GROUPS))) {
    delete stored[key];
  }
  localStorage.setItem(BROWSER_TAB_STORAGE_KEY, JSON.stringify(stored));
}

function persistBrowserGroups() {
  if (persistBrowserGroupsTimer) return;
  persistBrowserGroupsTimer = window.setTimeout(persistBrowserGroupsNow, 250);
}

window.addEventListener("pagehide", () => {
  if (persistBrowserGroupsTimer) persistBrowserGroupsNow();
});

function bindBrowserTab(view, record) {
  view.classList.add("browser-tab");
  view.dataset.browserRoute = record.routeId;
  view.hidden = record.routeId !== activeBrowserRouteId;
  record.view = view;
  if (!view._onPeopleDomReadyBound) {
    view._onPeopleDomReadyBound = true;
    view.addEventListener("dom-ready", async () => {
      try {
        await window.workbench.attachBrowser(view.getWebContentsId(), view.dataset.browserRoute);
        if (record.workspacePath && !record.workspaceRestoreStarted) {
          record.workspaceRestoreStarted = true;
          const restored = await window.workbench.openWorkspaceFile(
            record.workspaceCwd || cwdInput.value.trim(),
            record.workspacePath,
            record.routeId,
          );
          rememberWorkspacePreview(restored, record.routeId, record.workspaceCwd || cwdInput.value.trim());
        }
      }
      catch (error) { addEvent("error", "BROWSER", error.message); }
    });
  }
  browserTabs.set(record.routeId, record);
  return view;
}

function reviveBrowserTab(record) {
  if (record.view) return record.view;
  const staleLocalPreview = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/preview\//i.test(record.url || "");
  const direct = !record.workspacePath && !staleLocalPreview && record.url && !browserTabHomeUrl(record.url);
  const view = document.createElement("webview");
  view.setAttribute("partition", "persist:internal-agent-browser");
  view.setAttribute("src", direct ? record.url : browserHomeUrl);
  record.workspaceRestoreStarted = false;
  bindBrowserTab(view, record);
  browserSlot.append(view);
  return view;
}

function unloadBrowserTaskGroup(taskId) {
  const group = browserTaskGroups.get(taskId);
  if (!group || taskId === activeBrowserTaskId || taskId.startsWith("draft-")) return;
  for (const routeId of group.tabs) {
    const record = browserTabs.get(routeId);
    const view = record?.view;
    if (!view) continue;
    record.view = null;
    record.workspaceRestoreStarted = false;
    void window.workbench.detachBrowserTab(routeId).catch(() => {}).finally(() => view.remove());
  }
}

function cleanupArchivedThreadState(threadId) {
  threadRuntimeStates.delete(threadId);
  utilityStateByTask.delete(threadId);
  const group = browserTaskGroups.get(threadId);
  if (!group || threadId === activeBrowserTaskId) return;
  for (const routeId of group.tabs) {
    const record = browserTabs.get(routeId);
    if (record?.view) {
      const view = record.view;
      record.view = null;
      void window.workbench.detachBrowserTab(routeId).catch(() => {}).finally(() => view.remove());
    }
    browserTabs.delete(routeId);
  }
  browserTaskGroups.delete(threadId);
}

function pruneIdleBrowserGroups() {
  const now = Date.now();
  for (const [taskId, group] of browserTaskGroups) {
    if (taskId === activeBrowserTaskId || taskId.startsWith("draft-")) continue;
    if (BUSY_BROWSER_THREAD_STATES.has(String(threadRuntimeStates.get(taskId) || ""))) {
      group.lastActiveAt = now;
      continue;
    }
    if (now - Number(group.lastActiveAt || 0) < BROWSER_GROUP_IDLE_UNLOAD_MS) continue;
    if (group.tabs.some((routeId) => browserTabs.get(routeId)?.view)) unloadBrowserTaskGroup(taskId);
  }
}
window.setInterval(pruneIdleBrowserGroups, 15_000);

function createBrowserTab(taskId, url = null, title = "新标签页", options = {}) {
  const group = browserTaskGroups.get(taskId) || { taskId, tabs: [], activeRouteId: null, lastActiveAt: Date.now() };
  browserTaskGroups.set(taskId, group);
  if (group.tabs.length >= MAX_BROWSER_TABS_PER_TASK) {
    addEvent("error", "BROWSER", `每个任务最多打开 ${MAX_BROWSER_TABS_PER_TASK} 个浏览器标签。`);
    return browserTabs.get(group.activeRouteId)?.view || embeddedBrowser;
  }
  const routeId = browserTabRouteId();
  const view = document.createElement("webview");
  view.setAttribute("partition", "persist:internal-agent-browser");
  view.setAttribute("src", url || browserHomeUrl);
  const record = {
    routeId,
    taskId,
    title,
    url: url || browserHomeUrl,
    workspacePath: options.workspacePath || null,
    workspaceCwd: options.workspaceCwd || null,
    workspaceRestoreStarted: false,
    view,
  };
  group.tabs.push(routeId);
  if (!group.activeRouteId || options.activate !== false) group.activeRouteId = routeId;
  bindBrowserTab(view, record);
  browserSlot.append(view);
  if (options.activate !== false) void activateBrowserRoute(routeId);
  else view.hidden = true;
  persistBrowserGroups();
  renderBrowserTabStrip();
  return view;
}

function ensureBrowserTaskGroup(taskId) {
  const key = String(taskId || draftBrowserTaskId);
  const existing = browserTaskGroups.get(key);
  if (existing) return existing;
  const group = { taskId: key, tabs: [], activeRouteId: null, lastActiveAt: Date.now() };
  browserTaskGroups.set(key, group);
  const saved = key.startsWith("draft-") ? null : readStoredBrowserGroups()[key];
  const savedTabs = Array.isArray(saved?.tabs) ? saved.tabs.slice(0, MAX_BROWSER_TABS_PER_TASK) : [];
  // Restore records only — no <webview> yet. Each webview is a full Chromium
  // guest process; activateBrowserRoute revives the one tab actually shown.
  const restoreRecord = (url, title, options = {}) => {
    const routeId = browserTabRouteId();
    browserTabs.set(routeId, {
      routeId,
      taskId: key,
      title: title || "新标签页",
      url: url || browserHomeUrl,
      workspacePath: options.workspacePath || null,
      workspaceCwd: options.workspaceCwd || null,
      workspaceRestoreStarted: false,
      view: null,
    });
    group.tabs.push(routeId);
  };
  if (savedTabs.length) {
    for (const tab of savedTabs) {
      const staleLocalPreview = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/preview\//i.test(tab?.url || "");
      restoreRecord(staleLocalPreview ? null : tab?.url || null, tab?.title, {
        workspacePath: tab?.workspacePath || null,
        workspaceCwd: tab?.workspaceCwd || null,
      });
    }
    const activeIndex = Math.max(0, Math.min(group.tabs.length - 1, Number(saved.activeIndex) || 0));
    group.activeRouteId = group.tabs[activeIndex];
  } else {
    restoreRecord(null, "新标签页");
    group.activeRouteId = group.tabs[0];
  }
  return group;
}

function browserTabReady(view) {
  try { return Boolean(view.getWebContentsId()); } catch { return false; }
}

async function activateBrowserRoute(routeId) {
  const record = browserTabs.get(String(routeId || ""));
  if (!record) return null;
  const group = browserTaskGroups.get(record.taskId);
  if (!group) return null;
  activeBrowserTaskId = record.taskId;
  activeBrowserRouteId = routeId;
  group.activeRouteId = routeId;
  group.lastActiveAt = Date.now();
  const view = reviveBrowserTab(record);
  for (const [id, tab] of browserTabs) {
    if (tab.view) tab.view.hidden = id !== routeId;
  }
  embeddedBrowser = view;
  browserView.classList.toggle("document-preview", /\.pdf(?:\?|$)/i.test(record.url || ""));
  renderBrowserTabStrip();
  persistBrowserGroups();
  try {
    if (!browserTabReady(view)) await new Promise((resolve) => view.addEventListener("dom-ready", resolve, { once: true }));
    if (activeBrowserRouteId !== routeId) return view;
    await window.workbench.attachBrowser(view.getWebContentsId(), routeId);
    if (currentThreadId && record.taskId === currentThreadId) {
      await window.workbench.activateBrowserTab(currentThreadId, routeId);
    }
  } catch {}
  return view;
}

function activateBrowserTask(threadId = null) {
  const taskId = String(threadId || draftBrowserTaskId);
  const group = ensureBrowserTaskGroup(taskId);
  void activateBrowserRoute(group.activeRouteId);
  restoreUtilityStateForTask(taskId);
  return browserTabs.get(group.activeRouteId)?.view || embeddedBrowser;
}

async function promoteBrowserTab(routeId) {
  const threadId = String(routeId || "").trim();
  if (!threadId) return activateBrowserTask(null);
  if (activeBrowserTaskId === threadId) return activateBrowserTask(threadId);
  const draftGroup = browserTaskGroups.get(activeBrowserTaskId);
  if (!draftGroup || !activeBrowserTaskId.startsWith("draft-")) return activateBrowserTask(threadId);
  const draftTaskId = activeBrowserTaskId;
  const draftUtilityState = utilityStateByTask.get(draftTaskId);
  browserTaskGroups.delete(draftTaskId);
  draftGroup.taskId = threadId;
  for (const tabRouteId of draftGroup.tabs) {
    const record = browserTabs.get(tabRouteId);
    if (record) record.taskId = threadId;
  }
  browserTaskGroups.set(threadId, draftGroup);
  for (const session of terminalSessions.values()) {
    if (session.ownerThreadId === draftTaskId) session.ownerThreadId = threadId;
  }
  activeBrowserTaskId = threadId;
  if (draftUtilityState) utilityStateByTask.set(threadId, draftUtilityState);
  utilityStateByTask.delete(draftTaskId);
  draftBrowserTaskId = `draft-${crypto.randomUUID()}`;
  await activateBrowserRoute(draftGroup.activeRouteId);
  return browserTabs.get(draftGroup.activeRouteId)?.view || embeddedBrowser;
}

function closeBrowserTab(routeId) {
  const record = browserTabs.get(routeId);
  const group = record && browserTaskGroups.get(record.taskId);
  if (!record || !group) return;
  const closedIndex = group.tabs.indexOf(routeId);
  group.tabs = group.tabs.filter((id) => id !== routeId);
  browserTabs.delete(routeId);
  const closedView = record.view;
  void window.workbench.detachBrowserTab(routeId).catch(() => {}).finally(() => closedView?.remove());
  if (!group.tabs.length) {
    createBrowserTab(group.taskId, null, "新标签页", { activate: true });
  } else if (group.activeRouteId === routeId) {
    group.activeRouteId = group.tabs[Math.min(closedIndex, group.tabs.length - 1)];
    void activateBrowserRoute(group.activeRouteId);
  }
  persistBrowserGroups();
  renderBrowserTabStrip();
}

function renderBrowserTabStrip() {
  const strip = $("#browser-tab-strip");
  if (!strip) return;
  strip.replaceChildren();
  const group = browserTaskGroups.get(activeBrowserTaskId);
  for (const routeId of group?.tabs || []) {
    const record = browserTabs.get(routeId);
    if (!record) continue;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "browser-tab-chip";
    tab.classList.toggle("active", routeId === activeBrowserRouteId);
    tab.classList.toggle("suspended", !record.view);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(routeId === activeBrowserRouteId));
    tab.title = record.url && !browserTabHomeUrl(record.url) ? record.url : browserTabTitle(record);
    const icon = document.createElement("i");
    icon.className = /\.pdf(?:\?|$)/i.test(record.url || "") ? "browser-tab-icon pdf" : "browser-tab-icon";
    icon.textContent = icon.classList.contains("pdf") ? "PDF" : "◉";
    const label = document.createElement("span");
    label.textContent = browserTabTitle(record);
    const close = document.createElement("span");
    close.className = "browser-tab-close";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", `关闭 ${browserTabTitle(record)}`);
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeBrowserTab(routeId);
    });
    tab.append(icon, label, close);
    tab.addEventListener("click", () => void activateBrowserRoute(routeId));
    strip.append(tab);
  }
}

function rememberWorkspacePreview(result, routeId = activeBrowserRouteId, cwd = cwdInput.value.trim()) {
  const record = browserTabs.get(routeId);
  if (!record || !result?.preview) return result;
  record.workspacePath = result.path || null;
  record.workspaceCwd = cwd || null;
  record.title = result.name || record.title;
  record.url = result.url || record.url;
  persistBrowserGroups();
  if (record.taskId === activeBrowserTaskId) renderBrowserTabStrip();
  return result;
}

async function openWorkspacePreview(filePath, routeId = activeBrowserRouteId, cwd = cwdInput.value.trim()) {
  const result = await window.workbench.openWorkspaceFile(cwd, filePath, routeId);
  return rememberWorkspacePreview(result, routeId, cwd);
}

const initialBrowserRouteId = browserTabRouteId();
const initialBrowserGroup = { taskId: draftBrowserTaskId, tabs: [initialBrowserRouteId], activeRouteId: initialBrowserRouteId, lastActiveAt: Date.now() };
browserTaskGroups.set(draftBrowserTaskId, initialBrowserGroup);
activeBrowserRouteId = initialBrowserRouteId;
bindBrowserTab(embeddedBrowser, {
  routeId: initialBrowserRouteId,
  taskId: draftBrowserTaskId,
  title: "新标签页",
  url: browserHomeUrl,
  view: embeddedBrowser,
});
renderBrowserTabStrip();

function setThreadHeader(thread = null) {
  const previousThreadId = currentThreadId;
  const previousCwd = cwdInput.value.trim();
  currentThreadId = thread?.id || null;
  setWorkspaceMenu(false);
  activateBrowserTask(currentThreadId);
  const title = thread ? titleFrom(thread.name || thread.preview) : "新任务";
  taskTitle.textContent = title;
  $("#browser-task-tab").textContent = `${title} · 独立页面`;
  $("#browser-task-tab").title = thread?.id ? `任务 ${thread.id} 的独立浏览器页面` : "新任务的独立浏览器页面";
  threadLabel.textContent = thread?.id ? thread.id.slice(0, 13).toUpperCase() : "NEW THREAD";
  selectedReasoningEffort = thread?.reasoningEffort || "high";
  const nextCwd = thread?.cwd || "";
  if (thread) {
    selectedWorkspaceMode = thread.workspaceMode || "local";
    selectedWorkspaceBaseCwd = thread.workspaceBaseCwd || (selectedWorkspaceMode === "local" ? nextCwd : null);
  } else {
    selectedWorkspaceMode = "isolated";
    selectedWorkspaceBaseCwd = null;
  }
  cwdInput.value = nextCwd;
  cwdInput.disabled = Boolean(thread);
  updateProject(nextCwd);
  if (nextCwd) void refreshProjectActions();
  if (previousThreadId !== currentThreadId || (nextCwd && previousCwd !== nextCwd)) {
    resetTaskScopedUtilityState();
  }
  renderModelSource(modelSourceForProvider(providerSelect.value));
  syncTaskModelPicker();
}

function resetTaskScopedUtilityState() {
  workspaceStateEpoch += 1;
  agentRequestSequence += 1;
  managedAgentState = [];
  agentBoardState = { tasks: [], counts: {}, states: [] };
  activeAgentBoardFilter = "all";
  agentSurfaceExplicitlyRequested = false;
  $("#agent-create").hidden = true;
  $("#agent-advanced-open").hidden = false;
  updateAgentSurfaceVisibility();
  currentGitState = null;
  selectedGitFile = null;
  gitBusy = false;
  currentFilePath = "";
  currentFileParent = null;
  reviewComments.clear();
  updateReviewCommentControls();
  $("#git-file-list")?.replaceChildren();
  if ($("#git-diff")) $("#git-diff").textContent = "切换任务后正在载入当前项目状态。";
  if ($("#project-file-list")) $("#project-file-list").textContent = "选择“项目文件”后载入当前任务目录。";
  if ($("#files-current-path")) $("#files-current-path").textContent = "/";

  const ownerThreadId = currentThreadId || activeBrowserTaskId;
  const activeCwd = cwdInput.value.trim();
  const sessions = [...terminalSessions.values()];
  const matching = sessions.filter((session) => session.ownerThreadId === ownerThreadId && session.cwd === activeCwd).at(-1);
  for (const session of sessions) {
    session.tab.hidden = session.ownerThreadId !== ownerThreadId || session.cwd !== activeCwd;
    session.host.hidden = true;
  }
  activeTerminalId = null;
  terminal = null;
  terminalProcessId = null;
  if (matching) activateTerminalSession(matching.processId, { focus: false });
  else if (terminalDockOpen) void ensureTerminal();

  if (activeToolView === "changes") void refreshGit();
  if (activeToolView === "files") void refreshProjectFiles();
}

function updateToolButtonStates(utilityVisible = !contentArea.classList.contains("utility-collapsed")) {
  for (const button of $$("[data-tool-view]")) {
    const active = button.dataset.toolView === "terminal"
      ? terminalDockOpen
      : utilityVisible && button.dataset.toolView === activeToolView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setUtilityVisible(visible, options = {}) {
  const nextVisible = Boolean(visible);
  contentArea.classList.toggle("utility-collapsed", !nextVisible);
  utilityPanel.setAttribute("aria-hidden", String(!nextVisible));
  if (!nextVisible) closeQuickLauncher();
  if (options.remember !== false) {
    const taskId = String(currentThreadId || activeBrowserTaskId || "");
    if (taskId) utilityStateByTask.set(taskId, { visible: nextVisible, view: activeToolView });
  }
  updateToolButtonStates(nextVisible);
}

function setTerminalVisible(visible) {
  terminalDockOpen = Boolean(visible);
  primaryWorkspace.classList.toggle("terminal-open", terminalDockOpen);
  terminalDock.hidden = !terminalDockOpen;
  terminalResizer.hidden = !terminalDockOpen;
  updateToolButtonStates();
  if (terminalDockOpen) requestAnimationFrame(() => {
    const session = activeTerminalId ? terminalSessions.get(activeTerminalId) : null;
    session?.fit.fit();
    if (session && !session.exited) window.workbench.resizeTerminal(session.processId, session.terminal.cols, session.terminal.rows);
  });
}

async function selectToolView(view, options = {}) {
  if (view === "browser" && appPreferences.browserEnabled === false) {
    addEvent("error", "BROWSER", "内嵌浏览器已在设置中停用。可前往“设置 → 浏览器”重新启用。");
    return false;
  }
  if (view === "terminal") {
    setTerminalVisible(true);
    await ensureTerminal();
    terminal?.focus();
    return true;
  }
  activeToolView = view;
  setUtilityVisible(true, options);
  for (const panel of $$(".utility-view")) panel.classList.toggle("active", panel.dataset.view === view);
  const [title, subtitle] = TOOL_COPY[view];
  $("#utility-title").textContent = title;
  $("#utility-subtitle").textContent = subtitle;
  if (view === "changes") await refreshGit();
  if (view === "files") await refreshProjectFiles();
  if (view === "extensions") await refreshExtensions();
  if (view === "control") await refreshControl();
  return true;
}

function restoreUtilityStateForTask(taskId) {
  const state = utilityStateByTask.get(String(taskId || ""));
  if (!state?.visible) {
    setUtilityVisible(false, { remember: false });
    return;
  }
  void selectToolView(state.view || "browser", { remember: false });
}

function clampPanelSize(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function setUtilityWidth(width, persist = false) {
  const bounds = contentArea.getBoundingClientRect();
  const maximum = bounds.width - 426;
  const next = clampPanelSize(Number(width), 320, maximum);
  contentArea.style.setProperty("--utility-width", `${next}px`);
  workspaceResizer.setAttribute("aria-valuenow", String(Math.round(next)));
  workspaceResizer.setAttribute("aria-valuemax", String(Math.round(Math.max(320, maximum))));
  if (persist) localStorage.setItem("onpeople.utilityWidth", String(Math.round(next)));
}

function setTerminalHeight(height, persist = false) {
  const bounds = primaryWorkspace.getBoundingClientRect();
  const maximum = bounds.height - 266;
  const next = clampPanelSize(Number(height), 160, maximum);
  contentArea.style.setProperty("--terminal-height", `${next}px`);
  terminalResizer.setAttribute("aria-valuenow", String(Math.round(next)));
  terminalResizer.setAttribute("aria-valuemax", String(Math.round(Math.max(160, maximum))));
  if (persist) localStorage.setItem("onpeople.terminalHeight", String(Math.round(next)));
}

function bindPanelResizer(handle, orientation, pointerValue, keyboardValue) {
  let activePointer = null;
  const finish = (event) => {
    if (activePointer === null || (event.pointerId !== undefined && event.pointerId !== activePointer)) return;
    activePointer = null;
    handle.classList.remove("active");
    document.body.classList.remove("panel-resizing", "vertical");
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    keyboardValue(0, true);
  };
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    activePointer = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");
    document.body.classList.add("panel-resizing");
    if (orientation === "horizontal") document.body.classList.add("vertical");
    pointerValue(event, false);
  });
  handle.addEventListener("pointermove", (event) => {
    if (event.pointerId === activePointer) pointerValue(event, false);
  });
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("keydown", (event) => {
    const delta = orientation === "vertical"
      ? ({ ArrowLeft: 24, ArrowRight: -24 }[event.key] || 0)
      : ({ ArrowUp: 24, ArrowDown: -24 }[event.key] || 0);
    if (!delta) return;
    event.preventDefault();
    keyboardValue(delta, true);
  });
}

bindPanelResizer(
  workspaceResizer,
  "vertical",
  (event, persist) => setUtilityWidth(contentArea.getBoundingClientRect().right - event.clientX, persist),
  (delta, persist) => setUtilityWidth(Number(workspaceResizer.getAttribute("aria-valuenow")) + delta, persist),
);
bindPanelResizer(
  terminalResizer,
  "horizontal",
  (event, persist) => setTerminalHeight(primaryWorkspace.getBoundingClientRect().bottom - event.clientY, persist),
  (delta, persist) => setTerminalHeight(Number(terminalResizer.getAttribute("aria-valuenow")) + delta, persist),
);

const storedUtilityWidth = Number(localStorage.getItem("onpeople.utilityWidth"));
const storedTerminalHeight = Number(localStorage.getItem("onpeople.terminalHeight"));
setUtilityWidth(Number.isFinite(storedUtilityWidth) && storedUtilityWidth > 0
  ? storedUtilityWidth
  : Math.min(580, contentArea.getBoundingClientRect().width * 0.38));
setTerminalHeight(Number.isFinite(storedTerminalHeight) && storedTerminalHeight > 0 ? storedTerminalHeight : 280);
window.addEventListener("resize", () => {
  setUtilityWidth(Number(workspaceResizer.getAttribute("aria-valuenow")) || 420);
  setTerminalHeight(Number(terminalResizer.getAttribute("aria-valuenow")) || 280);
});

async function runProjectAction(action, isSetup = false) {
  const warning = isSetup
    ? `运行项目环境设置？\n\n${action.command}\n\n来源：${action.source} · ${action.fingerprint}\n设置脚本可能安装依赖或修改工作区，请先核对命令。`
    : `在项目终端运行“${action.label}”？\n\n${action.command}\n\n来源：${action.source} · ${action.fingerprint}`;
  if (!await confirmAction(warning, {
    title: isSetup ? "运行环境设置？" : `运行“${action.label}”？`,
    confirmLabel: isSetup ? "运行设置" : "运行命令",
    tone: "warning",
  })) return;
  try {
    const authorized = await window.workbench.authorizeProjectAction({ cwd: cwdInput.value.trim(), id: action.id, fingerprint: action.fingerprint });
    await selectToolView("terminal");
    if (!terminalProcessId) await ensureTerminal();
    await window.workbench.writeTerminal(terminalProcessId, `${authorized.command}\r`);
    addEvent("tool", isSetup ? "PROJECT SETUP" : "PROJECT ACTION", `${authorized.label}\n${authorized.command}`);
    terminal?.focus();
  } catch (error) { addEvent("error", "PROJECT ACTION", error.message); }
}

async function refreshProjectActions() {
  const container = $("#project-actions");
  container.replaceChildren();
  try {
    const result = await window.workbench.getProjectActions(cwdInput.value.trim());
    const visible = [...(result.setup ? [{ ...result.setup, setup: true }] : []), ...result.actions].slice(0, 3);
    container.hidden = !visible.length;
    for (const action of visible) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `project-action${action.setup ? " setup" : ""}`;
      button.textContent = action.label;
      button.title = `${action.command}\n${action.source}`;
      button.addEventListener("click", () => runProjectAction(action, Boolean(action.setup)));
      container.append(button);
    }
  } catch (error) {
    container.hidden = false;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-action";
    button.textContent = "Actions 配置错误";
    button.title = error.message;
    button.disabled = true;
    container.append(button);
  }
}

const markdownTags = [
  "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "hr", "a",
  "table", "thead", "tbody", "tr", "th", "td"
];

function safeMarkdownHref(href) {
  const value = String(href || "").trim();
  if (!value || value.startsWith("#") || value.startsWith("/")) return value;
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  try {
    const url = new URL(value);
    return new Set(["http:", "https:"]).has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function decorateMarkdown(content) {
  for (const link of content.querySelectorAll("a")) {
    const href = safeMarkdownHref(link.getAttribute("href"));
    if (!href) link.removeAttribute("href");
    else link.setAttribute("href", href);
    link.setAttribute("rel", "noreferrer");
  }
  for (const block of content.querySelectorAll("pre")) {
    const code = block.querySelector("code");
    if (!code) continue;
    const language = [...code.classList].find((name) => name.startsWith("language-"))?.slice(9);
    if (language) {
      const badge = document.createElement("span");
      badge.className = "markdown-code-language";
      badge.textContent = language;
      block.append(badge);
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "markdown-code-copy";
    copy.textContent = "复制";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || "");
        copy.textContent = "已复制";
        window.setTimeout(() => { copy.textContent = "复制"; }, 1200);
      } catch {
        copy.textContent = "复制失败";
      }
    });
    block.append(copy);
  }
}

function renderAgentMarkdown(content, markdown) {
  content._markdownSource = String(markdown || "");
  if (!window.marked || !window.DOMPurify) {
    content.textContent = content._markdownSource;
    return;
  }
  try {
    const rendered = window.marked.parse(content._markdownSource, { gfm: true, breaks: false });
    content.innerHTML = window.DOMPurify.sanitize(rendered, {
      ALLOWED_TAGS: markdownTags,
      ALLOWED_ATTR: ["href", "title", "class"]
    });
    decorateMarkdown(content);
  } catch {
    content.textContent = content._markdownSource;
  }
}

let pendingAgentMarkdownFrame = 0;
let pendingAgentMarkdownContent = null;

function scheduleAgentMarkdownRender(content) {
  pendingAgentMarkdownContent = content;
  if (pendingAgentMarkdownFrame) return;
  pendingAgentMarkdownFrame = requestAnimationFrame(() => {
    pendingAgentMarkdownFrame = 0;
    const target = pendingAgentMarkdownContent;
    pendingAgentMarkdownContent = null;
    if (!target) return;
    // Re-read the live source so a frame that slips past an authoritative render stays current.
    renderAgentMarkdown(target, target._markdownSource || "");
    scrollTimelineToBottom();
  });
}

function cancelScheduledAgentMarkdownRender(content) {
  if (!pendingAgentMarkdownFrame || pendingAgentMarkdownContent !== content) return;
  cancelAnimationFrame(pendingAgentMarkdownFrame);
  pendingAgentMarkdownFrame = 0;
  pendingAgentMarkdownContent = null;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function processDurationCopy(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (!totalSeconds) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function updateProcessFlowHeader(flow, status = flow.status) {
  if (!flow) return;
  flow.status = status;
  flow.section.classList.toggle("is-running", status === "running");
  flow.section.classList.toggle("is-completed", status === "completed");
  flow.section.classList.toggle("is-failed", status === "failed");
  flow.label.textContent = status === "running" ? "处理中" : status === "failed" ? "处理未完成" : "已处理";
  const finishedAt = flow.finishedAt || Date.now();
  const duration = processDurationCopy(finishedAt - flow.startedAt);
  flow.duration.textContent = duration;
  flow.duration.hidden = !duration;
}

function ensureProcessFlow(options = {}) {
  if (activeProcessFlow) return activeProcessFlow;
  const section = document.createElement("section");
  section.className = "process-flow is-running";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "process-flow-toggle";
  toggle.setAttribute("aria-expanded", "true");
  const label = document.createElement("strong");
  label.textContent = options.completed ? "已处理" : "处理中";
  const duration = document.createElement("span");
  duration.className = "process-flow-duration";
  const caret = document.createElement("span");
  caret.className = "process-flow-caret";
  caret.textContent = "›";
  caret.setAttribute("aria-hidden", "true");
  const rule = document.createElement("i");
  rule.setAttribute("aria-hidden", "true");
  toggle.append(label, duration, caret, rule);
  const body = document.createElement("div");
  body.className = "process-flow-body";
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "false";
    toggle.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
  });
  section.append(toggle, body);
  timeline.append(section);
  const startedAt = timestampMs(options.startedAt) || currentTurnStartedAt || Date.now();
  activeProcessFlow = {
    section,
    toggle,
    label,
    duration,
    caret,
    body,
    startedAt,
    finishedAt: timestampMs(options.finishedAt),
    status: options.completed ? "completed" : "running",
    timer: null,
  };
  updateProcessFlowHeader(activeProcessFlow);
  if (!options.completed && !renderingThreadHistory) {
    activeProcessFlow.timer = window.setInterval(() => updateProcessFlowHeader(activeProcessFlow), 1_000);
  }
  return activeProcessFlow;
}

function addProcessUpdate(text = "", options = {}) {
  const flow = ensureProcessFlow(options);
  const update = document.createElement("div");
  update.className = "process-update markdown-body";
  renderAgentMarkdown(update, text);
  flow.body.append(update);
  if (!renderingThreadHistory) scrollTimelineToBottom();
  return update;
}

function finishProcessFlow(status = "completed", options = {}) {
  const flow = activeProcessFlow;
  if (!flow) return;
  if (flow.timer) window.clearInterval(flow.timer);
  flow.timer = null;
  flow.finishedAt = timestampMs(options.finishedAt) || Date.now();
  updateProcessFlowHeader(flow, status);
  activeProcessFlow = null;
}

function discardProcessFlow() {
  if (activeProcessFlow?.timer) window.clearInterval(activeProcessFlow.timer);
  activeProcessFlow = null;
  activeAgentMessagePhase = null;
  currentTurnStartedAt = null;
}

function addEvent(kind, label, text = "", options = {}) {
  const card = document.createElement("div");
  card.className = `event ${kind}`;
  if (options.clientMessageId) {
    card.dataset.clientMessageId = options.clientMessageId;
    card.classList.add(`is-${options.deliveryStatus || "pending"}`);
  }
  if (kind === "agent") {
    const avatar = document.createElement("img");
    avatar.className = "agent-avatar";
    avatar.src = "../assets/onpeople-app-icon.png";
    avatar.alt = "";
    avatar.setAttribute("aria-hidden", "true");
    card.append(avatar);
  }
  const heading = document.createElement("span");
  heading.className = "event-label";
  heading.textContent = kind === "agent" ? label.replace(/^AGENT\b/, "OnPeople") : label;
  const content = document.createElement(kind === "agent" ? "div" : "span");
  if (kind === "agent") {
    content.className = "event-content markdown-body";
    renderAgentMarkdown(content, text);
  } else content.textContent = text;
  card.append(heading, content);
  if (kind === "user" && options.clientMessageId) {
    const delivery = document.createElement("small");
    delivery.className = "message-delivery";
    delivery.textContent = options.deliveryCopy || "正在发送…";
    card.append(delivery);
    pendingUserMessages.set(options.clientMessageId, card);
  }
  timeline.append(card);
  if (!renderingThreadHistory) scrollTimelineToBottom(kind === "user");
  return content;
}

function parsedJson(value) {
  if (typeof value !== "string") return value;
  const clean = value.trim();
  if (!clean) return null;
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch {}
  }
  return null;
}

function generatedImagePayload(value, seen = new Set()) {
  if (value === null || value === undefined) return null;
  const parsed = parsedJson(value);
  if (parsed !== value) return parsed ? generatedImagePayload(parsed, seen) : null;
  if (typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (value.kind === "generated-image" && Array.isArray(value.images)) return value;
  const priority = [value.structuredContent, value.result, value.output, value.aggregatedOutput, value.content, value.data];
  for (const candidate of priority) {
    const found = generatedImagePayload(candidate, seen);
    if (found) return found;
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const found = generatedImagePayload(candidate, seen);
      if (found) return found;
    }
  } else {
    for (const candidate of Object.values(value)) {
      const found = generatedImagePayload(candidate, seen);
      if (found) return found;
    }
  }
  return null;
}

function isImageGenerationItem(item = {}) {
  if (item.type !== "mcpToolCall") return false;
  return /image[_ -]?generation/i.test(String(item.server || item.serverName || ""))
    || /image[_ -]?generate/i.test(String(item.tool || item.name || item.method || ""));
}

async function renderGeneratedImagesFromToolItem(item, threadId = currentThreadId) {
  if (!isImageGenerationItem(item)) return;
  const payload = generatedImagePayload(item);
  if (!payload?.images?.length) return;
  const paths = payload.images.map((image) => String(image?.output || "")).filter(Boolean);
  const key = paths.join("|");
  if (!key || generatedImageCards.has(key)) return;
  const card = document.createElement("article");
  card.className = "generated-image-card is-loading";
  const header = document.createElement("header");
  const identity = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "OnPeople · IMAGE";
  const title = document.createElement("strong");
  title.textContent = paths.length > 1 ? `已生成 ${paths.length} 张图片` : "已生成图片";
  identity.append(eyebrow, title);
  const metadata = document.createElement("small");
  metadata.textContent = [payload.model, payload.size, payload.quality].filter(Boolean).join(" · ");
  header.append(identity, metadata);
  const prompt = document.createElement("p");
  prompt.textContent = String(payload.prompt || "");
  const grid = document.createElement("div");
  grid.className = "generated-image-grid";
  card.append(header, prompt, grid);
  generatedImageCards.set(key, card);
  timeline.append(card);

  for (const [index, imageInfo] of payload.images.entries()) {
    const figure = document.createElement("figure");
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "generated-image-preview";
    preview.setAttribute("aria-label", `查看生成图片 ${index + 1}`);
    const image = document.createElement("img");
    image.alt = payload.prompt ? `生成图片：${String(payload.prompt).slice(0, 120)}` : `生成图片 ${index + 1}`;
    preview.append(image);
    preview.addEventListener("click", () => card.classList.toggle("is-expanded"));
    const caption = document.createElement("figcaption");
    const name = document.createElement("span");
    name.textContent = String(imageInfo.output || "").split("/").pop() || `image-${index + 1}`;
    const actions = document.createElement("div");
    for (const [label, handler] of [
      ["复制图片", () => window.workbench.copyGeneratedImage(imageInfo.output, threadId)],
      ["复制路径", () => window.workbench.copyText(imageInfo.output)],
      [isMacOS ? "Finder" : "文件资源管理器", () => window.workbench.revealGeneratedImage(imageInfo.output, threadId)],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async () => {
        try {
          await handler();
          const previous = button.textContent;
          button.textContent = "完成";
          window.setTimeout(() => { button.textContent = previous; }, 1_100);
        } catch (error) { addEvent("error", "IMAGE", error.message); }
      });
      actions.append(button);
    }
    caption.append(name, actions);
    figure.append(preview, caption);
    grid.append(figure);
    try {
      const loaded = await window.workbench.readGeneratedImage(imageInfo.output, threadId);
      image.src = loaded.dataUrl;
      name.title = loaded.path;
    } catch (error) {
      figure.classList.add("is-missing");
      image.alt = error.message;
    }
  }
  card.classList.remove("is-loading");
  if (!renderingThreadHistory) scrollTimelineToBottom();
}

function setUserMessageDelivery(clientMessageId, status, message = "") {
  const id = String(clientMessageId || "");
  const card = pendingUserMessages.get(id);
  if (!card) return;
  card.classList.remove("is-pending", "is-queued", "is-sent", "is-failed");
  card.classList.add(`is-${status}`);
  const delivery = card.querySelector(".message-delivery");
  if (delivery) {
    delivery.textContent = status === "sent" ? "已送达"
      : status === "queued" ? "会话恢复中 · 已排队"
        : status === "failed" ? `发送失败${message ? ` · ${message}` : ""}`
          : "正在发送…";
  }
  if (status === "sent") {
    window.setTimeout(() => delivery?.remove(), 1_500);
    pendingUserMessages.delete(id);
  } else if (status === "failed") {
    pendingUserMessages.delete(id);
  }
}

timeline.addEventListener("click", async (event) => {
  const link = event.target.closest(".markdown-body a[href]");
  if (!link) return;
  const href = link.getAttribute("href") || "";
  if (href.startsWith("#")) return;
  event.preventDefault();
  try {
    if (/^https?:\/\//i.test(href)) {
      await selectToolView("browser");
      await window.workbench.navigate(href, activeBrowserRouteId);
      return;
    }
    let target = decodeURIComponent(href);
    let line = 1;
    const lineMatch = target.match(/#L(\d+)$/i) || target.match(/:(\d+)$/);
    if (lineMatch) {
      line = Number(lineMatch[1]) || 1;
      target = target.slice(0, -lineMatch[0].length);
    }
    if (/\.(?:html?|pdf|svg|png|jpe?g|gif|webp|avif)$/i.test(target.split(/[?#]/, 1)[0])) {
      await selectToolView("browser");
      await openWorkspacePreview(target);
      return;
    }
    await window.workbench.openEditor({ cwd: cwdInput.value.trim(), path: target, line, column: 1 });
  } catch (error) {
    addEvent("error", "OPEN LINK", error.message);
  }
});

function traceStatus(status) {
  const value = String(status || "completed").toLowerCase();
  if (new Set(["inprogress", "in_progress", "running", "started", "pending"]).has(value)) return ["running", "运行中"];
  if (new Set(["failed", "error", "declined", "cancelled", "canceled"]).has(value)) return ["failed", value === "declined" ? "已拒绝" : "失败"];
  if (new Set(["approved", "accepted"]).has(value)) return ["completed", "已批准"];
  return ["completed", "完成"];
}

function traceItemKey(item = {}) {
  return String(item.id || item.itemId || item.callId || item.processId || `trace-${traceSequence + 1}`);
}

function isTraceItem(item = {}) {
  return new Set(["plan", "commandExecution", "fileChange", "mcpToolCall", "reasoning", "webSearch", "collabAgentToolCall", "subAgentActivity"]).has(item.type);
}

function renderTraceCard(card, item, phase = "completed", options = {}) {
  const previous = card._traceItem || {};
  const [previousStatusClass] = traceStatus(previous.status || "completed");
  const merged = { ...previous, ...item };
  if (card._traceOutput) merged.aggregatedOutput = card._traceOutput;
  card._traceItem = merged;
  const record = traceFormatter.normalizeTraceItem(merged, phase);
  const [statusClass, statusCopy] = traceStatus(record.status);
  card.className = `event trace-event trace-${record.kind} is-${statusClass}`;
  card.dataset.status = statusClass;
  card.hidden = record.kind === "reasoning" && new Set(["", "[]", "{}", "null", "推理摘要"]).has(String(record.summary || "").trim()) && new Set(["", "[]", "{}", "null"]).has(String(record.detail || "").trim());
  card._traceIcon.textContent = ({ command: "⌘", read: "▱", tool: "◇", files: "▤", plan: "☷", reasoning: "◌", search: "⌕", error: "!", event: "·" })[record.kind] || "·";
  card._traceLabel.textContent = traceFormatter.activityLabel(record, statusClass);
  card._traceSummary.textContent = record.summary;
  card._traceDetail.textContent = record.detail;
  card._traceDetails.hidden = !record.detail;
  if (options.open !== undefined) card._traceDetails.open = options.open;
  else if (statusClass === "failed") card._traceDetails.open = true;
  else if (statusClass === "completed" && previousStatusClass === "running") card._traceDetails.open = false;
  card._traceStatus.textContent = options.statusCopy || (statusClass === "failed" ? statusCopy : statusClass === "running" ? "…" : record.detail ? (card._traceDetails.open ? "⌃" : "⌄") : "");
  return card;
}

function upsertTraceItem(item = {}, phase = "completed", options = {}) {
  const key = traceItemKey(item);
  let card = traceCards.get(key);
  if (!card) {
    card = document.createElement("article");
    card.dataset.traceId = key;
    const header = document.createElement("button");
    header.type = "button";
    header.className = "trace-header";
    const sequence = document.createElement("span");
    sequence.className = "trace-sequence";
    traceSequence += 1;
    sequence.setAttribute("aria-hidden", "true");
    const identity = document.createElement("div");
    identity.className = "trace-identity";
    const label = document.createElement("span");
    label.className = "trace-label";
    const summary = document.createElement("strong");
    summary.className = "trace-summary";
    identity.append(label, summary);
    const status = document.createElement("span");
    status.className = "trace-status";
    header.append(sequence, identity, status);
    const details = document.createElement("details");
    details.className = "trace-details";
    const detailsLabel = document.createElement("summary");
    detailsLabel.textContent = "查看详情";
    const detail = document.createElement("pre");
    details.append(detailsLabel, detail);
    details.addEventListener("toggle", () => {
      detailsLabel.textContent = details.open ? "收起详情" : "查看详情";
      if (!card.classList.contains("is-running") && !card.classList.contains("is-failed")) status.textContent = details.open ? "⌃" : "⌄";
    });
    header.addEventListener("click", () => { if (!details.hidden) details.open = !details.open; });
    card.append(header, details);
    card._traceLabel = label;
    card._traceIcon = sequence;
    card._traceSummary = summary;
    card._traceStatus = status;
    card._traceDetails = details;
    card._traceDetail = detail;
    traceCards.set(key, card);
    (activeProcessFlow?.body || timeline).append(card);
  }
  renderTraceCard(card, item, phase, options);
  if (!renderingThreadHistory) scrollTimelineToBottom();
  return card;
}

function addTraceError(label, message) {
  return upsertTraceItem({ type: "error", label, message, status: "failed" }, "failed", { open: true });
}

function syncWelcomeAccountCta() {
  const accountCta = $("#welcome-account-cta");
  if (accountCta) accountCta.hidden = Boolean(cloudAccountState.signedIn && cloudAccountState.account);
}

function resetTimeline() {
  discardProcessFlow();
  timeline.innerHTML = initialTimeline;
  syncWelcomeAccountCta();
  pendingUserMessages.clear();
  activeAgentMessage = null;
  traceCards.clear();
  generatedImageCards.clear();
  traceSequence = 0;
}

function userItemText(item) {
  return (item.content || []).map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "localImage") return `[图片] ${part.path.split("/").pop()}`;
    if (part.type === "image") return "[图片]";
    return "";
  }).filter(Boolean).join("\n");
}

function renderThreadHistory(thread) {
  discardProcessFlow();
  renderingThreadHistory = true;
  timeline.classList.add("instant-scroll");
  timeline.innerHTML = "";
  pendingUserMessages.clear();
  activeAgentMessage = null;
  traceCards.clear();
  generatedImageCards.clear();
  traceSequence = 0;
  try {
    for (const turn of thread.turns || []) {
      currentTurnStartedAt = timestampMs(turn.startedAt || turn.createdAt);
      for (const item of turn.items || []) {
        if (item.type === "userMessage") addEvent("user", "YOU", userItemText(item));
        else if (item.type === "agentMessage" && item.text) {
          if (item.phase === "commentary") addProcessUpdate(item.text, { startedAt: currentTurnStartedAt });
          else {
            finishProcessFlow("completed", { finishedAt: item.completedAt || item.updatedAt });
            addEvent("agent", "AGENT", item.text);
          }
        }
        else if (isTraceItem(item)) {
          ensureProcessFlow({ startedAt: currentTurnStartedAt });
          upsertTraceItem(item, item.status || "completed");
          if (item.status !== "inProgress") void renderGeneratedImagesFromToolItem(item, thread.id);
        }
      }
      finishProcessFlow(turn.status === "failed" ? "failed" : "completed", { finishedAt: turn.completedAt || turn.updatedAt });
      currentTurnStartedAt = null;
    }
  } finally {
    finishProcessFlow("completed");
    renderingThreadHistory = false;
  }
  if (!timeline.children.length) {
    timeline.innerHTML = initialTimeline;
    syncWelcomeAccountCta();
  }
  scrollTimelineToBottom(true);
  requestAnimationFrame(() => timeline.classList.remove("instant-scroll"));
}

const threadTimeFormat = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function threadTime(thread) {
  const stamp = Number(thread.recencyAt || thread.updatedAt || thread.createdAt || 0) * 1000;
  if (!stamp) return "";
  return threadTimeFormat.format(stamp);
}

function normalizedThreadWorkState(thread) {
  const runtimeState = threadRuntimeStates.get(thread.id);
  if (runtimeState) return runtimeState;
  const status = thread.status || {};
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
  const raw = [typeof status === "string" ? status : status.type, ...flags]
    .filter(Boolean).join(" ").toLocaleLowerCase().replace(/[\s_-]+/g, "");
  if (raw.includes("waitingonapproval") || raw.includes("approval")) return "waiting-approval";
  if (raw.includes("waitingonuserinput") || raw.includes("userinput")) return "waiting-input";
  if (raw.includes("restoring") || raw.includes("loading")) return "restoring";
  if (raw.includes("failed") || raw.includes("error")) return "failed";
  if (raw.includes("interrupt") || raw.includes("stopped") || raw.includes("cancel")) return "stopped";
  if (raw.includes("paused") || raw.includes("blocked")) return "paused";
  if (raw.includes("active") || raw.includes("running") || raw.includes("starting") || raw.includes("inprogress")) return "working";
  return "completed";
}

function threadWorkStatePresentation(thread) {
  const state = normalizedThreadWorkState(thread);
  return {
    state,
    className: state.startsWith("waiting-") ? "waiting" : state,
    label: {
      working: "工作中",
      "waiting-approval": "待批准",
      "waiting-input": "等待输入",
      restoring: "恢复中",
      completed: "已完成",
      failed: "失败",
      stopped: "已停止",
      paused: "已暂停",
    }[state] || "已完成",
  };
}

function setThreadRuntimeState(threadId, state) {
  const id = String(threadId || "").trim();
  if (!id) return;
  if (threadRuntimeStates.get(id) === state) return;
  threadRuntimeStates.set(id, state);
  const thread = loadedThreads.find((item) => item.id === id);
  const title = titleFrom(thread?.name || thread?.preview || (id === currentThreadId ? taskTitle.textContent : ""));
  void window.workbench.updatePetTask({ threadId: id, status: state, title }).catch(() => {});
  if (!showingArchived && loadedThreads.length) renderThreads(loadedThreads);
}

function threadAction(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.disabled = true;
    try { await handler(); } catch (error) { addEvent("error", "TASK", error.message); }
    finally { button.disabled = false; }
  });
  return button;
}

function closeTaskContextMenu() {
  activeTaskContextMenu?.remove();
  activeTaskContextMenu = null;
}

function showTaskContextMenu(thread, clientX, clientY) {
  closeTaskContextMenu();
  closeProjectMenus();
  const menu = document.createElement("div");
  menu.className = "task-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `任务操作：${titleFrom(thread.name || thread.preview)}`);
  const separator = () => {
    const line = document.createElement("div");
    line.className = "task-context-separator";
    line.setAttribute("role", "separator");
    menu.append(line);
  };
  const action = (icon, label, handler, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `task-context-item${options.danger ? " danger" : ""}`;
    button.disabled = Boolean(options.disabled);
    button.setAttribute("role", "menuitem");
    button.innerHTML = `<span aria-hidden="true">${icon}</span><strong>${escapeHtml(label)}</strong>${options.shortcut ? `<kbd>${escapeHtml(options.shortcut)}</kbd>` : ""}`;
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      closeTaskContextMenu();
      try { await handler(); } catch (error) { addEvent("error", "TASK", error.message); }
    });
    menu.append(button);
  };
  if (showingArchived) {
    action("↶", "恢复任务", async () => {
      await window.workbench.unarchiveThread(thread.id);
      await loadThreads();
    });
  } else {
    action("⌖", thread.pinned ? "取消置顶任务" : "置顶任务", async () => {
      await window.workbench.pinThread(thread.id, !thread.pinned);
      await loadThreads();
    });
    action("✎", "重命名任务", async () => {
      const currentName = String(thread.name || thread.preview || "未命名任务").trim();
      const name = await requestText({
        title: "重命名任务",
        description: "这个名称会显示在任务列表和窗口标题中。",
        value: currentName,
        placeholder: "任务名称",
        confirmLabel: "重命名",
      });
      if (name === null || name.trim() === currentName) return;
      const result = await window.workbench.renameThread(thread.id, name);
      thread.name = result.name;
      if (thread.id === currentThreadId) setThreadHeader({ ...thread, name: result.name });
      await loadThreads();
    });
    action("▱", "归档任务", async () => {
      await window.workbench.archiveThread(thread.id);
      cleanupArchivedThreadState(thread.id);
      if (thread.id === currentThreadId) {
        setThreadHeader(null);
        resetTimeline();
      }
      await loadThreads();
    });
    action("●", thread.unread ? "标记为已读" : "标记为未读", async () => {
      await window.workbench.markThreadUnread(thread.id, !thread.unread);
      await loadThreads();
    });
  }
  separator();
  const cwd = thread.cwd || thread.projectPath || "";
  action("▣", isMacOS ? "在 Finder 中显示" : "在文件资源管理器中显示", async () => window.workbench.revealThread(thread.id), { disabled: !cwd });
  action("⌘", "复制工作目录", async () => window.workbench.copyText(cwd), { disabled: !cwd });
  action("№", "复制会话 ID", async () => window.workbench.copyText(thread.id));
  action("↗", "复制深度链接", async () => window.workbench.copyText(`onpeople://task/${thread.id}`));
  separator();
  action("□", "在新窗口中打开", async () => window.workbench.openTaskWindow(thread.id));
  if (!showingArchived) action("⑂", "创建分叉", async () => activateThread(await window.workbench.forkThread(thread.id)));
  document.body.append(menu);
  activeTaskContextMenu = menu;
  const gutter = 8;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.round(Math.min(window.innerWidth - width - gutter, Math.max(gutter, clientX)))}px`;
  menu.style.top = `${Math.round(Math.min(window.innerHeight - height - gutter, Math.max(gutter, clientY)))}px`;
  menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}

function buildThreadRow(thread) {
  const row = document.createElement("article");
  row.className = `task-row ${thread.id === currentThreadId ? "active" : ""} ${thread.id === pendingThreadId ? "switching" : ""} ${thread.pinned ? "pinned" : ""} ${thread.unread ? "unread" : ""}`;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `打开任务：${titleFrom(thread.name || thread.preview)}`);
  row.setAttribute("aria-current", thread.id === currentThreadId ? "true" : "false");
  row.tabIndex = 0;
  const copy = document.createElement("div");
  copy.className = "task-row-copy";
  const heading = document.createElement("div");
  heading.className = "task-row-heading";
  const title = document.createElement("strong");
  title.textContent = titleFrom(thread.name || thread.preview);
  const workState = threadWorkStatePresentation(thread);
  const state = document.createElement("span");
  state.className = `task-work-state ${workState.className}`;
  state.textContent = workState.label;
  state.title = `任务状态：${workState.label}`;
  if (thread.unread) {
    const unread = document.createElement("span");
    unread.className = "task-unread-dot";
    unread.title = "未读";
    heading.append(unread);
  }
  heading.append(title, state);
  const meta = document.createElement("span");
  meta.className = "task-row-meta";
  meta.textContent = `${thread.projectName || "Workspace"} · ${threadTime(thread)}`;
  copy.append(heading, meta);
  const actions = document.createElement("div");
  actions.className = "task-row-actions";
  if (showingArchived) {
    actions.append(threadAction("恢复", "task-mini", async () => {
      await window.workbench.unarchiveThread(thread.id);
      await loadThreads();
    }));
  } else {
    actions.append(
      threadAction(thread.pinned ? "取消置顶" : "置顶", "task-mini pin", async () => {
        await window.workbench.pinThread(thread.id, !thread.pinned);
        await loadThreads();
      }),
      threadAction("窗口", "task-mini", async () => window.workbench.openTaskWindow(thread.id)),
      threadAction("分叉", "task-mini", async () => activateThread(await window.workbench.forkThread(thread.id))),
      threadAction("归档", "task-mini danger", async () => {
        await window.workbench.archiveThread(thread.id);
        cleanupArchivedThreadState(thread.id);
        if (thread.id === currentThreadId) {
          setThreadHeader(null);
          resetTimeline();
        }
        await loadThreads();
      }),
    );
  }
  row.append(copy, actions);
  const open = async () => {
    closeTaskContextMenu();
    if (showingArchived) return;
    if (thread.unread) {
      thread.unread = false;
      void window.workbench.markThreadUnread(thread.id, false).then(loadThreads).catch(() => {});
    }
    await resumeThread(thread.id);
  };
  row.addEventListener("click", open);
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showTaskContextMenu(thread, event.clientX, event.clientY);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") void open();
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const bounds = row.getBoundingClientRect();
      showTaskContextMenu(thread, bounds.left + Math.min(bounds.width - 12, 44), bounds.top + Math.min(bounds.height - 8, 36));
    }
  });
  return row;
}

document.addEventListener("pointerdown", (event) => {
  if (activeTaskContextMenu && !activeTaskContextMenu.contains(event.target)) closeTaskContextMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeTaskContextMenu) closeTaskContextMenu();
});
window.addEventListener("blur", closeTaskContextMenu);
window.addEventListener("resize", closeTaskContextMenu);
$(".task-nav")?.addEventListener("scroll", closeTaskContextMenu, { passive: true });

function renderProjects(threads, savedProjects = loadedProjects) {
  const list = $("#project-list");
  closeProjectMenus();
  for (const orphan of $$(".project-menu.project-menu-portal")) orphan.remove();
  const projects = new Map();
  const hiddenPaths = new Set(savedProjects.filter((item) => item?.hidden).map((item) => item.path));
  for (const saved of savedProjects) {
    if (!saved?.path || saved.hidden) continue;
    projects.set(saved.path, { path: saved.path, name: saved.name || saved.path.split("/").filter(Boolean).at(-1) || "Workspace", count: 0, pinned: Boolean(saved.pinned) });
  }
  for (const thread of threads) {
    const key = thread.projectPath || cwdInput.value.trim();
    if (!key || hiddenPaths.has(key)) continue;
    const project = projects.get(key) || { path: key, name: thread.projectName || key.split("/").filter(Boolean).at(-1) || "Workspace", count: 0, pinned: false };
    project.count += 1;
    projects.set(key, project);
  }
  const activePath = cwdInput.value.trim();
  if (activePath && !projects.has(activePath) && !hiddenPaths.has(activePath)) projects.set(activePath, { path: activePath, name: activePath.split("/").filter(Boolean).at(-1) || "Workspace", count: 0, pinned: false });
  list.replaceChildren();
  const sorted = [...projects.values()].sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.name.localeCompare(right.name, "zh-CN"));
  for (const project of sorted) {
    const wrapper = document.createElement("div");
    wrapper.className = "project-row-wrap";
    const row = document.createElement("button");
    row.type = "button";
    row.className = `project-row project-row-main ${selectedProjectPath === project.path ? "active" : ""}`;
    row.title = project.path;
    row.innerHTML = `<span class="project-folder" aria-hidden="true">${project.pinned ? "◆" : "◇"}</span><span class="project-copy"><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.path)}</small></span><span class="project-count">${project.count}</span>`;
    row.addEventListener("click", () => {
      closeProjectMenus();
      selectedProjectPath = selectedProjectPath === project.path ? null : project.path;
      if (!currentThreadId) {
        selectedWorkspaceMode = "local";
        selectedWorkspaceBaseCwd = project.path;
        cwdInput.value = project.path;
        updateProject(project.path);
      }
      renderThreads(threads);
      void refreshProjectActions();
      currentFilePath = "";
      if (activeToolView === "changes") void refreshGit();
      if (activeToolView === "files") void refreshProjectFiles();
    });
    const more = document.createElement("button");
    more.type = "button";
    more.className = "project-more";
    more.setAttribute("aria-label", `管理项目 ${project.name}`);
    more.setAttribute("aria-haspopup", "menu");
    more.textContent = "•••";
    const menu = document.createElement("div");
    menu.className = "project-menu";
    menu.setAttribute("role", "menu");
    const action = (icon, label, handler, options = {}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `project-menu-item${options.danger ? " danger" : ""}`;
      button.disabled = Boolean(options.disabled);
      button.innerHTML = `<span aria-hidden="true">${icon}</span><strong>${escapeHtml(label)}</strong>`;
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        closeProjectMenus();
        try { await handler(); } catch (error) { addEvent("error", "PROJECT", error.message); }
      });
      menu.append(button);
    };
    action("⌖", project.pinned ? "取消置顶项目" : "置顶项目", async () => {
      await window.workbench.updateProject(project.path, "pin", !project.pinned);
      await loadThreads();
    });
    action("▣", isMacOS ? "在 Finder 中显示" : "在文件资源管理器中显示", async () => window.workbench.revealProject(project.path));
    action("✎", "重命名项目", async () => {
      const name = await requestText({
        title: "重命名项目",
        description: "只修改 OnPeople 中的显示名称，不会重命名磁盘文件夹。",
        value: project.name,
        placeholder: "项目显示名称",
        confirmLabel: "重命名",
      });
      if (name === null || name.trim() === project.name) return;
      await window.workbench.updateProject(project.path, "rename", name);
      await loadThreads();
    });
    action("▱", "归档任务", async () => {
      if (!await confirmAction(`归档“${project.name}”中的 ${project.count} 个任务？\n\n项目文件不会被修改。`, {
        title: "归档项目任务？",
        confirmLabel: "归档任务",
        tone: "warning",
      })) return;
      const result = await window.workbench.archiveProjectTasks(project.path);
      if (result.archived && selectedProjectPath === project.path) selectedProjectPath = null;
      await loadThreads();
    }, { disabled: project.count < 1 });
    action("×", "移除", async () => {
      if (!await confirmAction(`从 OnPeople 侧栏移除“${project.name}”？\n\n不会删除项目文件或任务历史。`, {
        title: "移除这个项目？",
        confirmLabel: "从侧栏移除",
        tone: "warning",
      })) return;
      await window.workbench.updateProject(project.path, "remove");
      if (selectedProjectPath === project.path) selectedProjectPath = null;
      await loadThreads();
    }, { danger: true });
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = !menu.classList.contains("is-open");
      closeProjectMenus();
      wrapper.classList.toggle("menu-open", opening);
      menu.classList.toggle("is-open", opening);
      more.setAttribute("aria-expanded", String(opening));
      if (opening) {
        const anchor = more.getBoundingClientRect();
        const gutter = 8;
        const gap = 6;
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const left = Math.min(window.innerWidth - width - gutter, Math.max(gutter, anchor.right - width));
        const below = anchor.bottom + gap;
        const top = below + height <= window.innerHeight - gutter
          ? below
          : Math.max(gutter, anchor.top - height - gap);
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
      }
    });
    menu.classList.add("project-menu-portal");
    wrapper.append(row, more);
    list.append(wrapper);
    document.body.append(menu);
  }
}

function closeProjectMenus() {
  for (const wrapper of $$(".project-row-wrap.menu-open")) {
    wrapper.classList.remove("menu-open");
    wrapper.querySelector(".project-more")?.setAttribute("aria-expanded", "false");
  }
  for (const menu of $$(".project-menu.is-open")) menu.classList.remove("is-open");
}

function renderThreads(threads) {
  const pinnedThreads = showingArchived ? [] : threads.filter((thread) => thread.pinned);
  const regularThreads = showingArchived ? threads : threads.filter((thread) => !thread.pinned);
  pinnedTaskList.replaceChildren(...pinnedThreads.map(buildThreadRow));
  pinnedSection.hidden = pinnedThreads.length === 0;
  taskList.replaceChildren();
  if (!regularThreads.length) {
    const empty = document.createElement("span");
    empty.className = "empty-list";
    empty.textContent = showingArchived ? "没有归档任务" : (pinnedThreads.length ? "其他任务会显示在这里" : "没有匹配的任务");
    taskList.append(empty);
  } else taskList.append(...regularThreads.map(buildThreadRow));
  renderProjects(threads);
}

async function loadThreads() {
  const sequence = ++threadListRequestSequence;
  const search = taskSearch.value;
  const archived = showingArchived;
  try {
    const result = await window.workbench.listThreads({ search, archived });
    if (sequence !== threadListRequestSequence || search !== taskSearch.value || archived !== showingArchived) return;
    loadedThreads = result.threads || [];
    loadedProjects = result.projects || [];
    renderThreads(loadedThreads);
    if (!$("#scheduled-center").hidden && scheduledCenterMode === "create") refreshScheduledProjectOptions();
  } catch (error) {
    if (sequence === threadListRequestSequence) {
      taskList.innerHTML = '<span class="empty-list">任务暂时无法载入，连接恢复后会自动刷新。</span>';
      console.warn("Task list refresh failed", error);
    }
  }
}

async function resumeThread(threadId) {
  if (!threadId) return;
  closeScheduledCenter();
  if (threadId === currentThreadId) {
    if (pendingThreadId) {
      threadSwitchSequence += 1;
      pendingThreadId = null;
      renderThreads(loadedThreads);
    }
    return;
  }
  const sequence = ++threadSwitchSequence;
  pendingThreadId = threadId;
  renderThreads(loadedThreads);
  let timeoutId = null;
  try {
    const result = await Promise.race([
      window.workbench.resumeThread(threadId),
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("任务载入超时，请再次点击重试")), 15_000); }),
    ]);
    if (sequence !== threadSwitchSequence) return;
    pendingThreadId = null;
    activateThread(result);
  } catch (error) {
    if (sequence === threadSwitchSequence) {
      pendingThreadId = null;
      renderThreads(loadedThreads);
      addEvent("error", "RESUME", error.message);
    }
  } finally { clearTimeout(timeoutId); }
}

function activateThread(result) {
  pendingThreadId = null;
  const thread = result.thread;
  selectedImages = [];
  selectedAttachments = [];
  selectedCapability = null;
  imagePreviewUrls.clear();
  renderImages();
  renderSelectedCapability();
  setThreadHeader({
    ...thread,
    reasoningEffort: result.reasoningEffort || thread.reasoningEffort || null,
  });
  setRunning(Boolean(result.running));
  if (result.running) setThreadRuntimeState(thread.id, "working");
  else if (result.restoring) setThreadRuntimeState(thread.id, "restoring");
  renderThreadHistory(thread);
  renderGoal(result.goal);
  if (result.provider) renderProvider(result.provider);
  void refreshAgents();
  loadThreads();
  promptInput.focus();
}

const REASONING_EFFORT_LABELS = {
  medium: "标准",
  high: "高",
  xhigh: "超高",
};

function compactModelName(model = {}) {
  const raw = String(model.name || model.id || "").trim();
  return raw
    .replace(/^gpt-/i, "")
    .replace(/(^|[-_\s])([a-z])/g, (_match, prefix, letter) => `${prefix === "-" || prefix === "_" ? " " : prefix}${letter.toUpperCase()}`)
    .replace(/\s+/g, " ")
    .trim() || "选择模型";
}

function preferredOnPeopleModel(models = [], requestedId = modelInput.value.trim()) {
  const requested = String(requestedId || "").trim();
  if (requested && models.some((model) => model.id === requested)) {
    return models.find((model) => model.id === requested);
  }
  const activeGroupId = cloudAccountState.account?.group?.id;
  return models.find((model) => (
    activeGroupId != null
    && Number(model.groupId) === Number(activeGroupId)
  )) || models[0] || null;
}

function placeTaskModelPopover() {
  const rect = taskModelTrigger.getBoundingClientRect();
  const width = Math.min(310, window.innerWidth - 20);
  taskModelPopover.style.width = `${width}px`;
  taskModelPopover.style.left = `${Math.max(10, Math.min(window.innerWidth - width - 10, rect.right - width))}px`;
  taskModelPopover.style.top = `${Math.min(window.innerHeight - 10, rect.bottom + 6)}px`;
}

function setTaskModelPopover(open) {
  const shouldOpen = Boolean(open && !taskModelPicker.hidden);
  taskModelTrigger.setAttribute("aria-expanded", String(shouldOpen));
  taskModelPopover.hidden = !shouldOpen;
  if (shouldOpen) {
    taskModelPopover.showPopover?.();
    renderTaskModelPickerOptions();
    placeTaskModelPopover();
  } else {
    try { taskModelPopover.hidePopover?.(); } catch {}
  }
}

function renderTaskModelPickerOptions() {
  const models = PROVIDER_PRESETS.onpeople.models || [];
  const selectedId = modelInput.value.trim();
  taskModelOptions.replaceChildren();
  if (!cloudAccountState.modelsLive || !models.length) {
    const empty = document.createElement("span");
    empty.className = "task-model-empty";
    empty.textContent = cloudAccountState.modelsError || "正在读取 OnPeople 可用模型…";
    taskModelOptions.append(empty);
  } else {
    let previousGroup = null;
    for (const model of models) {
      const groupName = model.groupName || "其他模型";
      if (groupName !== previousGroup) {
        const group = document.createElement("span");
        group.className = "task-model-group";
        group.textContent = groupName;
        taskModelOptions.append(group);
        previousGroup = groupName;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-model-option";
      button.dataset.modelId = model.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(model.id === selectedId));
      const check = document.createElement("i");
      check.textContent = model.id === selectedId ? "✓" : "";
      const label = document.createElement("span");
      label.textContent = model.name || model.id;
      button.append(check, label);
      taskModelOptions.append(button);
    }
  }
  for (const button of taskEffortOptions.querySelectorAll("[data-reasoning-effort]")) {
    button.classList.toggle("active", button.dataset.reasoningEffort === selectedReasoningEffort);
  }
}

function syncTaskModelPicker() {
  const cloud = providerSelect.value === "onpeople";
  taskModelPicker.hidden = !cloud || !cloudAccountState.signedIn;
  const model = (PROVIDER_PRESETS.onpeople.models || []).find((item) => item.id === modelInput.value.trim());
  taskModelLabel.textContent = compactModelName(model || { id: modelInput.value.trim() });
  taskEffortLabel.textContent = REASONING_EFFORT_LABELS[selectedReasoningEffort] || selectedReasoningEffort;
  taskModelTrigger.disabled = !cloudAccountState.modelsLive || !(PROVIDER_PRESETS.onpeople.models || []).length;
  taskModelTrigger.title = model?.name || modelInput.value.trim() || "等待 OnPeople 模型目录";
  if (!taskModelPopover.hidden) renderTaskModelPickerOptions();
}

async function persistTaskModelSelection() {
  const result = await window.workbench.saveProvider({
    threadId: currentThreadId,
    type: "onpeople",
    model: modelInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    apiKey: "",
  });
  renderProvider(result.settings);
  providerStatus.textContent = result.pending
    ? "模型将在当前 Turn 完成后切换"
    : currentThreadId ? "已应用到当前任务" : "已设为新任务默认";
}

function modelSourceForProvider(type) {
  return Object.entries(MODEL_SOURCE_PROVIDERS).find(([, providers]) => providers.includes(type))?.[0] || "router";
}

function renderModelSource(source = modelSourceForProvider(providerSelect.value)) {
  for (const button of modelSourceSwitch.querySelectorAll("[data-model-source]")) {
    const active = button.dataset.modelSource === source;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const option of providerSelect.options) {
    const visible = MODEL_SOURCE_PROVIDERS[source]?.includes(option.value);
    option.hidden = !visible;
    option.disabled = !visible;
  }
  providerWrap.hidden = source === "onpeople";
  providerLabel.textContent = source === "local" ? "本地运行时" : "Router 服务";
  modelSourceIndicator.className = source;
  modelSourceAccount.hidden = source !== "onpeople";
  modelSourceAccount.textContent = cloudAccountState.signedIn ? "管理" : "登录";
  if (source === "onpeople") {
    modelSourceCopy.textContent = cloudAccountState.signedIn
      ? `$${Number(cloudAccountState.account?.balanceUSD || 0).toFixed(2)} · OnPeople · 仅当前任务使用`
      : "登录 OnPeople 使用内置额度，不影响 Router";
  } else if (source === "local") {
    modelSourceCopy.textContent = "使用本机模型，不消耗 OnPeople 额度";
  } else {
    modelSourceCopy.textContent = "使用自己的 API Key，不消耗 OnPeople 额度";
  }
  $("#save-provider").textContent = currentThreadId ? "应用到当前任务" : "设为新任务默认";
  syncTaskModelPicker();
}

function updateProviderFields() {
  const preset = PROVIDER_PRESETS[providerSelect.value];
  const remote = !new Set(["ollama", "lmstudio"]).has(providerSelect.value);
  const cloud = providerSelect.value === "onpeople";
  modelInputWrap.hidden = cloud;
  onpeopleModelWrap.hidden = !cloud;
  $("#base-url-wrap").hidden = !remote || cloud;
  $("#api-key-wrap").hidden = !remote || cloud;
  $("#discover-models").hidden = cloud;
  $("#save-provider").disabled = cloud && (
    !cloudAccountState.signedIn
    || !cloudAccountState.modelsLive
    || !onpeopleModelSelect.value
  );
  const vision = selectedModelVision ?? preset.vision;
  const imageGenerationButton = capabilityMenu.querySelector('[data-capability="imagegen"]');
  if (imageGenerationButton) {
    imageGenerationButton.disabled = !providerImageGeneration.available;
    imageGenerationButton.title = providerImageGeneration.available
      ? "使用当前 Router 的 /images/generations 接口"
      : (providerImageGeneration.reason || (cloud ? "当前 OnPeople 账户未提供图片生成模型" : (!remote ? "本地模型提供商尚未配置图片生成接口" : "当前 Router 未声明图片生成能力")));
  }
  const computerButton = capabilityMenu.querySelector('[data-capability="computer"]');
  if (computerButton) {
    computerButton.disabled = !computerCapability.available;
    computerButton.title = computerCapability.available ? "" : (computerCapability.reason || "Computer Use 尚未就绪");
  }
  if (!providerImageGeneration.available && selectedCapability === "imagegen") {
    selectedCapability = null;
    renderSelectedCapability();
  }
  attachImageButton.disabled = running;
  attachImageButton.title = "添加内容和能力";
  modelCapability.textContent = `${vision ? "视觉输入" : "仅文本"} · ${preset.protocol}${selectedModelVision === false && preset.vision ? " · 当前模型不支持图片" : ""}`;
  modelCapability.classList.toggle("vision", vision);
  if (!vision && selectedImages.length) {
    selectedImages = [];
    imagePreviewUrls.clear();
    renderImages();
  }
  syncTaskModelPicker();
}

function renderPresetModelOptions(preset = {}) {
  modelOptions.replaceChildren(...(preset.models || []).map((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.label = model.name;
    return option;
  }));
}

function renderOnPeopleModelOptions(models = []) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  if (!cloudAccountState.signedIn) placeholder.textContent = "登录后读取实时模型";
  else if (!cloudAccountState.modelsLive) placeholder.textContent = "实时模型暂不可用";
  else if (!models.length) placeholder.textContent = "服务未返回可用模型";
  else placeholder.textContent = "选择模型";
  const groups = new Map();
  for (const model of models) {
    const groupName = model.groupName || "其他模型";
    if (!groups.has(groupName)) {
      const group = document.createElement("optgroup");
      group.label = groupName;
      groups.set(groupName, group);
    }
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name || model.id;
    option.label = model.name || model.id;
    option.dataset.description = "OnPeople 服务实时返回";
    groups.get(groupName).append(option);
  }
  const selected = modelInput.value.trim();
  const preferred = cloudAccountState.modelsLive
    ? preferredOnPeopleModel(models, selected)
    : null;
  onpeopleModelSelect.replaceChildren(placeholder, ...groups.values());
  onpeopleModelSelect.disabled = !cloudAccountState.signedIn
    || !cloudAccountState.modelsLive
    || !models.length;
  onpeopleModelSelect.value = preferred?.id || "";
  if (providerSelect.value === "onpeople") modelInput.value = preferred?.id || "";
  PROVIDER_PRESETS.onpeople.model = preferred?.id || "";
  window.OnPeopleUI?.syncSelect?.(onpeopleModelSelect);
  syncTaskModelPicker();
}

let modelValidationSequence = 0;

async function validateSelectedModel() {
  if (!modelInput.value.trim()) {
    selectedModelVision = null;
    updateProviderFields();
    return;
  }
  const sequence = ++modelValidationSequence;
  try {
    const result = await window.workbench.validateModel(providerSelect.value, modelInput.value.trim());
    if (sequence !== modelValidationSequence) return;
    selectedModelVision = Boolean(result.supported);
  } catch {
    if (sequence !== modelValidationSequence) return;
    selectedModelVision = null;
  }
  updateProviderFields();
}

function renderProvider(settings = {}) {
  providerSelect.value = settings.type || "openai";
  const source = modelSourceForProvider(providerSelect.value);
  if (source !== "onpeople") lastProviderBySource[source] = providerSelect.value;
  renderModelSource(source);
  const preset = PROVIDER_PRESETS[providerSelect.value] || PROVIDER_PRESETS.openai;
  renderPresetModelOptions(preset);
  modelInput.value = settings.model || "";
  if (providerSelect.value === "onpeople") renderOnPeopleModelOptions(PROVIDER_PRESETS.onpeople.models);
  baseUrlInput.value = settings.baseUrl || "https://api.openai.com/v1";
  apiKeyInput.value = "";
  providerImageGeneration = {
    available: Boolean(settings.imageGeneration),
    reason: settings.imageGenerationReason || (settings.hasApiKey ? "当前 Provider 未声明兼容的 Images API" : "请先保存 Router API Key"),
  };
  apiKeyInput.placeholder = settings.hasApiKey ? "已加密保存；留空保持不变" : "可选，取决于服务端";
  providerStatus.textContent = settings.type === "onpeople"
    ? (!settings.accountSignedIn
      ? "需要先登录 OnPeople"
      : !cloudAccountState.modelsLive
        ? `${cloudAccountState.modelsError || "实时模型列表读取失败"}；未使用本地回退`
        : `已从 OnPeople 服务实时读取 ${cloudAccountState.models.length} 个模型`)
    : (settings.hasApiKey ? "API Key 已按提供商加密保存" : "未保存 API Key");
  selectedModelVision = settings.vision ?? null;
  void validateSelectedModel();
}

async function selectProviderType(type) {
  const requestedType = Object.hasOwn(PROVIDER_PRESETS, type) ? type : "openai";
  const sequence = ++providerDraftSequence;
  providerSelect.value = requestedType;
  const preset = PROVIDER_PRESETS[requestedType];
  renderModelSource(modelSourceForProvider(requestedType));
  renderPresetModelOptions(preset);
  modelInput.value = preset.model;
  if (requestedType === "onpeople") renderOnPeopleModelOptions(PROVIDER_PRESETS.onpeople.models);
  baseUrlInput.value = preset.baseUrl;
  apiKeyInput.value = "";
  providerImageGeneration = { available: false, reason: "正在读取当前 Provider 的图片生成能力" };
  providerStatus.textContent = "正在读取此任务的模型配置…";
  selectedModelVision = null;
  updateProviderFields();
  try {
    const settings = await window.workbench.getProviderSettings(requestedType, currentThreadId);
    if (sequence !== providerDraftSequence || providerSelect.value !== requestedType) return;
    renderProvider(settings);
  } catch (error) {
    if (sequence !== providerDraftSequence || providerSelect.value !== requestedType) return;
    providerStatus.textContent = cloudErrorMessage(error);
    void validateSelectedModel();
  }
}

async function selectModelSource(source) {
  if (!Object.hasOwn(MODEL_SOURCE_PROVIDERS, source)) return;
  if (source === "onpeople" && !cloudAccountState.signedIn) {
    pendingCloudSourceSelection = true;
    setCloudStatus("登录后会继续选择 OnPeople 模型；原 Router 配置不会改变。");
    if (!cloudAccountDialog.open) cloudAccountDialog.showModal();
    return;
  }
  pendingCloudSourceSelection = false;
  const currentType = providerSelect.value;
  const type = MODEL_SOURCE_PROVIDERS[source].includes(currentType)
    ? currentType
    : (source === "onpeople" ? "onpeople" : lastProviderBySource[source]);
  await selectProviderType(type);
}

function setCloudStatus(message, tone = false) {
  const indicator = document.createElement("i");
  const copy = document.createElement("span");
  copy.textContent = message;
  cloudAccountStatus.replaceChildren(indicator, copy);
  const statusTone = tone === true ? "error" : String(tone || "");
  cloudAccountStatus.classList.toggle("error", statusTone === "error");
  cloudAccountStatus.classList.toggle("warning", statusTone === "warning");
}

let cloudAuthMode = "login";
let cloudRegistrationCooldownTimer = null;
let cloudRegistrationCooldownEndsAt = 0;

function renderCloudRegistrationCooldown() {
  const button = $("#cloud-register-code");
  const secondsRemaining = Math.max(0, Math.ceil((cloudRegistrationCooldownEndsAt - Date.now()) / 1_000));
  if (secondsRemaining > 0) {
    button.disabled = true;
    button.textContent = `重新发送 ${secondsRemaining}s`;
    return;
  }
  cloudRegistrationCooldownEndsAt = 0;
  if (cloudRegistrationCooldownTimer) {
    window.clearInterval(cloudRegistrationCooldownTimer);
    cloudRegistrationCooldownTimer = null;
  }
  button.disabled = false;
  button.textContent = "发送验证码";
}

function startCloudRegistrationCooldown(seconds = 60) {
  const duration = Math.min(600, Math.max(1, Math.ceil(Number(seconds) || 60)));
  cloudRegistrationCooldownEndsAt = Date.now() + duration * 1_000;
  if (cloudRegistrationCooldownTimer) window.clearInterval(cloudRegistrationCooldownTimer);
  renderCloudRegistrationCooldown();
  cloudRegistrationCooldownTimer = window.setInterval(renderCloudRegistrationCooldown, 250);
}

function setCloudAuthMode(mode = "login", { focus = false } = {}) {
  cloudAuthMode = mode === "register" ? "register" : "login";
  const registering = cloudAuthMode === "register";
  for (const button of $$("[data-cloud-auth-mode]")) {
    const active = button.dataset.cloudAuthMode === cloudAuthMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  $("#cloud-login").hidden = registering;
  $("#cloud-register-fields").hidden = !registering;
  $("#cloud-password").autocomplete = registering ? "new-password" : "current-password";
  $("#cloud-password").placeholder = registering ? "设置登录密码" : "输入密码";
  $("#cloud-auth-intro").textContent = registering
    ? "填写邮箱和密码，再验证邮箱即可完成注册。"
    : "使用你的 OnPeople 账号继续。";
  $("#cloud-account-title").textContent = registering ? "注册 OnPeople" : "登录 OnPeople";
  $("#cloud-account-description").textContent = registering
    ? "创建账号后即可使用内置模型，自己的 Router 仍保持独立。"
    : "登录后即可使用内置模型，自己的 Router 仍可随时切换。";
  if (focus) $("#cloud-email").focus();
}

function cloudErrorMessage(error) {
  return String(error?.message || error || "Sub2API 请求失败")
    .replace(/^Error invoking remote method '[^']+':\s*(?:[A-Za-z]+Error:\s*)?/, "")
    .replace(/Sub2API/g, "OnPeople 服务")
    .replace(/Insufficient account balance[.;；]?/gi, "当前账户余额不足。")
    .replace(/\s*未使用本地回退[。.；;]*/g, "");
}

function cloudModelsStatus(state) {
  const rawError = String(state?.modelsError || "");
  if (/Insufficient account balance/i.test(rawError)) {
    return {
      message: "当前账户余额不足。输入兑换码补充额度后即可使用 OnPeople 模型；自带 Router 不受影响。",
      tone: "warning",
    };
  }
  return {
    message: `${cloudErrorMessage(rawError || "实时模型列表读取失败")}；没有使用旧模型回退。`,
    tone: "error",
  };
}

const usdBalanceFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatSub2APIBalance(value) {
  return usdBalanceFormat.format(Number(value || 0));
}

let cloudGroupRefreshSequence = 0;

function resetCloudGroups(label = "登录后读取模型分组") {
  const select = $("#cloud-group-select");
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  select.replaceChildren(option);
  select.disabled = true;
}

async function refreshCloudGroups() {
  const sequence = ++cloudGroupRefreshSequence;
  if (!cloudAccountState.signedIn) {
    resetCloudGroups();
    return null;
  }
  const select = $("#cloud-group-select");
  select.disabled = true;
  try {
    const result = await window.workbench.listCloudGroups();
    if (sequence !== cloudGroupRefreshSequence || !cloudAccountState.signedIn) return null;
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    select.replaceChildren(...groups.map((group) => {
      const option = document.createElement("option");
      option.value = String(group.id);
      option.textContent = group.name || String(group.id);
      option.title = Array.isArray(group.models) && group.models.length
        ? group.models.join(", ")
        : "使用该分组的可用模型";
      return option;
    }));
    if (!groups.length) {
      resetCloudGroups("当前账号没有可用模型分组");
      return result;
    }
    const activeId = String(result.activeGroupId ?? cloudAccountState.account?.group?.id ?? "");
    select.value = groups.some((group) => String(group.id) === activeId)
      ? activeId
      : String(groups[0].id);
    select.disabled = false;
    return result;
  } catch (error) {
    if (sequence !== cloudGroupRefreshSequence) return null;
    resetCloudGroups("模型分组暂时不可用");
    setCloudStatus(cloudErrorMessage(error), true);
    return null;
  }
}

function renderCloudAccount(state = cloudAccountState) {
  cloudAccountState = { ...cloudAccountState, ...state };
  const signedIn = Boolean(cloudAccountState.signedIn && cloudAccountState.account);
  $("#cloud-signed-out").hidden = signedIn;
  $("#cloud-signed-in").hidden = !signedIn;
  if (!signedIn) {
    $("#cloud-code").value = "";
    $("#cloud-password").value = "";
    setCloudAuthMode(cloudAuthMode);
    cloudGroupRefreshSequence += 1;
    resetCloudGroups();
  } else {
    $("#cloud-account-title").textContent = "OnPeople 账号";
    $("#cloud-account-description").textContent = "全部可用模型按任务独立选择，分组凭据会自动匹配。";
  }
  $("#cloud-service-url").value = cloudAccountState.serviceUrl || "https://api.aibro.vip";
  const accountOpen = $("#cloud-account-open");
  $("#cloud-account-label").textContent = signedIn ? "个人资料" : "登录或注册";
  $("#cloud-account-balance").textContent = signedIn
    ? `${cloudAccountState.account.email} · ${formatSub2APIBalance(cloudAccountState.account.balanceUSD)}`
    : "使用 OnPeople 模型";
  accountOpen.setAttribute("aria-label", signedIn ? "打开个人资料" : "登录或注册 OnPeople");
  syncWelcomeAccountCta();
  if (signedIn) {
    $("#cloud-account-email").textContent = cloudAccountState.account.email;
    const balance = Number(cloudAccountState.account.balanceUSD || 0);
    const balanceEmpty = balance <= 0;
    $("#cloud-wallet-balance").textContent = formatSub2APIBalance(balance);
    $("#cloud-wallet").classList.toggle("is-empty", balanceEmpty);
    $("#cloud-wallet-state").textContent = balanceEmpty ? "需要补充额度" : "账户已连接";
    $("#cloud-wallet-caption").textContent = balanceEmpty
      ? "当前无法调用 OnPeople 内置模型"
      : "可用余额";
    const group = cloudAccountState.account.group;
    $("#cloud-route-label").textContent = group?.name
      ? group.name
      : "OnPeople 模型";
    void refreshCloudGroups();
  }
  const models = (cloudAccountState.models || []).map((model) => ({
    id: model.id,
    name: model.name || model.id,
    groupId: model.groupId ?? null,
    groupName: model.groupName || "",
  }));
  PROVIDER_PRESETS.onpeople.baseUrl = cloudAccountState.apiBaseUrl || `${cloudAccountState.serviceUrl}/v1`;
  PROVIDER_PRESETS.onpeople.models = models;
  renderOnPeopleModelOptions(models);
  if (providerSelect.value === "onpeople") {
    baseUrlInput.value = PROVIDER_PRESETS.onpeople.baseUrl;
    renderPresetModelOptions(PROVIDER_PRESETS.onpeople);
    providerStatus.textContent = !signedIn
      ? "需要先登录 OnPeople"
      : cloudAccountState.modelsLive
        ? (models.length
          ? `已从 OnPeople 服务实时读取 ${models.length} 个模型`
          : "OnPeople 服务当前没有返回可用模型")
        : cloudModelsStatus(cloudAccountState).message;
    updateProviderFields();
  }
  renderModelSource(modelSourceForProvider(providerSelect.value));
}

async function refreshCloudAccount({ quiet = false } = {}) {
  if (!quiet) setCloudStatus("正在同步账号…");
  try {
    const state = await window.workbench.getCloudAccount();
    renderCloudAccount(state);
    if (state.signedIn) {
      if (!quiet) {
        if (state.modelsLive) {
          setCloudStatus(`已从 OnPeople 服务实时同步 ${state.models?.length || 0} 个模型。`);
        } else {
          const status = cloudModelsStatus(state);
          setCloudStatus(status.message, status.tone);
        }
      }
    } else if (!quiet) {
      setCloudStatus("登录是可选的；自定义 Router 和本地模型保持独立可用。");
    }
    return state;
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), true);
    throw error;
  }
}

const tokenCountFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function formatTokenCount(value) {
  const amount = Math.max(0, Number(value || 0));
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(amount >= 1_000_000_000 ? 1 : 2).replace(/\.?0+$/, "")}亿`;
  if (amount >= 10_000) return `${(amount / 10_000).toFixed(amount >= 1_000_000 ? 1 : 2).replace(/\.?0+$/, "")}万`;
  return tokenCountFormat.format(amount);
}

function shortProfileName(account = cloudAccountState.account) {
  if (account?.username) return account.username;
  if (account?.email) return account.email.split("@")[0];
  return "OnPeople 用户";
}

function setUsageProfileView(view) {
  activeUsageProfileView = view === "leaderboard" ? "leaderboard" : "profile";
  $("#usage-profile-view").hidden = activeUsageProfileView !== "profile";
  $("#usage-leaderboard-view").hidden = activeUsageProfileView !== "leaderboard";
  for (const button of $$("[data-usage-profile-view]")) {
    button.classList.toggle("active", button.dataset.usageProfileView === activeUsageProfileView);
  }
  if (activeUsageProfileView === "leaderboard") void refreshCloudUsageProfile();
}

const usageMonthFormat = new Intl.DateTimeFormat("zh-CN", { month: "short" });

function renderUsageHeatmap(profile = {}) {
  const heatmap = $("#usage-heatmap");
  heatmap.replaceChildren();
  const days = Array.isArray(profile.days) ? profile.days : [];
  const nonZero = days.map((day) => Number(day.tokens || 0)).filter(Boolean).sort((left, right) => left - right);
  const percentile = (fraction) => nonZero[Math.max(0, Math.min(nonZero.length - 1, Math.floor(nonZero.length * fraction)))] || 0;
  const levels = [percentile(.25), percentile(.5), percentile(.75)];
  for (const day of days) {
    const tokens = Number(day.tokens || 0);
    const cell = document.createElement("i");
    const level = tokens <= 0 ? 0 : tokens <= levels[0] ? 1 : tokens <= levels[1] ? 2 : tokens <= levels[2] ? 3 : 4;
    if (level) cell.classList.add(`level-${level}`);
    cell.title = `${day.day} · ${formatTokenCount(tokens)} Token · ${Number(day.requests || 0)} Turn`;
    cell.setAttribute("aria-label", cell.title);
    heatmap.append(cell);
  }
  const monthRow = $("#usage-heat-months");
  monthRow.replaceChildren();
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date();
    date.setMonth(date.getMonth() - index);
    const label = document.createElement("span");
    label.textContent = usageMonthFormat.format(date);
    monthRow.append(label);
  }
}

function renderLocalUsageProfile(profile = {}) {
  $("#usage-profile-name").textContent = shortProfileName();
  $("#usage-profile-handle").textContent = cloudAccountState.account?.email || "本机 Agent 活动";
  $("#usage-total-tokens").textContent = formatTokenCount(profile.totalTokens);
  $("#usage-peak-tokens").textContent = formatTokenCount(profile.peakTokens);
  $("#usage-peak-day").textContent = profile.peakDay || "暂无记录";
  $("#usage-longest-task").textContent = profile.longestTaskLabel || "0 秒";
  $("#usage-current-streak").textContent = `${Number(profile.currentStreak || 0)} 天`;
  $("#usage-longest-streak").textContent = `最长 ${Number(profile.longestStreak || 0)} 天`;
  $("#usage-task-count").textContent = formatTokenCount(profile.taskCount);
  $("#usage-active-days").textContent = `活跃 ${Number(profile.activeDays || 0)} 天`;
  $("#usage-insight-days").textContent = String(Number(profile.activeDays || 0));
  $("#usage-insight-turns").textContent = String(Number(profile.taskCount || 0));
  $("#usage-insight-average").textContent = `${formatTokenCount(profile.activeDays ? profile.totalTokens / profile.activeDays : 0)} Token`;
  renderUsageHeatmap(profile);

  const tools = $("#usage-top-tools");
  tools.replaceChildren();
  if (!(profile.tools || []).length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "运行任务后会在这里出现。";
    tools.append(empty);
  } else {
    for (const tool of profile.tools.slice(0, 5)) {
      const row = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = tool.name;
      const count = document.createElement("span");
      count.textContent = `${tool.runs} 次`;
      row.append(name, count);
      tools.append(row);
    }
  }
}

function leaderboardInitials(value = "") {
  const text = String(value || "OP").trim();
  const words = text.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : text.slice(0, 2)).toUpperCase();
}

function renderLeaderboard(profile = {}) {
  cloudUsageProfile = profile;
  const preference = profile.preference || {};
  $("#leaderboard-participating").checked = Boolean(preference.participating);
  $("#leaderboard-display-name").value = preference.display_name || "";
  const list = $("#leaderboard-list");
  list.replaceChildren();
  const rows = Array.isArray(profile.leaderboard) ? profile.leaderboard : [];
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "leaderboard-empty";
    empty.textContent = profile.unavailable
      ? "排行榜服务暂时不可用，个人本机档案仍可正常使用。"
      : "这个周期还没有已加入排行榜的用户。";
    list.append(empty);
  } else {
    for (const item of rows) {
      const row = document.createElement("article");
      row.className = `leaderboard-row${item.is_current_user ? " current" : ""}`;
      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${item.rank}`;
      const user = document.createElement("div");
      user.className = "leaderboard-user";
      const avatar = document.createElement("i");
      avatar.textContent = leaderboardInitials(item.display_name);
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = item.display_name || "OnPeople 用户";
      const detail = document.createElement("small");
      detail.textContent = item.is_current_user ? "你 · 当前账号" : "OnPeople 社区";
      copy.append(name, detail);
      user.append(avatar, copy);
      const tokens = document.createElement("span");
      tokens.className = "leaderboard-tokens";
      tokens.textContent = formatTokenCount(item.total_tokens);
      const requests = document.createElement("span");
      requests.className = "leaderboard-requests";
      requests.textContent = formatTokenCount(item.requests);
      row.append(rank, user, tokens, requests);
      list.append(row);
    }
  }
  const rankCopy = Number(profile.current_user_rank || 0) > 0 ? `你当前排名 #${profile.current_user_rank}` : "开启参与后，你的匿名排名才会出现在榜单中。";
  $("#leaderboard-status").textContent = profile.unavailable
    ? "云端接口尚未更新；部署后会自动启用真实排行榜。"
    : `${rankCopy} · 数据仅来自 OnPeople 模型`;
}

async function refreshLocalUsageProfile() {
  const ledger = await window.workbench.getUsageLedger();
  renderLocalUsageProfile(ledger.profile || {});
  return ledger.profile || {};
}

async function refreshCloudUsageProfile() {
  if (!cloudAccountState.signedIn) {
    renderLeaderboard({ unavailable: true, leaderboard: [], preference: {} });
    $("#leaderboard-status").textContent = "请先登录 OnPeople，再查看或参与 Token 排行。";
    return null;
  }
  $("#leaderboard-status").textContent = "正在从 OnPeople 服务读取真实 Token 排行…";
  try {
    const profile = await window.workbench.getCloudUsageProfile({ period: activeLeaderboardPeriod });
    renderLeaderboard(profile || {});
    return profile;
  } catch (error) {
    renderLeaderboard({ unavailable: true, leaderboard: [], preference: cloudUsageProfile?.preference || {} });
    const detail = cloudErrorMessage(error);
    $("#leaderboard-status").textContent = /invalid usage id|not found|404/i.test(detail)
      ? "排行榜接口尚未部署到 OnPeople 服务；更新服务后会自动启用。"
      : "暂时无法连接排行榜服务，请稍后重试。";
    $("#leaderboard-status").title = detail;
    return null;
  }
}

async function openUsageProfile() {
  openSettingsCenter("profile");
  setUsageProfileView("profile");
  $("#usage-profile-name").textContent = shortProfileName();
  $("#usage-profile-handle").textContent = cloudAccountState.account?.email || "本机 Agent 活动";
  try {
    await refreshLocalUsageProfile();
  } catch (error) {
    $("#usage-profile-handle").textContent = `无法读取本机用量：${error.message}`;
  }
}

function openCloudAccountManagement(mode = "login") {
  if (!cloudAccountState.signedIn) setCloudAuthMode(mode);
  if (!cloudAccountDialog.open) cloudAccountDialog.showModal();
  void refreshCloudAccount().catch(() => {});
}

function closeCloudAccountManagement() {
  pendingCloudSourceSelection = false;
  if (cloudAccountDialog.open) cloudAccountDialog.close();
}

function renderImages() {
  const imageChips = selectedImages.map((imagePath, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "image-chip";
    const previewUrl = imagePreviewUrls.get(imagePath);
    if (previewUrl) {
      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = "";
      chip.append(image);
    }
    const label = document.createElement("span");
    label.textContent = imagePath.split("/").pop();
    const remove = document.createElement("i");
    remove.textContent = "×";
    chip.append(label, remove);
    chip.addEventListener("click", () => {
      imagePreviewUrls.delete(imagePath);
      selectedImages.splice(index, 1);
      renderImages();
    });
    return chip;
  });
  const fileChips = selectedAttachments.map((attachment, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "file-chip";
    chip.title = attachment.path;
    const icon = document.createElement("i");
    icon.textContent = attachment.kind === "folder" ? "⌑" : "▤";
    const label = document.createElement("span");
    label.textContent = attachment.name;
    const remove = document.createElement("b");
    remove.textContent = "×";
    chip.append(icon, label, remove);
    chip.addEventListener("click", () => {
      selectedAttachments.splice(index, 1);
      renderImages();
    });
    return chip;
  });
  imageAttachments.hidden = imageChips.length + fileChips.length === 0;
  imageAttachments.replaceChildren(...imageChips, ...fileChips);
}

function renderSelectedCapability() {
  capabilitySelection.hidden = !selectedCapability;
  capabilitySelection.textContent = selectedCapability ? `${CAPABILITY_COPY[selectedCapability]}  ×` : "";
  capabilitySelection.title = selectedCapability ? "点击移除当前能力" : "";
}

function formatGoalUsage(goal) {
  const tokens = Number(goal.tokensUsed || 0).toLocaleString();
  const budget = goal.tokenBudget ? ` / ${Number(goal.tokenBudget).toLocaleString()}` : " / ∞";
  const seconds = Number(goal.timeUsedSeconds || 0);
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return `${tokens}${budget} tokens · ${time}`;
}

function renderGoal(goal) {
  currentGoal = goal || null;
  goalPanel.hidden = !currentGoal;
  if (!currentGoal) return;
  goalStatus.textContent = String(currentGoal.status || "active").toUpperCase();
  goalObjective.textContent = currentGoal.objective || "";
  goalUsage.textContent = formatGoalUsage(currentGoal);
  goalPause.textContent = currentGoal.status === "paused" ? "恢复" : "暂停";
  goalPause.disabled = !new Set(["active", "paused", "blocked"]).has(currentGoal.status);
}

function renderPlan(params) {
  if (running) ensureProcessFlow();
  const text = [params.explanation || "计划已更新", ...(params.plan || []).map((item) => `${item.status === "completed" ? "✓" : item.status === "inProgress" ? "→" : "·"} ${item.step}`)].join("\n");
  upsertTraceItem({ id: "active-plan", type: "plan", text, explanation: params.explanation, status: params.plan?.every((item) => item.status === "completed") ? "completed" : "inProgress" }, "started", { open: true });
}

const pendingToolOutputFrames = new Map();

function appendToolOutput(kind, params) {
  ensureProcessFlow();
  const key = String(params.itemId || params.processId || `${kind}:current`);
  const type = kind === "COMMAND" ? "commandExecution" : "mcpToolCall";
  // Aggregate before the upsert so its single renderTraceCard pass shows the new delta;
  // the first chunk's card does not exist yet, so the output rides in via aggregatedOutput.
  const existing = traceCards.get(key);
  const aggregated = traceFormatter.truncateTraceText(`${existing?._traceOutput || ""}${params.delta || ""}`);
  if (!existing) {
    // First chunk: create the card synchronously so timeline ordering is preserved.
    const card = upsertTraceItem({ id: key, type, command: params.command, tool: params.tool, server: params.server, status: "inProgress", aggregatedOutput: aggregated }, "started", { open: true });
    card._traceOutput = aggregated;
    return;
  }
  // Later chunks: coalesce DOM updates to one render per animation frame —
  // chatty commands can stream dozens of deltas per second.
  existing._traceOutput = aggregated;
  if (pendingToolOutputFrames.has(key)) return;
  pendingToolOutputFrames.set(key, requestAnimationFrame(() => {
    pendingToolOutputFrames.delete(key);
    const card = traceCards.get(key);
    // Skip if the item already rendered its terminal state while the frame was pending.
    if (!card || card.dataset.status !== "running") return;
    upsertTraceItem({ id: key, type, status: "inProgress" }, "started", { open: true });
  }));
}

function approvalSummary(request) {
  const params = request.params || {};
  return `${request.method}\n${params.message || params.reason || params.command || params.itemId || "需要用户确认"}`;
}

function addApproval(request) {
  ensureProcessFlow();
  const approvalThreadId = request.params?.threadId || request.params?.thread?.id || currentThreadId;
  setThreadRuntimeState(approvalThreadId, "waiting-approval");
  const traceId = `approval-${request.id}`;
  const summary = request.params?.message || request.params?.reason || "这项操作需要确认";
  const card = upsertTraceItem({ id: traceId, type: "event", label: "APPROVAL", message: summary, details: approvalSummary(request), status: "pending" }, "started", { open: true, statusCopy: "需要确认" });
  card.classList.add("trace-approval");
  const actions = document.createElement("div");
  actions.className = "approval-actions";
  for (const [label, decision] of [["拒绝", "decline"], ["批准一次", "accept"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = decision === "decline" ? "secondary" : "";
    button.addEventListener("click", async () => {
      for (const child of actions.children) child.disabled = true;
      try {
        await window.workbench.resolveApproval(request.id, decision);
        setThreadRuntimeState(approvalThreadId, "working");
        renderTraceCard(card, { ...card._traceItem, status: decision === "accept" ? "approved" : "declined" }, "completed", { statusCopy: decision === "accept" ? "已批准" : "已拒绝" });
      } catch (error) {
        setThreadRuntimeState(approvalThreadId, "failed");
        renderTraceCard(card, { ...card._traceItem, status: "failed", details: `${approvalSummary(request)}\n\n${error.message}` }, "failed", { open: true });
      }
    });
    actions.append(button);
  }
  card.append(actions);
  scrollTimelineToBottom(true);
}

function selectMode(mode) {
  if (running) return;
  selectedMode = mode;
  for (const option of modeOptions) {
    const active = option.dataset.mode === mode;
    option.classList.toggle("active", active);
    option.setAttribute("aria-pressed", String(active));
  }
  goalBudgetWrap.hidden = mode !== "goal";
  promptInput.placeholder = mode === "goal" ? "描述可验证的结果、约束和完成标准。" : mode === "plan" ? "描述任务；Agent 会先调查并生成实施计划。" : DEFAULT_PROMPT_PLACEHOLDER;
}

function setRunning(value) {
  running = value;
  // A running turn still accepts a follow-up from the composer. The main
  // process routes it through turn/steer. With an empty composer the same
  // primary action becomes Stop; typing a follow-up changes it back to Send.
  sendButton.disabled = submitting;
  promptInput.disabled = false;
  promptInput.placeholder = value ? "补充指令；发送后会加入当前运行任务…" : (
      selectedMode === "goal" ? "描述可验证的结果、约束和完成标准。" :
      selectedMode === "plan" ? "描述任务；Agent 会先调查并生成实施计划。" :
        DEFAULT_PROMPT_PLACEHOLDER
  );
  for (const option of modeOptions) option.disabled = value;
  goalBudgetMode.disabled = value;
  goalBudget.disabled = value;
  updateComposerPrimaryAction();
  updateProviderFields();
}

function setSubmitting(value) {
  submitting = Boolean(value);
  sendButton.disabled = submitting;
  if (!running) {
    promptInput.placeholder = submitting ? "正在确认消息已进入任务…"
      : (selectedMode === "goal" ? "描述可验证的结果、约束和完成标准。" :
        selectedMode === "plan" ? "描述任务；Agent 会先调查并生成实施计划。" :
          DEFAULT_PROMPT_PLACEHOLDER);
  }
  updateComposerPrimaryAction();
}

function updateComposerPrimaryAction() {
  const stopping = running && !submitting && !promptInput.value.trim();
  sendButton.dataset.action = stopping ? "stop" : "send";
  sendButton.setAttribute("aria-label", stopping
    ? "停止当前任务"
    : (running ? "发送补充指令" : "运行任务"));
  sendButton.title = stopping
    ? "停止当前任务"
    : (running ? "发送补充指令" : "运行任务");
}

const terminalTheme = {
  background: "#ffffff",
  foreground: "#252523",
  cursor: "#171816",
  cursorAccent: "#ffffff",
  selectionBackground: "#d2d3d0",
  selectionInactiveBackground: "#d9dad7",
  selectionForeground: "#181916",
  black: "#242422",
  red: "#b2473e",
  green: "#34785c",
  yellow: "#8a641f",
  blue: "#3568a7",
  magenta: "#78539b",
  cyan: "#26777b",
  white: "#e9e9e6",
  brightBlack: "#797974",
  brightRed: "#c85a50",
  brightGreen: "#43896b",
  brightYellow: "#9b7429",
  brightBlue: "#477bb8",
  brightMagenta: "#8b66aa",
  brightCyan: "#39898d",
  brightWhite: "#ffffff",
};

function showTerminalCopyStatus(text) {
  const status = $("#terminal-copy-status");
  status.textContent = text;
  status.classList.add("visible");
  window.clearTimeout(terminalCopyStatusTimer);
  terminalCopyStatusTimer = window.setTimeout(() => {
    status.classList.remove("visible");
    status.textContent = "";
  }, 1_400);
}

async function copyTerminalSelection(target = terminal) {
  const selection = target?.getSelection() || "";
  if (!selection) return false;
  await window.workbench.copyText(selection);
  showTerminalCopyStatus(`已复制 ${selection.length} 个字符`);
  return true;
}

function terminalTitle(cwd) {
  const base = cwd.split("/").filter(Boolean).at(-1) || "workspace";
  const ownerThreadId = currentThreadId || activeBrowserTaskId;
  const duplicates = [...terminalSessions.values()]
    .filter((session) => session.baseTitle === base && session.ownerThreadId === ownerThreadId)
    .length;
  return duplicates ? `${base} ${duplicates + 1}` : base;
}

function activateTerminalSession(processId, { focus = true } = {}) {
  const session = terminalSessions.get(processId);
  const ownerThreadId = currentThreadId || activeBrowserTaskId;
  const activeCwd = cwdInput.value.trim();
  if (!session || session.ownerThreadId !== ownerThreadId || session.cwd !== activeCwd) return;
  activeTerminalId = processId;
  terminal = session.terminal;
  terminalProcessId = session.exited ? null : processId;
  for (const item of terminalSessions.values()) {
    const visible = item.ownerThreadId === ownerThreadId && item.cwd === activeCwd;
    const active = visible && item.processId === processId;
    item.tab.hidden = !visible;
    item.host.hidden = !active;
    item.tab.classList.toggle("active", active);
    item.tab.setAttribute("aria-selected", String(active));
    item.tab.tabIndex = active ? 0 : -1;
  }
  requestAnimationFrame(() => {
    if (!terminalDockOpen || activeTerminalId !== processId) return;
    session.fit.fit();
    if (!session.exited) window.workbench.resizeTerminal(processId, session.terminal.cols, session.terminal.rows);
    if (focus) {
      session.terminal.focus();
      session.terminal.textarea?.focus({ preventScroll: true });
    }
    session.tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

async function closeTerminalSession(processId) {
  const session = terminalSessions.get(processId);
  if (!session) return;
  const sessions = [...terminalSessions.values()];
  const index = sessions.findIndex((item) => item.processId === processId);
  const replacement = sessions[index + 1] || sessions[index - 1] || null;
  if (!session.exited) await window.workbench.terminateTerminal(processId);
  session.resizeObserver.disconnect();
  session.terminal.dispose();
  session.tab.remove();
  session.host.remove();
  terminalSessions.delete(processId);
  if (activeTerminalId === processId) {
    activeTerminalId = null;
    terminal = null;
    terminalProcessId = null;
    if (replacement) activateTerminalSession(replacement.processId);
    else setTerminalVisible(false);
  }
}

function createTerminalSession(processId, cwd) {
  const ownerThreadId = currentThreadId || activeBrowserTaskId;
  const host = document.createElement("div");
  host.className = "terminal-host";
  host.dataset.processId = processId;
  $("#terminal-panes").append(host);

  const tab = document.createElement("div");
  tab.className = "terminal-tab";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.tabIndex = -1;
  const glyph = document.createElement("span");
  glyph.className = "terminal-tab-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = ">_";
  const label = document.createElement("strong");
  const baseTitle = cwd.split("/").filter(Boolean).at(-1) || "workspace";
  label.textContent = terminalTitle(cwd);
  const close = document.createElement("button");
  close.className = "terminal-tab-close";
  close.type = "button";
  close.title = "关闭终端";
  close.setAttribute("aria-label", `关闭终端 ${label.textContent}`);
  close.textContent = "×";
  tab.append(glyph, label, close);
  $("#terminal-tabs").append(tab);

  const instance = new window.Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    cursorWidth: 2,
    convertEol: true,
    fontFamily: '"SF Mono", "SFMono-Regular", Menlo, Monaco, monospace',
    fontSize: 13,
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    lineHeight: 1.35,
    macOptionIsMeta: isMacOS,
    minimumContrastRatio: 4.5,
    rightClickSelectsWord: true,
    scrollOnUserInput: true,
    theme: terminalTheme,
    scrollback: 5000,
  });
  const fit = new window.FitAddon.FitAddon();
  instance.loadAddon(fit);
  instance.loadAddon(new window.ClipboardAddon.ClipboardAddon());
  instance.loadAddon(new window.WebLinksAddon.WebLinksAddon((event, uri) => {
    event.preventDefault();
    void selectToolView("browser").then(() => window.workbench.navigate(uri, activeBrowserRouteId));
  }));
  instance.open(host);
  instance.options.theme = terminalTheme;
  instance.element.style.color = terminalTheme.foreground;
  instance.element.style.backgroundColor = terminalTheme.background;

  const session = {
    processId,
    ownerThreadId,
    cwd,
    baseTitle,
    sequence: ++terminalSequence,
    terminal: instance,
    fit,
    host,
    tab,
    exited: false,
    resizeObserver: null,
  };
  terminalSessions.set(processId, session);

  const focusTerminal = () => {
    if (activeTerminalId !== processId) activateTerminalSession(processId, { focus: false });
    instance.focus();
    instance.textarea?.focus({ preventScroll: true });
  };
  instance.textarea?.addEventListener("focus", () => window.workbench.setTerminalFocused(true, processId));
  instance.textarea?.addEventListener("blur", () => window.workbench.setTerminalFocused(false, processId));
  instance.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;
    const key = String(event.key || "").toLowerCase();
    if (key === "c" && ((isMacOS && event.metaKey) || (!isMacOS && event.ctrlKey && event.shiftKey))) {
      if (instance.hasSelection()) void copyTerminalSelection(instance);
      return false;
    }
    if (key === "v" && ((isMacOS && event.metaKey) || (!isMacOS && event.ctrlKey && event.shiftKey))) {
      void window.workbench.readText().then((text) => {
        if (text) instance.paste(text);
        instance.focus();
      });
      return false;
    }
    if (key === "a" && ((isMacOS && event.metaKey) || (!isMacOS && event.ctrlKey && event.shiftKey))) {
      instance.selectAll();
      return false;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && key === "l") {
      instance.clear();
      showTerminalCopyStatus("已清除终端");
      return false;
    }
    return true;
  });
  instance.element.addEventListener("copy", (event) => {
    const selection = instance.getSelection();
    if (!selection) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", selection);
    void window.workbench.copyText(selection);
    showTerminalCopyStatus(`已复制 ${selection.length} 个字符`);
  });
  host.addEventListener("pointerdown", focusTerminal);
  instance.element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    activateTerminalSession(processId, { focus: false });
    void window.workbench.showTerminalContextMenu({ selection: instance.getSelection() });
  });
  instance.onSelectionChange(() => {
    instance.element.classList.toggle("has-selection", instance.hasSelection());
    host.dataset.selectionLength = String(instance.getSelection().length);
  });
  instance.onData((data) => {
    if (!session.exited) window.workbench.writeTerminal(processId, data);
  });
  session.resizeObserver = new ResizeObserver(() => {
    if (activeTerminalId !== processId || !terminalDockOpen || host.hidden) return;
    fit.fit();
    if (!session.exited) window.workbench.resizeTerminal(processId, instance.cols, instance.rows);
  });
  session.resizeObserver.observe(host);
  tab.addEventListener("click", () => activateTerminalSession(processId));
  tab.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateTerminalSession(processId);
    }
  });
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    void closeTerminalSession(processId);
  });
  return session;
}

async function ensureTerminal() {
  if (!terminalMenuBound) {
    terminalMenuBound = true;
    window.workbench.onTerminalMenuAction((action) => {
      if (!terminal) return;
      if (action.type === "copied") showTerminalCopyStatus(`已复制 ${Number(action.length) || 0} 个字符`);
      if (action.type === "copy") void copyTerminalSelection();
      if (action.type === "paste" && action.text) terminal.paste(action.text);
      if (action.type === "select-all") terminal.selectAll();
      if (action.type === "clear") {
        terminal.clear();
        showTerminalCopyStatus("已清除终端");
      }
      terminal.focus();
    });
  }
  const ownerThreadId = currentThreadId || activeBrowserTaskId;
  const activeCwd = cwdInput.value.trim();
  const current = activeTerminalId ? terminalSessions.get(activeTerminalId) : null;
  if (!current || current.exited || current.ownerThreadId !== ownerThreadId || current.cwd !== activeCwd) {
    const existing = [...terminalSessions.values()]
      .filter((session) => session.ownerThreadId === ownerThreadId && session.cwd === activeCwd && !session.exited)
      .at(-1);
    if (existing) activateTerminalSession(existing.processId);
    else await startTerminal();
  }
}

async function startTerminal() {
  const cwd = cwdInput.value.trim();
  const result = await window.workbench.startTerminal({
    cwd,
    cols: terminal?.cols || 100,
    rows: terminal?.rows || 28,
  });
  const session = createTerminalSession(result.processId, cwd);
  activateTerminalSession(result.processId);
  await window.workbench.readyTerminal(result.processId);
  requestAnimationFrame(() => {
    session.fit.fit();
    window.workbench.resizeTerminal(result.processId, session.terminal.cols, session.terminal.rows);
    session.terminal.focus();
    session.terminal.textarea?.focus({ preventScroll: true });
  });
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderDiff(diff) {
  const container = $("#git-diff");
  container.replaceChildren();
  renderDiffLines(container, String(diff).split("\n"), selectedGitFile);
}

function annotateDiffLines(lines) {
  let oldLine = null; let newLine = null;
  return lines.map((text, index) => {
    const header = String(text).match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); return { text, index, type: "hunk", oldLine: null, newLine: null }; }
    if (text.startsWith("diff ")) { oldLine = null; newLine = null; }
    const inHunk = oldLine !== null && newLine !== null;
    const type = text.startsWith("+") && (inHunk || !text.startsWith("+++")) ? "add" : text.startsWith("-") && (inHunk || !text.startsWith("---")) ? "remove" : text.startsWith("diff ") || text.startsWith("# ") || text.startsWith("---") || text.startsWith("+++") ? "header" : "context";
    const item = { text, index, type, oldLine: null, newLine: null, side: null, commentLine: null };
    if (oldLine !== null && type === "remove") { item.oldLine = oldLine++; item.side = "old"; item.commentLine = item.oldLine; }
    else if (newLine !== null && type === "add") { item.newLine = newLine++; item.side = "new"; item.commentLine = item.newLine; }
    else if (oldLine !== null && newLine !== null && type === "context") { item.oldLine = oldLine++; item.newLine = newLine++; item.side = "new"; item.commentLine = item.newLine; }
    return item;
  });
}

function reviewKey(filePath, line, side) { return `${filePath}\0${side}\0${line}`; }

function updateReviewCommentControls() {
  const count = reviewComments.size;
  $("#review-comments-count").textContent = String(count);
  $("#review-comments-submit").disabled = count < 1;
  $("#review-comments-clear").disabled = count < 1;
}

function commentCard(comment, key) {
  const card = document.createElement("div"); card.className = "diff-comment-card"; card.textContent = comment.body;
  card.title = "点击编辑评论";
  card.addEventListener("click", () => { card.replaceWith(commentComposer(comment)); });
  return card;
}

function commentComposer(comment) {
  const key = reviewKey(comment.path, comment.line, comment.side);
  const composer = document.createElement("div"); composer.className = "diff-comment-composer";
  const textarea = document.createElement("textarea"); textarea.placeholder = `评论 ${comment.path}:${comment.line}`; textarea.value = comment.body || "";
  const actions = document.createElement("div"); actions.className = "diff-comment-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消";
  const save = document.createElement("button"); save.type = "button"; save.className = "primary"; save.textContent = "保存评论";
  cancel.addEventListener("click", () => {
    const existing = reviewComments.get(key);
    if (existing) composer.replaceWith(commentCard(existing, key));
    else composer.remove();
  });
  save.addEventListener("click", () => {
    const body = textarea.value.trim(); if (!body) return textarea.focus();
    const saved = { ...comment, body }; reviewComments.set(key, saved); updateReviewCommentControls(); composer.replaceWith(commentCard(saved, key));
  });
  textarea.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); save.click(); } });
  actions.append(cancel, save); composer.append(textarea, actions); setTimeout(() => textarea.focus(), 0); return composer;
}

function renderDiffLines(container, lines, filePath) {
  for (const item of annotateDiffLines(lines)) {
    const row = document.createElement("span"); row.className = `diff-line ${item.type}`;
    const oldNumber = document.createElement("i"); oldNumber.className = "diff-number"; oldNumber.textContent = item.oldLine || "";
    const newNumber = document.createElement("i"); newNumber.className = "diff-number"; newNumber.textContent = item.newLine || "";
    const actions = document.createElement("span"); actions.className = "diff-line-actions";
    if (filePath && item.commentLine) {
      const add = document.createElement("button"); add.type = "button"; add.textContent = "+"; add.title = "添加行级评论";
      add.addEventListener("click", () => row.after(commentComposer({ path: filePath, line: item.commentLine, side: item.side, code: item.text, body: "" })));
      const open = document.createElement("button"); open.type = "button"; open.textContent = "↗"; open.title = "在编辑器中打开";
      open.addEventListener("click", async () => { try { await window.workbench.openEditor({ cwd: cwdInput.value.trim(), path: filePath, line: item.commentLine, column: 1 }); } catch (error) { addEvent("error", "EDITOR", error.message); } });
      actions.append(add, open);
    }
    const code = document.createElement("code"); code.textContent = item.text;
    row.append(oldNumber, newNumber, actions, code); container.append(row);
    if (filePath && item.commentLine) {
      const key = reviewKey(filePath, item.commentLine, item.side);
      if (reviewComments.has(key)) container.append(commentCard(reviewComments.get(key), key));
    }
  }
}

function setGitBusy(value) {
  gitBusy = value;
  for (const button of $$("#git-refresh, #git-stage-all, #git-unstage-all, #git-commit, #git-push, #git-prepare-pr, .git-file-actions button, .git-hunk-actions button")) button.disabled = value;
}

function renderGitHunks(result) {
  const container = $("#git-diff");
  container.replaceChildren();
  const hunks = [...result.staged, ...result.unstaged];
  if (!hunks.length) { renderDiff("当前文件没有可分块操作的文本差异。"); return; }
  for (const hunk of hunks) {
    const card = document.createElement("article");
    card.className = "git-hunk";
    const header = document.createElement("header");
    const area = document.createElement("span");
    area.className = `git-hunk-area${hunk.area === "unstaged" ? " worktree" : ""}`;
    area.textContent = hunk.area === "staged" ? "已暂存" : "工作区";
    const title = document.createElement("span");
    title.className = "git-hunk-title";
    title.textContent = hunk.detail || hunk.title;
    title.title = hunk.title;
    const stats = document.createElement("span");
    stats.className = "git-hunk-stats";
    stats.innerHTML = `<span class="additions">+${hunk.additions}</span> <span class="deletions">−${hunk.deletions}</span>`;
    const actions = document.createElement("span");
    actions.className = "git-hunk-actions";
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = hunk.area === "staged" ? "取消暂存" : "暂存此块";
    action.addEventListener("click", () => runGitHunkMutation(hunk, hunk.area === "staged" ? "unstage" : "stage"));
    actions.append(action);
    if (hunk.area === "unstaged") {
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "danger";
      restore.textContent = "还原此块";
      restore.addEventListener("click", () => runGitHunkMutation(hunk, "restore"));
      actions.append(restore);
    }
    const body = document.createElement("div"); body.className = "git-hunk-lines";
    renderDiffLines(body, hunk.lines, selectedGitFile);
    header.append(area, title, stats, actions);
    card.append(header, body);
    container.append(card);
  }
}

async function runGitHunkMutation(hunk, action) {
  if (gitBusy || !selectedGitFile) return;
  const epoch = workspaceStateEpoch;
  const cwd = cwdInput.value.trim();
  const filePath = selectedGitFile;
  if (action === "restore" && !await confirmAction(`还原 ${selectedGitFile} 中这个代码块的修改？\n\n这部分修改将无法从 OnPeople 恢复。`, {
    title: "丢弃这个代码块？",
    confirmLabel: "丢弃修改",
    tone: "danger",
  })) return;
  setGitBusy(true);
  try {
    const result = await window.workbench.mutateGitHunk({ cwd, path: filePath, area: hunk.area, hunkId: hunk.id, action });
    if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
    currentGitState = result.state;
    renderGitFiles(currentGitState);
    if (result.hunks.staged.length || result.hunks.unstaged.length) renderGitHunks(result.hunks);
    else { selectedGitFile = null; renderDiff(currentGitState.diff); }
  } catch (error) {
    if (epoch === workspaceStateEpoch) addEvent("error", "GIT HUNK", error.message);
  }
  finally {
    if (epoch === workspaceStateEpoch) {
      setGitBusy(false);
      if (currentGitState) renderGitFiles(currentGitState);
    }
  }
}

function gitFileAction(label, action, item, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.classList.toggle("danger", danger);
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (gitBusy) return;
    if (action === "restore" && !await confirmAction(`还原 ${item.path} 的未暂存修改？\n\n这部分修改将无法从 OnPeople 恢复。`, {
      title: "丢弃文件修改？",
      confirmLabel: "丢弃修改",
      tone: "danger",
    })) return;
    await runGitMutation(action, item.path);
  });
  return button;
}

function renderGitFiles(state) {
  const container = $("#git-files");
  container.replaceChildren();
  const stagedCount = state.files.filter((item) => item.staged).length;
  const worktreeCount = state.files.filter((item) => item.unstaged).length;
  $("#git-summary").textContent = state.files.length ? `${state.files.length} 个文件 · ${stagedCount} 已暂存 · ${worktreeCount} 工作区` : "工作区干净";
  $("#git-upstream").textContent = state.upstream || (state.remotes.length ? `未关联上游 · ${state.remotes.join(", ")}` : "没有远程仓库");
  $("#git-stage-all").disabled = gitBusy || worktreeCount === 0;
  $("#git-unstage-all").disabled = gitBusy || stagedCount === 0;
  $("#git-commit").disabled = gitBusy || stagedCount === 0;
  $("#git-push").disabled = gitBusy || state.branch === "detached" || (!state.upstream && !state.remotes.length);
  $("#git-prepare-pr").disabled = gitBusy || !state.canPreparePr;
  if (!state.files.length) {
    const empty = document.createElement("span");
    empty.className = "git-empty";
    empty.textContent = "没有未提交变更。可以继续工作或推送已有提交。";
    container.append(empty);
    return;
  }
  for (const item of state.files) {
    const row = document.createElement("div");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.className = `git-file-row${selectedGitFile === item.path ? " selected" : ""}`;
    const code = document.createElement("span");
    code.className = "git-file-code";
    code.textContent = item.code.replaceAll(" ", "·");
    const filePath = document.createElement("span");
    filePath.className = "git-file-path";
    filePath.textContent = item.originalPath ? `${item.originalPath} → ${item.path}` : item.path;
    filePath.title = filePath.textContent;
    const flags = document.createElement("span");
    flags.className = "git-file-flags";
    if (item.conflicted) {
      const flag = document.createElement("span"); flag.className = "git-file-flag conflict"; flag.textContent = "冲突"; flags.append(flag);
    } else {
      if (item.staged) { const flag = document.createElement("span"); flag.className = "git-file-flag"; flag.textContent = "暂存"; flags.append(flag); }
      if (item.unstaged) { const flag = document.createElement("span"); flag.className = "git-file-flag worktree"; flag.textContent = item.untracked ? "未跟踪" : "工作区"; flags.append(flag); }
    }
    const actions = document.createElement("span");
    actions.className = "git-file-actions";
    if (item.staged) actions.append(gitFileAction("取消", "unstage", item));
    if (item.unstaged) actions.append(gitFileAction("暂存", "stage", item));
    if (item.unstaged && !item.untracked && !item.conflicted) actions.append(gitFileAction("还原", "restore", item, true));
    row.append(code, filePath, flags, actions);
    row.addEventListener("click", async () => {
      selectedGitFile = item.path;
      for (const other of $$(".git-file-row")) other.classList.toggle("selected", other === row);
      try {
        const hunks = await window.workbench.getGitHunks(cwdInput.value.trim(), item.path);
        if (hunks.staged.length || hunks.unstaged.length) renderGitHunks(hunks);
        else renderDiff((await window.workbench.getGitDiff(cwdInput.value.trim(), item.path)).diff);
      }
      catch (error) { renderDiff(error.message); }
    });
    row.addEventListener("keydown", (event) => {
      if (event.target !== row || !new Set(["Enter", " "]).has(event.key)) return;
      event.preventDefault();
      row.click();
    });
    container.append(row);
  }
}

function showGitEmptyState(error) {
  const message = String(error?.message || error || "");
  const isNotRepository = /not a git repository|rev-parse.+show-toplevel/i.test(message);
  $(".changes-view").classList.add("is-empty");
  $("#git-empty-state").hidden = false;
  $("#git-empty-title").textContent = isNotRepository ? "这个项目还没有 Git 仓库" : "暂时无法读取 Git 状态";
  $("#git-empty-description").textContent = isNotRepository
    ? "选择另一个 Git 项目，或在当前目录初始化仓库。初始化只会创建 .git 文件夹，不会提交或上传文件。"
    : "请确认项目目录和 Git 环境可用，然后重试。";
  $("#git-init-repository").hidden = !isNotRepository;
  $("#git-error-detail").textContent = message || "没有更多技术信息。";
}

function hideGitEmptyState() {
  $(".changes-view").classList.remove("is-empty");
  $("#git-empty-state").hidden = true;
  $("#git-error-detail").textContent = "";
}

async function refreshGit() {
  const epoch = workspaceStateEpoch;
  const cwd = cwdInput.value.trim();
  $("#git-summary").textContent = "正在读取 Git 状态…";
  setGitBusy(true);
  try {
    const state = await window.workbench.getGitState(cwd);
    if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
    currentGitState = state;
    hideGitEmptyState();
    $("#git-branch").textContent = state.branch;
    $("#git-root").textContent = state.root;
    if (selectedGitFile && !state.files.some((item) => item.path === selectedGitFile)) selectedGitFile = null;
    renderGitFiles(state);
    if (selectedGitFile) {
      const hunks = await window.workbench.getGitHunks(cwd, selectedGitFile);
      if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
      if (hunks.staged.length || hunks.unstaged.length) renderGitHunks(hunks);
      else {
        const diff = await window.workbench.getGitDiff(cwd, selectedGitFile);
        if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
        renderDiff(diff.diff);
      }
    } else renderDiff(state.diff);
  } catch (error) {
    if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
    currentGitState = null;
    $("#git-branch").textContent = "Git";
    $("#git-root").textContent = cwdInput.value.trim() || "未选择项目";
    $("#git-summary").textContent = "Git 尚未就绪";
    $("#git-upstream").textContent = "—";
    showGitEmptyState(error);
  } finally {
    if (epoch === workspaceStateEpoch) {
      setGitBusy(false);
      if (currentGitState) renderGitFiles(currentGitState);
      else for (const button of $$("#git-stage-all, #git-unstage-all, #git-commit, #git-push, #git-prepare-pr")) button.disabled = true;
    }
  }
}

async function runGitMutation(action, filePath = null) {
  if (gitBusy) return;
  const epoch = workspaceStateEpoch;
  const cwd = cwdInput.value.trim();
  setGitBusy(true);
  try {
    const state = await window.workbench.mutateGit({ cwd, action, path: filePath });
    if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
    currentGitState = state;
    if (selectedGitFile && !currentGitState.files.some((item) => item.path === selectedGitFile)) selectedGitFile = null;
    renderGitFiles(currentGitState);
    if (selectedGitFile) {
      const hunks = await window.workbench.getGitHunks(cwd, selectedGitFile);
      if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
      if (hunks.staged.length || hunks.unstaged.length) renderGitHunks(hunks);
      else {
        const diff = await window.workbench.getGitDiff(cwd, selectedGitFile);
        if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
        renderDiff(diff.diff);
      }
    } else renderDiff(currentGitState.diff);
  } catch (error) {
    if (epoch === workspaceStateEpoch) addEvent("error", "GIT", error.message);
  }
  finally {
    if (epoch === workspaceStateEpoch) {
      setGitBusy(false);
      if (currentGitState) renderGitFiles(currentGitState);
    }
  }
}

function extensionCard(title, description, meta, action, status = null) {
  const card = document.createElement("article");
  card.className = `extension-card${status?.tone ? ` ${status.tone}` : ""}`;
  const copy = document.createElement("div");
  const headingRow = document.createElement("div");
  headingRow.className = "extension-card-heading";
  const heading = document.createElement("strong");
  heading.textContent = title;
  headingRow.append(heading);
  if (status?.label) {
    const badge = document.createElement("span");
    badge.className = "extension-status";
    badge.textContent = status.label;
    headingRow.append(badge);
  }
  const text = document.createElement("p");
  text.textContent = description || "没有描述";
  const small = document.createElement("small");
  small.textContent = meta || "";
  copy.append(headingRow, text, small);
  card.append(copy);
  if (action) card.append(action);
  return card;
}

async function refreshExtensions() {
  if (extensionsRefreshing) return;
  extensionsRefreshing = true;
  const refreshButton = $("#extensions-refresh");
  refreshButton.disabled = true;
  refreshButton.classList.remove("attention");
  refreshButton.textContent = "刷新中…";
  const activeList = $(".extension-list.active");
  if (activeList) activeList.innerHTML = '<span class="empty-list">正在刷新扩展…</span>';
  try {
    const data = await window.workbench.listExtensions(cwdInput.value.trim());
    renderSkills(data.skills || [], data.skillsHome || "", data.skillsUpdatedAt || null);
    renderPlugins(data.plugins || []);
    renderMcp(data.mcpServers || []);
    const errors = $("#extension-errors");
    errors.hidden = !(data.errors || []).length;
    errors.textContent = (data.errors || []).join("\n");
  } catch (error) {
    $("#extension-errors").hidden = false;
    $("#extension-errors").textContent = error.message;
  } finally {
    extensionsRefreshing = false;
    refreshButton.disabled = false;
    refreshButton.textContent = "已是最新";
    setTimeout(() => {
      if (!extensionsRefreshing && !refreshButton.classList.contains("attention")) refreshButton.textContent = "刷新";
    }, 1_200);
  }
}

function renderSkills(skills, skillsHome = "", updatedAt = null) {
  const list = $("#skills-list");
  list.replaceChildren();
  const notice = document.createElement("div");
  notice.className = "skills-scope-note";
  const noticeTitle = document.createElement("strong");
  noticeTitle.textContent = "OnPeople 独立 Skills";
  const noticeCopy = document.createElement("span");
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "等待首次同步";
  noticeCopy.textContent = skillsHome
    ? `实时监控 · ${updatedLabel} · 默认安装到 ${skillsHome}，不会写入本机 Codex 的个人 Skills。`
    : "与本机 Codex 的个人 Skills 分开保存。";
  notice.append(noticeTitle, noticeCopy);
  list.append(notice);
  if (!skills.length) list.insertAdjacentHTML("beforeend", '<span class="empty-list">当前目录没有发现 OnPeople Skills</span>');
  for (const skill of skills) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `toggle-control ${skill.enabled ? "enabled" : ""}`;
    button.textContent = skill.enabled ? "已启用" : "已停用";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await window.workbench.setSkillEnabled(skill.path, !skill.enabled);
        await refreshExtensions();
      } catch (error) { $("#extension-errors").textContent = error.message; }
    });
    list.append(extensionCard(
      skill.name,
      skill.description,
      `${skill.originLabel || skill.scope} · ${skill.hasUiMetadata ? "Skill UI 元数据完整" : "缺少 Skill UI 元数据"} · ${skill.path}`,
      button,
      { label: skill.enabled ? "启用" : "停用", tone: skill.enabled ? "healthy" : "muted" },
    ));
  }
}

function renderPlugins(plugins) {
  const list = $("#plugins-list");
  list.replaceChildren();
  if (!plugins.length) list.innerHTML = '<span class="empty-list">没有发现可用插件市场</span>';
  for (const plugin of plugins) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = plugin.installed ? "secondary danger" : "settings-save";
    button.textContent = plugin.installed ? "卸载" : "安装";
    button.disabled = plugin.availability && plugin.availability !== "AVAILABLE";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (plugin.installed) await window.workbench.uninstallPlugin(plugin.id);
        else await window.workbench.installPlugin({ name: plugin.name, marketplace: plugin.marketplace, marketplacePath: plugin.marketplacePath });
        await refreshExtensions();
      } catch (error) { $("#extension-errors").hidden = false; $("#extension-errors").textContent = error.message; }
    });
    list.append(extensionCard(
      plugin.name,
      plugin.interface?.description || plugin.keywords?.join(" · "),
      `${plugin.marketplace} · ${plugin.version || plugin.localVersion || "local"}`,
      button,
      { label: plugin.installed ? "已安装" : "可安装", tone: plugin.installed ? "healthy" : "available" },
    ));
  }
}

function renderMcp(servers) {
  const list = $("#mcp-list");
  list.replaceChildren();
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "settings-save mcp-reload";
  reload.textContent = "重新载入 MCP 配置";
  reload.addEventListener("click", async () => {
    await window.workbench.reloadMcp();
    await refreshExtensions();
  });
  list.append(reload);
  if (!servers.length) list.append(extensionCard("没有活动 MCP", "启动一个任务后可查看任务级 MCP 服务。", "", null, { label: "空闲", tone: "muted" }));
  for (const server of servers) {
    const toolCount = Object.keys(server.tools || {}).length;
    const connected = !/error|failed|unauthorized/i.test(String(server.authStatus || ""));
    list.append(extensionCard(
      server.serverInfo?.title || server.name,
      server.serverInfo?.description || `${toolCount} 个工具，${server.resources?.length || 0} 个资源`,
      `${server.authStatus} · ${server.serverInfo?.version || "version unknown"}`,
      null,
      { label: connected ? "已连接" : "需处理", tone: connected ? "healthy" : "warning" },
    ));
  }
}

function controlCard(title, status, body, meta = "") {
  const card = document.createElement("article");
  card.className = `control-card ${status || "idle"}`;
  const head = document.createElement("div");
  head.className = "control-card-head";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const badge = document.createElement("span");
  badge.textContent = status || "idle";
  head.append(heading, badge);
  const text = document.createElement("p");
  text.textContent = body || "";
  const small = document.createElement("small");
  small.textContent = meta;
  card.append(head, text, small);
  return card;
}

const AGENT_BOARD_LABELS = {
  pending: "待领取",
  running: "运行中",
  blocked: "被依赖阻塞",
  waiting: "等待用户",
  completed: "已完成",
  failed: "失败",
};

function updateAgentDependencyOptions(tasks = agentBoardState.tasks || []) {
  const select = $("#agent-dependencies");
  const selected = new Set([...select.selectedOptions].map((option) => option.value));
  select.replaceChildren(...tasks.filter((task) => !task.nativeOnly).map((task) => {
    const option = document.createElement("option");
    option.value = task.id;
    option.textContent = `${task.title} · ${AGENT_BOARD_LABELS[task.state] || task.state}`;
    option.selected = selected.has(task.id);
    return option;
  }));
  if (!select.options.length) {
    const option = document.createElement("option");
    option.disabled = true;
    option.textContent = "暂无可选上游任务";
    select.append(option);
  }
}

function agentTaskActions(task, card) {
  const actions = document.createElement("div");
  actions.className = "control-card-actions";
  if (task.agent) {
    const inspect = document.createElement("button");
    inspect.type = "button";
    inspect.textContent = new Set(["running", "waiting"]).has(task.state) ? "查看进度" : "查看结果";
    inspect.addEventListener("click", async () => {
      try {
        const result = await window.workbench.readAgent(task.agent.id);
        const messages = (result.thread.turns || []).flatMap((turn) => turn.items || []).filter((item) => item.type === "agentMessage" && item.text);
        addEvent("agent", `SUBAGENT · ${task.title}`, messages.at(-1)?.text || "暂时没有可显示的结果。");
      } catch (error) { addEvent("error", "SUBAGENT", error.message); }
    });
    actions.append(inspect);
  }
  if (!task.nativeOnly && new Set(["pending", "failed"]).has(task.state)) {
    const dispatch = document.createElement("button");
    dispatch.type = "button";
    dispatch.className = "task-dispatch";
    dispatch.textContent = task.state === "failed" ? "重新派发" : "开始任务";
    dispatch.disabled = Boolean(task.unmetDependencyIds?.length);
    dispatch.title = dispatch.disabled ? "先完成所有上游依赖" : "交给 Codex Core 创建原生子 Agent";
    dispatch.addEventListener("click", async () => {
      dispatch.disabled = true;
      try {
        await window.workbench.dispatchAgentTask(task.id);
        addEvent("tool", "CODEX CORE", `已开始共享任务：${task.title}`);
        await refreshAgents();
      } catch (error) { addEvent("error", "SHARED TASK", error.message); }
      finally { dispatch.disabled = false; }
    });
    actions.append(dispatch);
  }
  if (task.agent && new Set(["running", "waiting"]).has(task.state)) {
    const followup = document.createElement("button");
    followup.type = "button";
    followup.textContent = "追加指令";
    const followupForm = document.createElement("form");
    followupForm.className = "control-card-followup";
    followupForm.hidden = true;
    const followupInput = document.createElement("input");
    followupInput.placeholder = `给 ${task.title} 追加指令`;
    const followupSend = document.createElement("button");
    followupSend.type = "submit";
    followupSend.textContent = "发送";
    followupForm.append(followupInput, followupSend);
    followup.addEventListener("click", () => {
      followupForm.hidden = !followupForm.hidden;
      if (!followupForm.hidden) followupInput.focus();
    });
    followupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = followupInput.value.trim();
      if (!text) return;
      followupSend.disabled = true;
      try {
        await window.workbench.messageAgent(task.agent.id, text);
        addEvent("tool", "CODEX CORE", `已将追加指令交给父任务路由至 ${task.title}。`);
        await refreshAgents();
      } catch (error) { addEvent("error", "SUBAGENT", error.message); }
      finally { followupSend.disabled = false; }
    });
    actions.append(followup);
    card.append(followupForm);
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "danger-outline";
    stop.textContent = "停止";
    stop.addEventListener("click", async () => {
      await window.workbench.stopAgent(task.agent.id);
      await refreshAgents();
    });
    actions.append(stop);
  }
  if (!task.nativeOnly && !task.nativeThreadId && task.dispatchState !== "dispatching") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "task-remove";
    remove.textContent = "移除";
    remove.addEventListener("click", async () => {
      await window.workbench.removeAgentTask(task.id);
      await refreshAgents();
    });
    actions.append(remove);
  }
  return actions;
}

function renderAgentTask(task) {
  const card = document.createElement("article");
  card.className = `agent-task-card ${task.state}`;
  const rail = document.createElement("div");
  rail.className = "agent-task-rail";
  rail.innerHTML = "<i></i>";
  const body = document.createElement("div");
  body.className = "agent-task-body";
  const head = document.createElement("div");
  head.className = "agent-task-head";
  const title = document.createElement("strong");
  title.textContent = task.title;
  const state = document.createElement("span");
  state.className = `agent-task-state ${task.state}`;
  state.textContent = AGENT_BOARD_LABELS[task.state] || task.state;
  head.append(title, state);
  const description = document.createElement("p");
  description.textContent = task.description || "没有补充任务说明。";
  body.append(head, description);
  if (task.dependencies?.length) {
    const dependencies = document.createElement("div");
    dependencies.className = "agent-task-dependencies";
    const label = document.createElement("span");
    label.textContent = "依赖";
    dependencies.append(label);
    for (const dependency of task.dependencies) {
      const pill = document.createElement("i");
      pill.className = dependency.state;
      pill.textContent = dependency.title;
      pill.title = `${dependency.title} · ${AGENT_BOARD_LABELS[dependency.state] || dependency.state}`;
      dependencies.append(pill);
    }
    body.append(dependencies);
  }
  if (task.dispatchError) {
    const error = document.createElement("div");
    error.className = "agent-task-error";
    error.textContent = task.dispatchError;
    body.append(error);
  }
  const meta = document.createElement("small");
  meta.textContent = `${task.role} · ${task.model || "继承模型"} · ${task.effort || "inherit"}${task.agent?.threadId ? ` · ${task.agent.threadId.slice(0, 10)}` : ""}`;
  body.append(meta);
  body.append(agentTaskActions(task, body));
  card.append(rail, body);
  return card;
}

function hasAgentSurfaceContent(agents = managedAgentState, board = agentBoardState) {
  return Boolean((agents || []).length || (board?.tasks || []).length);
}

function applyControlPanelSelection(view) {
  activeControlView = view;
  for (const item of $$('[data-control-view]')) {
    const active = item.dataset.controlView === view;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  }
  for (const panel of $$('[data-control-panel]')) panel.classList.toggle("active", panel.dataset.controlPanel === view);
}

function updateAgentSurfaceVisibility() {
  const visible = agentSurfaceExplicitlyRequested || hasAgentSurfaceContent();
  const tab = $('[data-control-view="agents"]');
  const panel = $('[data-control-panel="agents"]');
  tab.hidden = !visible;
  panel.hidden = !visible;
  if (!visible && activeControlView === "agents") applyControlPanelSelection("diagnostics");
  return visible;
}

function openAgentComposer() {
  agentSurfaceExplicitlyRequested = true;
  updateAgentSurfaceVisibility();
  $("#agent-create").hidden = false;
  $("#agent-advanced-open").hidden = true;
  $("#agent-name").focus();
}

function renderAgents(agents = managedAgentState, maxAgents = policyState?.maxAgents || 4, board = agentBoardState) {
  managedAgentState = agents;
  agentBoardState = board || { tasks: [], counts: {}, states: [] };
  updateAgentSurfaceVisibility();
  const activeStatuses = new Set(["starting", "running", "waitingOnApproval", "waitingOnUserInput"]);
  const active = agents.filter((agent) => activeStatuses.has(agent.status)).length;
  $("#agent-capacity").textContent = `${active} / ${maxAgents} ACTIVE`;
  for (const button of $$("[data-agent-board-state]")) {
    const state = button.dataset.agentBoardState;
    button.classList.toggle("active", activeAgentBoardFilter === state);
    button.querySelector("strong").textContent = String(agentBoardState.counts?.[state] || 0);
  }
  const dependencyCount = (agentBoardState.tasks || []).reduce((sum, task) => sum + (task.dependencyIds?.length || 0), 0);
  $("#agent-dependency-summary").textContent = agentBoardState.tasks?.length
    ? `${agentBoardState.tasks.length} 个任务 · ${dependencyCount} 条依赖 · 点击状态可筛选`
    : "创建任务后，可以为它选择一个或多个上游依赖。";
  updateAgentDependencyOptions(agentBoardState.tasks || []);
  const list = $("#agent-list");
  list.replaceChildren();
  const visibleTasks = (agentBoardState.tasks || []).filter((task) => activeAgentBoardFilter === "all" || task.state === activeAgentBoardFilter);
  if (!visibleTasks.length) {
    list.innerHTML = agentBoardState.tasks?.length
      ? `<span class="control-empty">没有“${AGENT_BOARD_LABELS[activeAgentBoardFilter] || ""}”状态的任务。再次点击筛选可查看全部。</span>`
      : '<span class="control-empty">还没有共享任务。先创建任务，再按依赖顺序交给 Codex Core。</span>';
    return;
  }
  for (const task of visibleTasks) list.append(renderAgentTask(task));
}

async function refreshAgents() {
  const sequence = ++agentRequestSequence;
  const parentThreadId = currentThreadId;
  try {
    const [result, profileResult] = await Promise.all([window.workbench.listAgents(), window.workbench.listAgentProfiles()]);
    if (sequence !== agentRequestSequence || parentThreadId !== currentThreadId) return;
    renderAgentProfiles(profileResult.profiles || []);
    renderAgents(result.agents || [], result.maxAgents, result.board);
  } catch (error) {
    if (sequence === agentRequestSequence) $("#agent-list").innerHTML = `<span class="control-empty">${escapeHtml(error.message)}</span>`;
  }
}

function resetAgentProfileForm(profile = null) {
  $("#profile-agent-id").value = profile?.builtIn ? "" : (profile?.id || "");
  $("#profile-agent-name").value = profile?.name || "";
  $("#profile-agent-role").value = profile?.role || "";
  $("#profile-agent-model").value = profile?.model || "";
  $("#profile-agent-effort").value = profile?.effort || "medium";
  $("#profile-agent-sandbox").value = profile?.sandbox || "inherit";
  $("#profile-agent-instructions").value = profile?.instructions || "";
  $("#profile-agent-delete").disabled = !profile || profile.builtIn;
}

function applyAgentProfile(profile) {
  if (!profile) return;
  $("#agent-name").value = profile.name || "";
  const roleSelect = $("#agent-role");
  const knownRole = [...roleSelect.options].some((option) => option.value === profile.role);
  roleSelect.value = knownRole ? profile.role : "worker";
  $("#agent-model").value = profile.model || "";
  $("#agent-effort").value = profile.effort || "medium";
}

function renderAgentProfiles(profiles) {
  agentProfiles = profiles;
  const select = $("#agent-profile");
  const selected = select.value || "default";
  select.replaceChildren(...profiles.map((profile) => {
    const option = document.createElement("option"); option.value = profile.id; option.textContent = `${profile.name}${profile.builtIn ? "" : " · Custom"}`; return option;
  }));
  select.value = profiles.some((profile) => profile.id === selected) ? selected : "default";
  const list = $("#agent-profile-list"); list.replaceChildren();
  for (const profile of profiles) {
    const card = controlCard(profile.name, profile.builtIn ? "built-in" : "custom", profile.instructions, `${profile.role} · ${profile.model || "继承模型"} · ${profile.effort} · ${profile.sandbox}`);
    card.addEventListener("click", () => resetAgentProfileForm(profile));
    list.append(card);
  }
}

function configChip(label, value) {
  const item = document.createElement("div"); item.className = "config-chip";
  const key = document.createElement("span"); key.textContent = label;
  const copy = document.createElement("strong"); copy.textContent = value || "—";
  item.append(key, copy); return item;
}

async function refreshEffectiveConfig() {
  try {
    const state = await window.workbench.getEffectiveConfig({ cwd: cwdInput.value.trim(), threadId: currentThreadId, model: modelInput.value.trim() });
    $("#effective-config-time").textContent = `${new Date(state.resolvedAt).toLocaleString()} · ${state.cwd}`;
    const summary = $("#effective-config-summary"); summary.replaceChildren(
      configChip("Model", state.model), configChip("Provider", state.provider?.type),
      configChip("Sandbox", state.policy?.sandbox), configChip("Approval", state.policy?.approvalPolicy),
    );
    const sources = $("#effective-config-sources"); sources.replaceChildren();
    if (!state.sources.length) sources.innerHTML = '<span class="control-empty">当前路径没有额外 AGENTS.md 或 .codex/config.toml。</span>';
    for (const source of state.sources) {
      const card = controlCard(source.label, source.kind, source.path, "按从全局到当前目录的顺序叠加");
      const preview = document.createElement("pre"); preview.className = "config-source-preview"; preview.textContent = source.preview || "（空文件）";
      card.append(preview); sources.append(card);
    }
  } catch (error) { $("#effective-config-time").textContent = error.message; }
}

function renderMemories(state) {
  memoryState = state;
  $("#memory-enabled").checked = state.enabled !== false;
  $("#memory-generate").checked = state.generate === true;
  const list = $("#memory-list"); list.replaceChildren();
  if (!state.entries.length) list.innerHTML = '<span class="control-empty">还没有本地记忆。</span>';
  for (const entry of state.entries) {
    const card = controlCard(entry.scope === "global" ? "全局记忆" : "项目记忆", entry.enabled ? "enabled" : "candidate", entry.content, `${entry.source || "user"} · ${new Date(entry.updatedAt).toLocaleString()}`);
    const actions = document.createElement("div"); actions.className = "control-card-actions";
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = entry.enabled ? "停用" : "启用";
    toggle.addEventListener("click", async () => renderMemories((await window.workbench.saveMemory({ ...entry, projectPath: entry.projectPath || cwdInput.value.trim(), enabled: !entry.enabled })).state));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger-outline"; remove.textContent = "删除";
    remove.addEventListener("click", async () => { await window.workbench.deleteMemory(entry.id); await refreshMemories(); });
    actions.append(toggle, remove); card.append(actions); list.append(card);
  }
}

async function refreshMemories() { try { renderMemories(await window.workbench.listMemories(cwdInput.value.trim())); } catch (error) { $("#memory-list").textContent = error.message; } }

function renderUsage(state) {
  const totals = state.rows.reduce((sum, row) => ({ tokens: sum.tokens + row.input + row.output + row.reasoning, cost: sum.cost + row.estimatedCost }), { tokens: 0, cost: 0 });
  $("#usage-total").textContent = `${totals.tokens.toLocaleString()} tokens · $${totals.cost.toFixed(4)}`;
  const list = $("#usage-list"); list.replaceChildren();
  if (!state.rows.length) list.innerHTML = '<span class="control-empty">运行任务后会在本机生成用量账本。</span>';
  for (const row of state.rows) list.append(controlCard(`${row.model} · ${row.provider}`, row.day, `${(row.input + row.output + row.reasoning).toLocaleString()} tokens · $${row.estimatedCost.toFixed(4)}`, `input ${row.input.toLocaleString()} · cached ${row.cached.toLocaleString()} · output ${row.output.toLocaleString()} · reasoning ${row.reasoning.toLocaleString()}`));
}

async function refreshUsage() { try { renderUsage(await window.workbench.getUsageLedger()); } catch (error) { $("#usage-list").textContent = error.message; } }

function renderSecrets(state) {
  const list = $("#secret-list"); list.replaceChildren();
  if (!state.secrets.length) list.innerHTML = '<span class="control-empty">还没有安全变量。密钥值不会显示在这里。</span>';
  for (const secret of state.secrets) {
    const card = controlCard(secret.name, secret.configured ? "encrypted" : "missing", secret.allowedHosts?.join(", ") || "未允许任何域名", `${secret.scope}${secret.projectPath ? ` · ${secret.projectPath}` : ""}`);
    const actions = document.createElement("div"); actions.className = "control-card-actions";
    const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "编辑";
    edit.addEventListener("click", () => { $("#secret-id").value = secret.id; $("#secret-name").value = secret.name; $("#secret-value").value = ""; $("#secret-scope").value = secret.scope; $("#secret-hosts").value = secret.allowedHosts?.join(", ") || ""; });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger-outline"; remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      if (!await confirmAction(`删除安全变量“${secret.name}”？\n\n保存的加密值将被永久移除。`, {
        title: "删除安全变量？",
        confirmLabel: "删除变量",
        tone: "danger",
      })) return;
      await window.workbench.deleteSecret(secret.id);
      await refreshSecrets();
    });
    actions.append(edit, remove); card.append(actions); list.append(card);
  }
}

async function refreshSecrets() { try { renderSecrets(await window.workbench.listSecrets()); } catch (error) { $("#secret-list").textContent = error.message; } }

function renderWorktrees(result) {
  const form = $("#worktree-create");
  const submit = form.querySelector('button[type="submit"]');
  const isRepository = result?.isRepository !== false;
  for (const field of form.querySelectorAll("input")) field.disabled = !isRepository;
  submit.disabled = !isRepository;
  $("#worktree-root").textContent = isRepository
    ? result.root
    : "当前工作区不是 Git 项目";
  const list = $("#worktree-list");
  list.replaceChildren();
  if (!isRepository) {
    const empty = document.createElement("span");
    empty.className = "control-empty worktree-empty";
    empty.textContent = "请返回应用选择一个 Git 项目，或先在“Git”页面初始化当前目录。";
    list.append(empty);
    return;
  }
  for (const worktree of result.worktrees || []) {
    const card = controlCard(worktree.branch, worktree.managed ? "managed" : "local", worktree.path, worktree.head || "");
    const actions = document.createElement("div");
    actions.className = "control-card-actions";
    const handoff = document.createElement("button");
    handoff.type = "button";
    handoff.textContent = "交接到这里";
    handoff.addEventListener("click", async () => {
      const value = await window.workbench.handoffWorktree(worktree.path);
      cwdInput.value = value.cwd;
      updateProject(value.cwd);
      await refreshProjectActions();
      await refreshWorktrees();
    });
    const snapshot = document.createElement("button");
    snapshot.type = "button";
    snapshot.textContent = "保存快照";
    snapshot.addEventListener("click", async () => {
      try { const value = await window.workbench.snapshotWorktree(worktree.path); addEvent("tool", "WORKTREE SNAPSHOT", value.file); }
      catch (error) { addEvent("error", "WORKTREE", error.message); }
    });
    actions.append(handoff, snapshot);
    if (worktree.managed) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger-outline";
      remove.textContent = "快照并清理";
      remove.addEventListener("click", async () => {
        if (!await confirmAction(`OnPeople 会先保存补丁快照，然后清理这个 Worktree：\n\n${worktree.path}`, {
          title: "快照并清理 Worktree？",
          confirmLabel: "保存并清理",
          tone: "danger",
        })) return;
        try { await window.workbench.removeWorktree(worktree.path); await refreshWorktrees(); }
        catch (error) { addEvent("error", "WORKTREE", error.message); }
      });
      actions.append(remove);
    }
    card.append(actions);
    list.append(card);
  }
}

async function refreshWorktrees() {
  try { renderWorktrees(await window.workbench.listWorktrees(cwdInput.value.trim())); }
  catch {
    renderWorktrees({ root: cwdInput.value.trim(), isRepository: false, worktrees: [] });
  }
}

function renderContext(state) {
  const usage = state?.usage;
  const total = usage?.total || {};
  const windowSize = Number(usage?.modelContextWindow || 0);
  const used = Number(total.totalTokens || 0);
  const percent = windowSize ? Math.min(100, Math.round((used / windowSize) * 100)) : 0;
  $("#context-percent").textContent = `${percent}%`;
  $("#context-fill").style.width = `${percent}%`;
  $("#context-breakdown").textContent = usage
    ? `${used.toLocaleString()} / ${windowSize ? windowSize.toLocaleString() : "?"} · input ${Number(total.inputTokens || 0).toLocaleString()} · cached ${Number(total.cachedInputTokens || 0).toLocaleString()} · output ${Number(total.outputTokens || 0).toLocaleString()} · reasoning ${Number(total.reasoningOutputTokens || 0).toLocaleString()}`
    : "尚未收到 Token 使用信息。运行一次任务后会自动更新。";
  const list = $("#context-queue-list");
  list.replaceChildren();
  for (const item of state?.queued || []) list.append(controlCard("NEXT TURN", "queued", item.text, new Date(item.queuedAt).toLocaleString()));
  if (!(state?.queued || []).length) list.innerHTML = '<span class="control-empty">下一轮队列为空。</span>';
}

async function refreshContext() {
  try { renderContext(await window.workbench.getContextState()); }
  catch (error) { $("#context-breakdown").textContent = error.message; }
}

function renderAudit(entries) {
  auditState = entries || [];
  const list = $("#audit-list");
  list.replaceChildren();
  if (!auditState.length) list.innerHTML = '<span class="control-empty">还没有策略或审批事件。</span>';
  for (const entry of auditState) {
    const row = document.createElement("div");
    row.className = "audit-row";
    const time = document.createElement("time");
    time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.action;
    const detail = document.createElement("span");
    detail.textContent = JSON.stringify(entry.detail || {});
    copy.append(title, detail);
    row.append(time, copy);
    list.append(row);
  }
}

function permissionPresetFromPolicy(policy) {
  if (policy?.sandbox === "danger-full-access" && policy?.approvalPolicy === "never") return "full_access";
  if (policy?.approvalPolicy === "on-request" && policy?.approvalsReviewer === "auto_review") return "auto_review";
  return "ask";
}

function renderPermissionPreset(policy) {
  const preset = permissionPresetFromPolicy(policy);
  const control = $(".permission-control");
  const select = $("#permission-preset");
  select.value = preset;
  select.disabled = false;
  control.classList.toggle("auto-review", preset === "auto_review");
  control.classList.toggle("full-access", preset === "full_access");
  control.title = preset === "ask" ? "工作区内自动执行，越界时请求你的批准" : preset === "auto_review" ? "工作区内自动执行，合格的越界请求交给审阅 Agent" : "无沙箱且不请求批准；仅用于受控环境";
  for (const button of $$("[data-settings-permission]")) {
    button.setAttribute("aria-checked", String(button.dataset.settingsPermission === preset));
  }
}

function renderPolicy(result) {
  policyState = result.policy;
  $("#policy-sandbox").value = policyState.sandbox;
  $("#policy-network").checked = Boolean(policyState.networkAccess);
  $("#policy-approval").value = policyState.approvalPolicy;
  $("#policy-reviewer").value = policyState.approvalsReviewer;
  $("#policy-multi-agent").value = policyState.multiAgentMode;
  $("#policy-max-agents").value = policyState.maxAgents;
  renderPermissionPreset(policyState);
  renderAudit(result.audit || []);
  renderAgents(managedAgentState, policyState.maxAgents, agentBoardState);
}

async function refreshPolicy() {
  try { renderPolicy(await window.workbench.getPolicy()); }
  catch (error) { addEvent("error", "POLICY", error.message); }
}

const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyVisualPreferences(preferences = appPreferences) {
  const theme = new Set(["system", "light", "dark"]).has(preferences.theme) ? preferences.theme : "system";
  const resolvedTheme = theme === "system" ? (systemThemeQuery.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.resolvedTheme = resolvedTheme;
  document.documentElement.dataset.density = preferences.density === "compact" ? "compact" : "comfortable";
  document.documentElement.dataset.reduceMotion = String(Boolean(preferences.reduceMotion));
  document.documentElement.classList.toggle("browser-disabled", preferences.browserEnabled === false);
}
systemThemeQuery.addEventListener("change", () => {
  if (appPreferences.theme === "system") applyVisualPreferences();
});

const SETTINGS_SHORTCUTS = [
  { label: "打开命令面板", detail: "搜索任务、文件与操作", mac: "⌘K", windows: "Ctrl+K" },
  { label: "新建任务", detail: "在当前窗口创建独立任务", mac: "⌥⌘S", windows: "Ctrl+Alt+S" },
  { label: "新建浏览器标签", detail: "打开当前任务的内嵌浏览器", mac: "⌘T", windows: "Ctrl+T" },
  { label: "搜索项目文件", detail: "打开文件工具并聚焦搜索框", mac: "⌘P", windows: "Ctrl+P" },
  { label: "切换工具舱", detail: "浏览器、终端、变更、扩展、控制与文件", mac: "⌘1–6", windows: "Ctrl+1–6" },
  { label: "发送消息", detail: "在输入框提交当前内容", mac: "Enter", windows: "Enter" },
  { label: "输入框换行", detail: "在消息中插入新行", mac: "Shift Enter", windows: "Shift Enter" },
];

function renderSettingsShortcuts(query = "") {
  const list = $("#settings-shortcuts-list");
  const normalized = query.trim().toLocaleLowerCase();
  const shortcuts = SETTINGS_SHORTCUTS.filter((item) => !normalized
    || `${item.label} ${item.detail} ${item.mac} ${item.windows}`.toLocaleLowerCase().includes(normalized));
  list.replaceChildren();
  if (!shortcuts.length) {
    list.innerHTML = '<span class="settings-shortcut-empty">没有匹配的快捷键</span>';
    return;
  }
  for (const item of shortcuts) {
    const row = document.createElement("div");
    row.className = "settings-shortcut-row";
    row.innerHTML = `<span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span><kbd>${escapeHtml(isMacOS ? item.mac : item.windows)}</kbd>`;
    list.append(row);
  }
}

async function refreshSettingsMemory() {
  try {
    const state = await window.workbench.listMemories(cwdInput.value.trim());
    memoryState = state;
    $("#settings-memory-enabled").setAttribute("aria-checked", String(state.enabled !== false));
    $("#settings-memory-generate").setAttribute("aria-checked", String(state.generate === true));
    const enabledCount = (state.entries || []).filter((item) => item.enabled).length;
    $("#settings-memory-summary").textContent = `${state.entries?.length || 0} 条记忆 · ${enabledCount} 条已启用`;
  } catch (error) {
    $("#settings-memory-summary").textContent = `无法读取：${error.message}`;
  }
}

async function refreshSettingsPet() {
  try {
    const state = await window.workbench.getPetState();
    $("#settings-pet-visible").setAttribute("aria-checked", String(Boolean(state.visible)));
    const select = $("#settings-pet-skin");
    select.replaceChildren();
    for (const skin of state.skins || []) {
      const option = document.createElement("option");
      option.value = skin.id;
      option.textContent = `${skin.name}${skin.builtIn ? "" : " · 自定义"}`;
      select.append(option);
    }
    select.value = state.skinId || "onpeople";
  } catch (error) {
    addEvent("error", "PET SETTINGS", error.message);
  }
}

function renderPreferences(preferences = {}) {
  appPreferences = { ...appPreferences, ...preferences };
  $("#settings-file-opener").value = appPreferences.defaultFileOpener;
  $("#settings-theme").value = appPreferences.theme;
  $("#settings-density").value = appPreferences.density;
  $("#settings-browser-links").value = appPreferences.browserOpenLinks;
  $("#settings-live-voice").value = appPreferences.liveVoice || "cove";
  $("#settings-download-directory").textContent = appPreferences.downloadDirectory || "系统“下载”文件夹";
  if (document.activeElement !== $("#settings-custom-instructions")) {
    $("#settings-custom-instructions").value = appPreferences.customInstructions || "";
  }
  for (const button of $$("[data-settings-toggle]")) {
    button.setAttribute("aria-checked", String(Boolean(appPreferences[button.dataset.settingsToggle])));
  }
  document.documentElement.classList.toggle("hide-composer-footer", !appPreferences.showComposerFooter);
  document.documentElement.classList.toggle("hide-welcome-suggestions", !appPreferences.showSuggestions);
  applyVisualPreferences(appPreferences);
  syncComposerClearance();
}

async function refreshPreferences() {
  try { renderPreferences(await window.workbench.getPreferences()); }
  catch (error) { addEvent("error", "SETTINGS", error.message); }
}

async function savePreferences(patch) {
  try {
    renderPreferences(await window.workbench.savePreferences({ ...appPreferences, ...patch }));
  } catch (error) {
    addEvent("error", "SETTINGS", error.message);
    renderPreferences(appPreferences);
  }
}

function renderLiveAvailability(state = {}) {
  const card = $("#settings-live-status-dot").closest(".settings-live-status-card");
  card.classList.toggle("available", Boolean(state.available));
  card.classList.toggle("unavailable", state.available === false);
  $("#settings-live-status-title").textContent = state.available ? "GPT-Live 已可用" : "GPT-Live 暂不可用";
  $("#settings-live-status-copy").textContent = [state.message, state.group?.name, state.sidebandStatus]
    .filter(Boolean)
    .join(" · ");
}

async function refreshLiveAvailability() {
  const button = $("#settings-live-refresh");
  button.disabled = true;
  $("#settings-live-status-title").textContent = "正在检查 GPT-Live…";
  try {
    const state = await window.workbench.getLiveStatus();
    renderLiveAvailability(state);
    return state;
  } catch (error) {
    const state = { available: false, message: error.message };
    renderLiveAvailability(state);
    return state;
  } finally {
    button.disabled = false;
  }
}

function setLivePanel({ title, status, transcript, error = false, paused = false, phase } = {}) {
  liveCallPanel.hidden = false;
  composer.classList.add("live-active");
  liveCallPanel.classList.toggle("is-error", error);
  liveCallPanel.classList.toggle("is-paused", paused);
  liveCallPanel.classList.toggle("is-connecting", phase === "connecting");
  liveCallPanel.classList.toggle("is-muted", phase === "muted");
  liveCallPanel.dataset.phase = phase || (error ? "error" : "active");
  if (title) liveCallTitle.textContent = title;
  if (status) liveCallStatus.textContent = status;
  if (transcript) liveCallTranscript.textContent = transcript;
  syncComposerClearance();
}

function updateLiveDuration() {
  const startedAt = Number(liveConversation?.startedAt || 0);
  if (!startedAt) {
    liveCallDuration.hidden = true;
    liveCallDuration.textContent = "00:00";
    liveCallDuration.dateTime = "PT0S";
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  liveCallDuration.hidden = false;
  liveCallDuration.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  liveCallDuration.dateTime = `PT${seconds}S`;
}

function splitLiveContext(text, maxBytes = 480) {
  const source = String(text || "").trim();
  if (!source) return [];
  const encoder = new TextEncoder();
  const chunks = [];
  let current = "";
  for (const character of source) {
    if (encoder.encode(current + character).length > maxBytes && current) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function sendLiveDelegationContext(delegationItemId, text, channel = "speakable", expectedLiveSessionId = null) {
  const dataChannel = liveConversation?.dataChannel;
  if (expectedLiveSessionId && liveConversation?.sessionId !== expectedLiveSessionId) return false;
  if (!delegationItemId || dataChannel?.readyState !== "open") return false;
  for (const chunk of splitLiveContext(text)) {
    dataChannel.send(JSON.stringify({
      type: "delegation.context.append",
      delegation_item_id: delegationItemId,
      channel,
      content: [{ type: "input_text", text: chunk }],
    }));
  }
  return true;
}

function liveDelegationText(item = {}) {
  return (Array.isArray(item.content) ? item.content : [])
    .filter((content) => content?.type === "input_text")
    .map((content) => String(content.text || ""))
    .join("")
    .trim();
}

function normalizedLiveTranscript(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function liveEventRole(event = {}) {
  const role = String(
    event.turn?.role
    || event.turn?.item?.role
    || event.item?.role
    || event.role
    || "",
  ).toLowerCase();
  if (role === "user") return "user";
  if (new Set(["assistant", "agent"]).has(role)) return "assistant";
  const type = String(event.type || "");
  if (type === "conversation.item.input_audio_transcription.completed") return "user";
  if (new Set(["response.audio_transcript.done", "response.output_audio_transcript.done"]).has(type)) return "assistant";
  return null;
}

function liveEventTranscript(event = {}) {
  return normalizedLiveTranscript(
    event.turn?.transcript
    || event.turn?.item?.transcript
    || event.item?.transcript
    || event.item?.text
    || event.transcript
    || event.text
    || "",
  );
}

function appendLiveTranscript(event = {}) {
  const role = liveEventRole(event);
  const text = liveEventTranscript(event);
  if (!role || !text) return false;
  if (role === "user") lastLiveUserTranscript = text;
  const now = Date.now();
  const key = `${role}\u0000${text.toLocaleLowerCase()}`;
  const previousAt = Number(liveTranscriptHistory.get(key) || 0);
  if (now - previousAt < LIVE_TRANSCRIPT_DEDUPE_WINDOW_MS) return false;
  liveTranscriptHistory.set(key, now);
  for (const [storedKey, storedAt] of liveTranscriptHistory) {
    if (now - storedAt >= LIVE_TRANSCRIPT_DEDUPE_WINDOW_MS) liveTranscriptHistory.delete(storedKey);
  }
  addEvent(role === "user" ? "user" : "agent", role === "user" ? "LIVE · YOU" : "LIVE", text);
  return true;
}

function clearLiveDelegationFallback() {
  if (liveDelegationFallbackTimer) window.clearTimeout(liveDelegationFallbackTimer);
  liveDelegationFallbackTimer = null;
}

function clearLiveDelegationWait(delegation = pendingLiveDelegation) {
  if (delegation?.waitTimer) window.clearTimeout(delegation.waitTimer);
  if (delegation) delegation.waitTimer = null;
}

function updateLiveDelegationTrace(delegation, status, summary, detail = "") {
  if (!delegation) return null;
  ensureProcessFlow();
  const card = upsertTraceItem({
    id: delegation.traceId,
    type: "event",
    label: "LIVE → TASK",
    message: summary,
    details: detail || `语音请求\n${delegation.text}`,
    status,
  }, status === "inProgress" ? "started" : status, { open: status === "failed" });
  card.classList.add("trace-live-handoff");
  return card;
}

function pendingLiveDelegationMatchesThread(delegation, threadId) {
  const id = String(threadId || "").trim();
  return Boolean(delegation && (!delegation.threadId || !id || delegation.threadId === id));
}

function finalizePendingLiveDelegation({
  threadId = currentThreadId,
  status = "completed",
  error = "",
  finalText = "",
} = {}) {
  const delegation = pendingLiveDelegation;
  if (!pendingLiveDelegationMatchesThread(delegation, threadId)) return false;
  clearLiveDelegationWait(delegation);
  const failed = status === "failed";
  const resultText = String(finalText || "").trim();
  const returnedToLive = !failed
    && delegation.native
    && resultText
    && sendLiveDelegationContext(
      delegation.itemId,
      resultText,
      "speakable",
      delegation.liveSessionId,
    );
  if (failed && delegation.native) {
    sendLiveDelegationContext(
      delegation.itemId,
      `OnPeople could not complete the delegated task: ${error || "the task failed"}`,
      "speakable",
      delegation.liveSessionId,
    );
  }
  updateLiveDelegationTrace(
    delegation,
    failed ? "failed" : "completed",
    failed ? "任务执行失败" : resultText ? "结果已返回" : "任务已完成",
    failed ? (error || "任务未能完成") : "",
  );
  pendingLiveDelegation = null;
  setLivePanel(failed
    ? {
        title: "任务执行失败",
        status: error || "任务未能完成",
        transcript: delegation.text,
        error: true,
        paused: true,
      }
    : {
        title: returnedToLive ? "结果已返回语音会话" : "任务结果已记录",
        status: returnedToLive ? "GPT-Live 将继续向你说明" : "结果已显示在当前任务中",
        transcript: resultText || delegation.text,
        paused: !returnedToLive,
        phase: returnedToLive ? "speaking" : "completed",
      });
  return true;
}

function reconcileCurrentThreadTerminalState({
  threadId,
  status = "completed",
  completedAt = null,
  error = "",
  finalText = "",
} = {}) {
  const id = String(threadId || "").trim();
  if (!id || id !== currentThreadId || !new Set(["completed", "failed", "idle", "stopped"]).has(status)) return false;
  const completedAtMs = timestampMs(completedAt);
  if (currentTurnStartedAt && completedAtMs && completedAtMs < currentTurnStartedAt) return false;
  finalizePendingLiveDelegation({
    threadId: id,
    status: status === "failed" ? "failed" : "completed",
    error,
    finalText,
  });
  finishProcessFlow(status === "failed" ? "failed" : "completed", { finishedAt: completedAtMs });
  currentTurnStartedAt = null;
  setThreadRuntimeState(id, status === "failed" ? "failed" : "completed");
  setRunning(false);
  activeAgentMessage = null;
  activeAgentMessagePhase = null;
  traceCards.delete("active-plan");
  return true;
}

function queueLiveDelegationFallback(assistantText) {
  if (
    !liveConversation
    || pendingLiveDelegation
    || !liveDelegationPolicy?.shouldRecoverDelegation?.({
      assistantText,
      userText: lastLiveUserTranscript,
    })
  ) return;
  const request = lastLiveUserTranscript;
  clearLiveDelegationFallback();
  setLivePanel({
    title: "准备交给当前任务",
    status: "正在创建可追踪任务",
    transcript: request,
    paused: true,
    phase: "delegating",
  });
  liveDelegationFallbackTimer = window.setTimeout(() => {
    liveDelegationFallbackTimer = null;
    if (!liveConversation || pendingLiveDelegation) return;
    void dispatchLiveDelegation({
      source: "recovered",
      content: [{ type: "input_text", text: request }],
    });
  }, LIVE_DELEGATION_FALLBACK_DELAY_MS);
}

async function dispatchLiveDelegation(item = {}) {
  clearLiveDelegationFallback();
  const nativeDelegationItemId = String(item.id || "");
  const text = liveDelegationText(item);
  if (!text) return;
  if (pendingLiveDelegation) {
    if (nativeDelegationItemId && nativeDelegationItemId === pendingLiveDelegation.itemId) return;
    if (
      nativeDelegationItemId
      && !pendingLiveDelegation.native
      && liveDelegationPolicy?.normalizeTranscript?.(pendingLiveDelegation.text)
        === liveDelegationPolicy?.normalizeTranscript?.(text)
    ) {
      pendingLiveDelegation.itemId = nativeDelegationItemId;
      pendingLiveDelegation.native = true;
      pendingLiveDelegation.source = "native";
      updateLiveDelegationTrace(
        pendingLiveDelegation,
        "inProgress",
        "当前任务正在运行",
        `GPT-Live 已确认原生委派。\n\n语音请求\n${text}`,
      );
      return;
    }
    if (nativeDelegationItemId) {
      sendLiveDelegationContext(nativeDelegationItemId, "OnPeople is already handling another delegated task. Ask the user to wait for that result.");
    }
    return;
  }
  const native = Boolean(nativeDelegationItemId);
  const delegationItemId = nativeDelegationItemId || `local-${crypto.randomUUID()}`;
  const delegation = {
    itemId: delegationItemId,
    native,
    source: native ? "native" : "recovered",
    text,
    liveSessionId: liveConversation?.sessionId || null,
    traceId: `live-handoff-${delegationItemId}`,
    threadId: currentThreadId || null,
    turnStarted: false,
    waitTimer: null,
  };
  pendingLiveDelegation = delegation;
  updateLiveDelegationTrace(
    delegation,
    "inProgress",
    "已交给当前任务",
    native
      ? `GPT-Live 已创建原生委派。\n\n语音请求\n${text}`
      : `GPT-Live 未创建原生委派，OnPeople 已自动恢复执行。\n\n语音请求\n${text}`,
  );
  setLivePanel({
    title: "已交给当前任务",
    status: "任务已记录，等待执行轨迹",
    transcript: text,
    paused: true,
    phase: "delegating",
  });
  setRunning(true);
  try {
    const result = await window.workbench.sendPrompt({
      threadId: currentThreadId,
      browserRouteId: activeBrowserRouteId,
      clientMessageId: crypto.randomUUID(),
      cwd: cwdInput.value.trim(),
      workspaceMode: selectedWorkspaceMode,
      workspaceBaseCwd: selectedWorkspaceBaseCwd,
      modelProvider: providerSelect.value,
      model: modelInput.value.trim(),
      reasoningEffort: selectedReasoningEffort,
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value,
      prompt: text,
      mode: "default",
      images: [],
      attachments: [],
      capability: null,
    });
    delegation.threadId = result.threadId;
    currentThreadId = result.threadId;
    if (result.cwd) {
      cwdInput.value = result.cwd;
      selectedWorkspaceMode = result.workspaceMode || selectedWorkspaceMode;
      selectedWorkspaceBaseCwd = result.workspaceBaseCwd || selectedWorkspaceBaseCwd;
      cwdInput.disabled = true;
      updateProject(result.cwd);
    }
    await promoteBrowserTab(result.threadId);
    threadLabel.textContent = result.threadId.slice(0, 13).toUpperCase();
    await loadThreads();
    if (pendingLiveDelegation === delegation && !delegation.turnStarted) {
      updateLiveDelegationTrace(delegation, "inProgress", "任务已启动，等待工具进度");
      delegation.waitTimer = window.setTimeout(() => {
        if (pendingLiveDelegation !== delegation || delegation.turnStarted) return;
        updateLiveDelegationTrace(delegation, "inProgress", "任务已排队，等待运行");
        setLivePanel({
          title: "已交给当前任务",
          status: "当前任务仍在队列中，进度会继续记录",
          transcript: text,
          paused: true,
          phase: "delegating",
        });
      }, 8_000);
    }
  } catch (error) {
    if (delegation.native) {
      sendLiveDelegationContext(delegation.itemId, `OnPeople could not complete the delegated request: ${error.message}`);
    }
    clearLiveDelegationWait(delegation);
    updateLiveDelegationTrace(delegation, "failed", "委派失败", error.message);
    if (pendingLiveDelegation === delegation) pendingLiveDelegation = null;
    setLivePanel({ title: "委派失败", status: error.message, transcript: text, error: true, paused: true });
    setRunning(false);
  }
}

function handleLiveDataMessage(raw) {
  let event;
  try { event = JSON.parse(String(raw || "")); } catch { return; }
  const type = String(event.type || "");
  if (new Set(["session.started", "session.updated", "session.created"]).has(type)) {
    setLivePanel({ title: "GPT-Live 正在聆听", status: "实时音频已连接", transcript: "你可以开始说话。", phase: "listening" });
    return;
  }
  if (type === "input_transcript.added" || type === "output_transcript.added") {
    const text = String(event.item?.text || "").trim();
    if (text) setLivePanel({
      title: type.startsWith("input_") ? "正在聆听" : "OnPeople 正在回复",
      status: "GPT-Live 实时会话",
      transcript: text,
      phase: type.startsWith("input_") ? "listening" : "speaking",
    });
    return;
  }
  if (new Set([
    "turn.done",
    "conversation.item.input_audio_transcription.completed",
    "response.audio_transcript.done",
    "response.output_audio_transcript.done",
  ]).has(type)) {
    const role = liveEventRole(event);
    const text = liveEventTranscript(event);
    if (text) {
      appendLiveTranscript(event);
      if (role === "assistant") queueLiveDelegationFallback(text);
      setLivePanel({
        title: role === "assistant" && liveDelegationFallbackTimer ? "准备交给当前任务"
          : role === "assistant" ? "OnPeople 正在回复" : "GPT-Live 正在聆听",
        status: role === "assistant" && liveDelegationFallbackTimer ? "正在创建可追踪任务" : "实时音频已连接",
        transcript: text,
        paused: Boolean(liveDelegationFallbackTimer),
        phase: role === "assistant" && liveDelegationFallbackTimer ? "delegating"
          : role === "assistant" ? "speaking" : "listening",
      });
    }
    return;
  }
  if (type === "delegation.created") {
    void dispatchLiveDelegation(event.item || {});
    return;
  }
  if (type === "error") {
    const message = event.error?.message || event.message || "GPT-Live 会话发生错误";
    setLivePanel({ title: "实时语音出错", status: message, transcript: "可以结束后重新连接。", error: true, paused: true });
  }
}

function waitForIceGathering(peerConnection, timeoutMs = 5_000) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, timeoutMs);
    function done() {
      window.clearTimeout(timer);
      peerConnection.removeEventListener("icegatheringstatechange", changed);
      resolve();
    }
    function changed() {
      if (peerConnection.iceGatheringState === "complete") done();
    }
    peerConnection.addEventListener("icegatheringstatechange", changed);
  });
}

function releaseLiveConversation({ keepPanel = false } = {}) {
  const session = liveConversation;
  liveConversation = null;
  clearLiveDelegationFallback();
  clearLiveDelegationWait(pendingLiveDelegation);
  lastLiveUserTranscript = "";
  if (session?.callId) {
    void window.workbench.closeLiveSession(session.callId).catch(() => {});
  }
  if (session?.dataChannel?.readyState === "open") {
    try { session.dataChannel.send(JSON.stringify({ type: "session.close" })); } catch {}
  }
  try { session?.dataChannel?.close(); } catch {}
  try { session?.peerConnection?.close(); } catch {}
  for (const track of session?.localStream?.getTracks?.() || []) track.stop();
  liveAudio.srcObject = null;
  liveStartButton.classList.remove("active");
  liveStartButton.setAttribute("aria-label", "开始 GPT-Live 实时语音");
  liveMuteButton.setAttribute("aria-pressed", "false");
  liveMuteButton.setAttribute("aria-label", "静音麦克风");
  liveMuteLabel.textContent = "静音";
  if (session?.durationTimer) window.clearInterval(session.durationTimer);
  updateLiveDuration();
  if (!keepPanel) {
    liveCallPanel.hidden = true;
    composer.classList.remove("live-active");
    syncComposerClearance();
  }
}

async function startLiveConversation() {
  if (liveConversation) {
    releaseLiveConversation();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection !== "function") {
    throw new Error("当前系统不支持 WebRTC 麦克风会话");
  }
  liveTranscriptHistory.clear();
  clearLiveDelegationFallback();
  lastLiveUserTranscript = "";
  setLivePanel({ title: "正在连接 GPT-Live", status: "正在检查账户与语音权限", transcript: "建立安全的实时音频连接…", phase: "connecting" });
  const availability = await refreshLiveAvailability();
  if (!availability.available) throw new Error(availability.message || "GPT-Live 暂不可用");

  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: appPreferences.liveEchoCancellation !== false,
      noiseSuppression: appPreferences.liveNoiseSuppression !== false,
      autoGainControl: appPreferences.liveAutoGainControl !== false,
    },
    video: false,
  });
  const peerConnection = new RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel("oai-events");
  liveConversation = {
    peerConnection,
    dataChannel,
    localStream,
    muted: false,
    startedAt: Date.now(),
    durationTimer: null,
    callId: null,
    sessionId: crypto.randomUUID(),
  };
  liveConversation.durationTimer = window.setInterval(updateLiveDuration, 1_000);
  updateLiveDuration();
  liveStartButton.classList.add("active");
  liveStartButton.setAttribute("aria-label", "结束 GPT-Live 实时语音");

  peerConnection.ontrack = (event) => {
    liveAudio.srcObject = event.streams?.[0] || new MediaStream([event.track]);
    void liveAudio.play().catch(() => {});
  };
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === "connected") {
      setLivePanel({ title: "GPT-Live 正在聆听", status: "实时语音已连接", transcript: "你可以开始说话。", phase: "listening" });
    } else if (new Set(["failed", "closed"]).has(state) && liveConversation?.peerConnection === peerConnection) {
      setLivePanel({ title: "实时语音已断开", status: `WebRTC ${state}`, transcript: "请结束后重新连接。", error: true, paused: true });
      releaseLiveConversation({ keepPanel: true });
    }
  };
  dataChannel.onopen = () => {
    setLivePanel({ title: "GPT-Live 正在聆听", status: "实时语音已连接", transcript: "你可以开始说话。", phase: "listening" });
  };
  dataChannel.onmessage = (event) => handleLiveDataMessage(event.data);
  dataChannel.onerror = () => setLivePanel({ title: "实时事件通道异常", status: "音频可能仍可继续", transcript: "若无法交互，请重新连接。", error: true });

  for (const track of localStream.getAudioTracks()) peerConnection.addTrack(track, localStream);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIceGathering(peerConnection);
  const initialText = promptInput.value.trim();
  const created = await window.workbench.createLiveSession({
    sdp: peerConnection.localDescription?.sdp || offer.sdp,
    voice: appPreferences.liveVoice || "cove",
    initialItems: initialText ? [{ role: "user", text: initialText }] : [],
  });
  if (liveConversation?.peerConnection === peerConnection) liveConversation.callId = created.callId;
  await peerConnection.setRemoteDescription({ type: "answer", sdp: created.sdp });
  const ready = peerConnection.connectionState === "connected" || dataChannel.readyState === "open";
  setLivePanel(ready
    ? {
        title: "GPT-Live 正在聆听",
        status: "实时语音已连接",
        transcript: initialText || "你可以开始说话。",
        phase: "listening",
      }
    : {
        title: "正在连接语音",
        status: "正在准备语音与任务能力",
        transcript: initialText || "连接完成后即可开始说话。",
        phase: "connecting",
      });
}

const SETTINGS_FEATURES = {
  profile: {
    title: "个人资料", copy: "管理 OnPeople 登录身份、余额和云端使用记录。",
    cardTitle: "OnPeople 账户", cardCopy: "打开账户中心查看当前登录状态与资料。", action: "打开账户",
    run: () => $("#cloud-account-open").click(),
  },
  appearance: {
    title: "外观", copy: "OnPeople 当前会跟随系统的字体渲染和浅色外观。",
    cardTitle: "系统外观", cardCopy: "当前版本使用适配 macOS 与 Windows 的统一浅色界面。", action: null,
  },
  voice: {
    title: "语音", copy: "输入框支持系统听写；麦克风权限由操作系统统一管理。",
    cardTitle: "系统听写", cardCopy: "在输入框中使用 macOS 或 Windows 的系统听写能力。", action: null,
  },
  configuration: {
    title: "配置", copy: "管理当前任务的模型来源、模型、API Router 与应用更新。",
    cardTitle: "运行设置", cardCopy: "打开侧栏中的任务级模型和 Provider 配置。", action: "打开运行设置",
    run: () => openSettingsCenter("configuration"),
  },
  personalization: {
    title: "个性化", copy: "任务行为由项目指令、Skills 与当前会话上下文共同决定。",
    cardTitle: "Skills 与项目指令", cardCopy: "前往扩展面板管理可用 Skills。", action: "管理 Skills",
    run: async () => { await selectToolView("extensions"); $("[data-extension-view='skills']")?.click(); },
  },
  pet: {
    title: "宠物", copy: "控制桌面小海獭，并让它显示当前任务状态。",
    cardTitle: "OnPeople 小海獭", cardCopy: "显示或收起当前桌面宠物窗口。", action: "切换显示",
    run: () => window.workbench.togglePet(),
  },
  shortcuts: {
    title: "键盘快捷键", copy: "⌘/Ctrl+1–6 切换工具舱，⌘/Ctrl+P 搜索项目文件，Enter 发送消息。",
    cardTitle: "系统快捷键", cardCopy: "快捷键会根据 macOS 或 Windows 自动切换修饰键。", action: null,
  },
  usage: {
    title: "使用情况和计费", copy: "查看本机 Token 账本、OnPeople 云端额度与公开排行榜。",
    cardTitle: "使用情况", cardCopy: "打开 Token 使用详情和云端账户余额。", action: "查看使用情况",
    run: () => openUsageProfile(),
  },
  account: {
    title: "账户", copy: "登录 OnPeople、查看余额并管理云端模型访问。",
    cardTitle: "OnPeople 账户", cardCopy: "打开登录、注册和账户管理界面。", action: "管理账户",
    preserveSettings: true,
    run: () => openCloudAccountManagement(),
  },
  snapshots: {
    title: "智能快照", copy: "使用内嵌浏览器生成可审阅的页面快照和批注。",
    cardTitle: "浏览器快照", cardCopy: "打开当前任务独享的浏览器标签页。", action: "打开浏览器",
    run: () => selectToolView("browser"),
  },
  plugins: {
    title: "插件", copy: "管理 OnPeople Plugins、Skills 与 MCP 服务。",
    cardTitle: "扩展中心", cardCopy: "查看已安装插件并进行安装或卸载。", action: "管理插件",
    run: async () => { await selectToolView("extensions"); $("[data-extension-view='plugins']")?.click(); },
  },
  browser: {
    title: "浏览器", copy: "管理任务独享的内嵌浏览器、登录资料和操作验证。",
    cardTitle: "内嵌浏览器", cardCopy: "每个任务拥有隔离的标签与路由状态。", action: "打开浏览器",
    run: () => selectToolView("browser"),
  },
  computer: {
    title: "电脑操控", copy: "检查 Computer Use 驱动与本机自动化运行状态。",
    cardTitle: "运行诊断", cardCopy: "打开诊断中心验证本机操控能力。", action: "打开诊断",
    run: () => selectControlPanel("diagnostics"),
  },
  hooks: {
    title: "钩子", copy: "管理项目生命周期 Hooks 与执行信任状态。",
    cardTitle: "Hooks", cardCopy: "打开控制中心查看和创建项目 Hooks。", action: "管理 Hooks",
    run: () => selectControlPanel("hooks"),
  },
  connections: {
    title: "连接", copy: "查看模型路由、MCP 与 Codex Core 的有效连接配置。",
    cardTitle: "有效配置", cardCopy: "检查当前任务实际使用的连接与运行参数。", action: "查看连接",
    run: () => selectControlPanel("config"),
  },
  git: {
    title: "Git", copy: "查看当前工作空间的变更、Diff、Review 与提交状态。",
    cardTitle: "Git 变更", cardCopy: "打开当前项目的原生变更视图。", action: "打开 Git",
    run: () => selectToolView("changes"),
  },
  environment: {
    title: "环境", copy: "检查当前任务工作目录、运行时与模型配置。",
    cardTitle: "运行环境", cardCopy: "打开有效配置和运行时诊断。", action: "检查环境",
    run: () => selectControlPanel("config"),
  },
  worktrees: {
    title: "工作树", copy: "管理 Git Worktree 隔离副本与任务交接。",
    cardTitle: "Git Worktree", cardCopy: "创建、查看或移除任务隔离工作树。", action: "管理工作树",
    run: () => selectControlPanel("worktrees"),
  },
  archived: {
    title: "已归档任务", copy: "查看已经归档、仍可恢复的历史任务。",
    cardTitle: "任务归档", cardCopy: "返回应用并切换到已归档任务列表。", action: "查看归档",
    run: () => $(".task-filter [data-archived='true']")?.click(),
  },
};

const SETTINGS_LIVE_CONTROLS = {
  computer: { view: "diagnostics", kicker: "COMPUTER USE", title: "电脑操控", copy: "直接检查驱动、权限、运行时状态与恢复事件。" },
  hooks: { view: "hooks", mode: "manager", kicker: "PROJECT HOOKS", title: "钩子", copy: "创建项目生命周期 Hook，并查看信任状态与最近运行记录。" },
  connections: { view: "config", kicker: "EFFECTIVE CONFIG", title: "连接", copy: "直接查看当前任务最终生效的 Provider、MCP 与运行参数来源。" },
  environment: { view: "config", kicker: "TASK ENVIRONMENT", title: "环境", copy: "直接核对当前任务的工作目录、模型、策略与环境配置。" },
  worktrees: { view: "worktrees", kicker: "GIT WORKTREE", title: "工作树", copy: "直接创建、查看、交接或移除任务隔离工作树。" },
};
const SETTINGS_LIVE_UTILITIES = {
  plugins: { view: "extensions", kicker: "PLUGINS · SKILLS · MCP", title: "插件", copy: "直接查看、刷新、安装或移除 OnPeople 扩展。" },
  git: { view: "changes", mode: "manager", kicker: "GIT", title: "Git", copy: "查看仓库状态，并进入完整的变更、Diff、Review、提交与推送工具。" },
};

function restoreSettingsLivePanel() {
  if (!activeSettingsLivePanel) return;
  activeSettingsLivePanelOrigin?.append(activeSettingsLivePanel);
  if (activeSettingsLiveUtilityView) {
    activeSettingsLivePanel.classList.toggle("active", activeToolView === activeSettingsLiveUtilityView);
  }
  if (activeSettingsPreviousControlView) {
    applyControlPanelSelection(activeSettingsPreviousControlView);
  }
  activeSettingsLivePanel = null;
  activeSettingsLivePanelOrigin = null;
  activeSettingsLiveUtilityView = null;
  activeSettingsPreviousControlView = null;
  settingsLiveHost.replaceChildren();
}

async function showSettingsLiveControl(route) {
  const definition = SETTINGS_LIVE_CONTROLS[route];
  if (!definition) return false;
  if (definition.mode === "manager") return showSettingsHooksManager(definition);
  restoreSettingsLivePanel();
  activeSettingsPreviousControlView = activeControlView;
  applyControlPanelSelection(definition.view);
  const panel = $(`[data-control-panel="${definition.view}"]`);
  if (!panel) return false;
  $("#settings-live-kicker").textContent = definition.kicker;
  $("#settings-live-title").textContent = definition.title;
  $("#settings-live-copy").textContent = definition.copy;
  activeSettingsLivePanelOrigin = controlViewContainer;
  settingsLiveHost.append(panel);
  activeSettingsLivePanel = panel;
  await refreshControl();
  return true;
}

function settingsRequestWithTimeout(request, message, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(request).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function createSettingsHooksManager() {
  const panel = document.createElement("section");
  panel.className = "settings-hooks-manager";
  panel.innerHTML = `
    <header>
      <div><span>PROJECT LIFECYCLE</span><strong id="settings-hooks-heading">正在读取 Hooks…</strong><small id="settings-hooks-root"></small></div>
      <button id="settings-hooks-refresh" type="button">刷新</button>
    </header>
    <div id="settings-hook-create">
      <div class="settings-hooks-grid">
        <label class="settings-hook-event-field"><span>事件</span><button id="settings-hook-event" class="settings-hook-event" type="button" aria-expanded="false"><strong>PreToolUse</strong><span>⌄</span></button><div id="settings-hook-event-menu" class="settings-hook-event-menu" hidden></div></label>
        <label><span>Matcher</span><input id="settings-hook-matcher" placeholder="可留空" /></label>
      </div>
      <label><span>命令</span><textarea id="settings-hook-command" rows="3" placeholder="要执行的绝对路径命令；保存前请审阅…"></textarea></label>
      <div class="settings-hooks-grid">
        <label><span>运行提示</span><input id="settings-hook-status" placeholder="OnPeople Hook" /></label>
        <label><span>超时（秒）</span><input id="settings-hook-timeout" inputmode="numeric" value="30" /></label>
      </div>
      <div class="settings-hooks-submit"><small>保存后仍需按当前命令哈希审阅并信任，修改后会重新进入待审阅状态。</small><button id="settings-hook-save" class="primary" type="button">保存 Hook</button></div>
    </div>
    <div id="settings-hooks-error" class="settings-hooks-error" hidden></div>
    <div class="settings-hooks-columns">
      <section><header><strong>已发现的 Hooks</strong><span id="settings-hooks-count">0</span></header><div id="settings-hooks-list" class="settings-hooks-list"></div></section>
      <section><header><strong>最近运行</strong><span>START / COMPLETE</span></header><div id="settings-hooks-runs" class="settings-hooks-list"></div></section>
    </div>
  `;
  panel.querySelector("#settings-hooks-refresh").addEventListener("click", () => void refreshSettingsHooksManager(panel));
  const events = ["PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SessionStart", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop"];
  const eventButton = panel.querySelector("#settings-hook-event");
  const eventMenu = panel.querySelector("#settings-hook-event-menu");
  for (const eventName of events) {
    const option = document.createElement("button");
    option.type = "button";
    option.textContent = eventName;
    option.classList.toggle("selected", eventName === "PreToolUse");
    option.addEventListener("click", () => {
      eventButton.dataset.value = eventName;
      eventButton.querySelector("strong").textContent = eventName;
      for (const item of eventMenu.children) item.classList.toggle("selected", item === option);
      eventMenu.hidden = true;
      eventButton.setAttribute("aria-expanded", "false");
    });
    eventMenu.append(option);
  }
  eventButton.dataset.value = "PreToolUse";
  eventButton.addEventListener("click", () => {
    eventMenu.hidden = !eventMenu.hidden;
    eventButton.setAttribute("aria-expanded", String(!eventMenu.hidden));
  });
  panel.querySelector("#settings-hook-save").addEventListener("click", async () => {
    const commandInput = panel.querySelector("#settings-hook-command");
    const command = commandInput.value.trim();
    if (!command || !await confirmAction(`保存后仍需按哈希审阅并信任，才会执行：\n\n${command}`, {
      title: "保存命令 Hook？",
      confirmLabel: "保存 Hook",
      tone: "warning",
    })) return;
    const button = panel.querySelector("#settings-hook-save");
    const error = panel.querySelector("#settings-hooks-error");
    button.disabled = true;
    button.textContent = "正在保存…";
    error.hidden = true;
    try {
      await settingsRequestWithTimeout(window.workbench.createHook({
        cwd: cwdInput.value.trim(),
        event: eventButton.dataset.value,
        matcher: panel.querySelector("#settings-hook-matcher").value.trim(),
        command,
        statusMessage: panel.querySelector("#settings-hook-status").value.trim(),
        timeout: panel.querySelector("#settings-hook-timeout").value,
      }), "保存 Hook 超时，请确认 Codex Core 已就绪");
      commandInput.value = "";
      await refreshSettingsHooksManager(panel);
    } catch (saveError) {
      error.hidden = false;
      error.textContent = saveError.message;
    } finally {
      button.disabled = false;
      button.textContent = "保存 Hook";
    }
  });
  return panel;
}

async function refreshSettingsHooksManager(panel) {
  if (!panel?.isConnected) return;
  const heading = panel.querySelector("#settings-hooks-heading");
  const root = panel.querySelector("#settings-hooks-root");
  const count = panel.querySelector("#settings-hooks-count");
  const list = panel.querySelector("#settings-hooks-list");
  const runs = panel.querySelector("#settings-hooks-runs");
  const errors = panel.querySelector("#settings-hooks-error");
  heading.textContent = "正在读取 Hooks…";
  root.textContent = cwdInput.value.trim() || "当前任务工作区";
  list.replaceChildren();
  runs.replaceChildren();
  errors.hidden = true;
  try {
    const result = await settingsRequestWithTimeout(
      window.workbench.listLocalHooks(cwdInput.value.trim()),
      "读取项目 Hooks 超时，请稍后重试",
    );
    if (!panel.isConnected) return;
    const entries = result.entries || [];
    const hooks = entries.flatMap((entry) => entry.hooks || []);
    const allErrors = entries.flatMap((entry) => [
      ...(entry.errors || []).map((item) => `${item.path}: ${item.message}`),
      ...(entry.warnings || []),
    ]);
    heading.textContent = hooks.length ? `${hooks.length} 个 Hook 已载入` : "当前项目没有 Hooks";
    count.textContent = String(hooks.length);
    if (allErrors.length) {
      errors.hidden = false;
      errors.textContent = allErrors.join("\n");
    }
    if (!hooks.length) list.innerHTML = '<span class="control-empty">创建第一个 Hook，或在项目中添加 .codex/hooks.json。</span>';
    for (const hook of hooks) {
      const card = controlCard(
        `${hook.eventName} · ${hook.handlerType}`,
        hook.trustStatus,
        hook.command || hook.statusMessage || "",
        `${hook.matcher || "*"} · ${hook.sourcePath}`,
      );
      list.append(card);
    }
    const recentRuns = result.runs || [];
    if (!recentRuns.length) runs.innerHTML = '<span class="control-empty">还没有 Hook 运行记录。</span>';
    for (const run of recentRuns.slice(0, 20)) {
      const row = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      title.textContent = `${run.eventName} · ${run.status}`;
      detail.textContent = `${run.durationMs ?? "…"} ms · ${new Date(run.startedAt || Date.now()).toLocaleString()}`;
      row.append(title, detail);
      runs.append(row);
    }
  } catch (loadError) {
    if (!panel.isConnected) return;
    heading.textContent = "Hooks 暂时不可用";
    errors.hidden = false;
    errors.textContent = loadError.message;
    list.innerHTML = '<span class="control-empty">页面仍可切换；点击刷新可重新连接。</span>';
    runs.innerHTML = '<span class="control-empty">尚未读取运行记录。</span>';
  }
}

async function showSettingsHooksManager(definition) {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (!$('[data-settings-route="hooks"]')?.classList.contains("active")) return false;
  restoreSettingsLivePanel();
  $("#settings-live-kicker").textContent = definition.kicker;
  $("#settings-live-title").textContent = definition.title;
  $("#settings-live-copy").textContent = definition.copy;
  const panel = createSettingsHooksManager();
  settingsLiveHost.append(panel);
  activeSettingsLivePanel = panel;
  void refreshSettingsHooksManager(panel);
  return true;
}

function createSettingsGitManager() {
  const panel = document.createElement("section");
  panel.className = "settings-git-manager";
  panel.innerHTML = `
    <header>
      <div><span>REPOSITORY STATUS</span><strong id="settings-git-heading">正在读取当前工作区…</strong><small id="settings-git-root"></small></div>
      <button id="settings-git-refresh" type="button">刷新</button>
    </header>
    <div id="settings-git-summary" class="settings-git-summary" aria-live="polite"></div>
    <div id="settings-git-files" class="settings-git-files"></div>
    <footer>
      <button id="settings-git-choose" type="button">选择 Git 项目</button>
      <button id="settings-git-init" type="button">初始化仓库</button>
      <button id="settings-git-open" class="primary" type="button">打开完整 Git 变更</button>
    </footer>
  `;
  panel.querySelector("#settings-git-refresh").addEventListener("click", () => void refreshSettingsGitManager(panel));
  panel.querySelector("#settings-git-choose").addEventListener("click", () => {
    closeSettingsCenter();
    $("#project-add").click();
  });
  panel.querySelector("#settings-git-open").addEventListener("click", () => {
    closeSettingsCenter();
    void selectToolView("changes");
  });
  panel.querySelector("#settings-git-init").addEventListener("click", async () => {
    const cwd = cwdInput.value.trim();
    if (!cwd) return;
    if (!await confirmAction(`${cwd}\n\n这会创建 .git 文件夹，不会提交或上传任何文件。`, {
      title: "初始化 Git 仓库？",
      confirmLabel: "初始化仓库",
      tone: "warning",
    })) return;
    const button = panel.querySelector("#settings-git-init");
    button.disabled = true;
    button.textContent = "正在初始化…";
    try {
      await window.workbench.initGitRepository(cwd);
      await refreshSettingsGitManager(panel);
    } catch (error) {
      panel.querySelector("#settings-git-heading").textContent = "无法初始化 Git 仓库";
      panel.querySelector("#settings-git-root").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "初始化仓库";
    }
  });
  return panel;
}

async function refreshSettingsGitManager(panel) {
  if (!panel?.isConnected) return;
  const heading = panel.querySelector("#settings-git-heading");
  const root = panel.querySelector("#settings-git-root");
  const summary = panel.querySelector("#settings-git-summary");
  const files = panel.querySelector("#settings-git-files");
  const init = panel.querySelector("#settings-git-init");
  heading.textContent = "正在读取当前工作区…";
  root.textContent = cwdInput.value.trim() || "尚未选择工作目录";
  summary.replaceChildren();
  files.replaceChildren();
  try {
    const state = await window.workbench.getGitState(cwdInput.value.trim());
    if (!panel.isConnected) return;
    heading.textContent = state.branch || "detached";
    root.textContent = state.root;
    init.hidden = true;
    const metrics = [
      ["工作区文件", String(state.files?.length || 0)],
      ["上游分支", state.upstream || "尚未设置"],
      ["远程仓库", state.remotes?.join(", ") || "尚未设置"],
    ];
    for (const [label, value] of metrics) {
      const item = document.createElement("div");
      const key = document.createElement("span");
      const copy = document.createElement("strong");
      key.textContent = label;
      copy.textContent = value;
      item.append(key, copy);
      summary.append(item);
    }
    if (!state.files?.length) {
      files.innerHTML = '<span class="control-empty">工作区干净，没有未提交变更。</span>';
      return;
    }
    for (const file of state.files.slice(0, 16)) {
      const row = document.createElement("div");
      const status = document.createElement("span");
      const path = document.createElement("strong");
      status.textContent = file.code || (file.untracked ? "??" : "M");
      path.textContent = file.path;
      row.append(status, path);
      files.append(row);
    }
    if (state.files.length > 16) {
      const more = document.createElement("small");
      more.textContent = `还有 ${state.files.length - 16} 个文件，请打开完整 Git 变更查看。`;
      files.append(more);
    }
  } catch (error) {
    if (!panel.isConnected) return;
    const message = String(error?.message || error || "");
    const notRepository = /not a git repository|rev-parse.+show-toplevel/i.test(message);
    heading.textContent = notRepository ? "当前工作区不是 Git 项目" : "暂时无法读取 Git 状态";
    root.textContent = notRepository
      ? "可以选择现有 Git 项目，或在当前目录初始化仓库。"
      : "请确认当前工作目录和 Git 环境可用。";
    init.hidden = !notRepository;
    const empty = document.createElement("span");
    empty.className = "control-empty";
    empty.textContent = notRepository ? "初始化只会创建 .git 文件夹，不会提交或上传文件。" : "稍后可以点击刷新重试。";
    files.append(empty);
  }
}

async function showSettingsGitManager(definition) {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (!$('[data-settings-route="git"]')?.classList.contains("active")) return false;
  restoreSettingsLivePanel();
  $("#settings-live-kicker").textContent = definition.kicker;
  $("#settings-live-title").textContent = definition.title;
  $("#settings-live-copy").textContent = definition.copy;
  const panel = createSettingsGitManager();
  settingsLiveHost.append(panel);
  activeSettingsLivePanel = panel;
  await refreshSettingsGitManager(panel);
  return true;
}

async function showSettingsLiveUtility(route) {
  const definition = SETTINGS_LIVE_UTILITIES[route];
  if (!definition) return false;
  if (definition.mode === "manager") return showSettingsGitManager(definition);
  restoreSettingsLivePanel();
  const panel = $(`.utility-view[data-view="${definition.view}"]`);
  if (!panel) return false;
  $("#settings-live-kicker").textContent = definition.kicker;
  $("#settings-live-title").textContent = definition.title;
  $("#settings-live-copy").textContent = definition.copy;
  activeSettingsLivePanelOrigin = panel.parentElement;
  activeSettingsLiveUtilityView = definition.view;
  panel.classList.add("active");
  settingsLiveHost.append(panel);
  activeSettingsLivePanel = panel;
  if (definition.view === "extensions") {
    $('[data-extension-view="plugins"]')?.click();
    await refreshExtensions();
  }
  return true;
}

function closeSettingsCenter() {
  restoreSettingsLivePanel();
  settingsCenter.hidden = true;
  appShell.removeAttribute("aria-hidden");
}

function openSettingsCenter(route = "general") {
  settingsCenter.hidden = false;
  appShell.setAttribute("aria-hidden", "true");
  showSettingsRoute(route);
  void Promise.all([refreshPolicy(), refreshPreferences()]);
}

function showSettingsRoute(route) {
  restoreSettingsLivePanel();
  for (const button of $$("[data-settings-route]")) button.classList.toggle("active", button.dataset.settingsRoute === route);
  const isGeneral = route === "general";
  const isProfile = route === "profile" || route === "usage";
  const isRuntime = route === "configuration";
  const functionalPages = new Map([
    ["appearance", settingsAppearancePage],
    ["voice", settingsVoicePage],
    ["personalization", settingsPersonalizationPage],
    ["pet", settingsPetPage],
    ["shortcuts", settingsShortcutsPage],
    ["browser", settingsBrowserPage],
  ]);
  const functionalPage = functionalPages.get(route) || null;
  const liveControl = SETTINGS_LIVE_CONTROLS[route] || null;
  const liveUtility = SETTINGS_LIVE_UTILITIES[route] || null;
  settingsGeneralPage.hidden = !isGeneral;
  settingsProfilePage.hidden = !isProfile;
  settingsRuntimePage.hidden = !isRuntime;
  for (const page of functionalPages.values()) page.hidden = page !== functionalPage;
  settingsLivePage.hidden = !liveControl && !liveUtility;
  settingsFeaturePage.hidden = isGeneral || isProfile || isRuntime || Boolean(functionalPage) || Boolean(liveControl) || Boolean(liveUtility);
  if (isGeneral) return;
  if (isProfile) {
    setUsageProfileView("profile");
    void refreshLocalUsageProfile().catch((error) => {
      $("#usage-profile-handle").textContent = `无法读取本机用量：${error.message}`;
    });
    return;
  }
  if (isRuntime) {
    runtimeSettingsPanel.open = true;
    return;
  }
  if (functionalPage) {
    if (route === "voice") void refreshLiveAvailability();
    if (route === "personalization") void refreshSettingsMemory();
    if (route === "pet") void refreshSettingsPet();
    if (route === "shortcuts") renderSettingsShortcuts($("#settings-shortcuts-search").value);
    return;
  }
  if (liveControl) {
    void showSettingsLiveControl(route);
    return;
  }
  if (liveUtility) {
    void showSettingsLiveUtility(route);
    return;
  }
  const feature = SETTINGS_FEATURES[route];
  if (!feature) return showSettingsRoute("general");
  $("#settings-feature-title").textContent = feature.title;
  $("#settings-feature-copy").textContent = feature.copy;
  $("#settings-feature-icon").textContent = feature.title.slice(0, 2);
  $("#settings-feature-card-title").textContent = feature.cardTitle;
  $("#settings-feature-card-copy").textContent = feature.cardCopy;
  const action = $("#settings-feature-action");
  action.hidden = !feature.action;
  action.textContent = feature.action || "";
  action.onclick = feature.run ? async () => {
    if (!feature.preserveSettings) closeSettingsCenter();
    await feature.run();
  } : null;
}

function renderHooks(result) {
  const list = $("#hook-list");
  const errors = $("#hook-errors");
  list.replaceChildren();
  const entries = result.entries || [];
  const allErrors = entries.flatMap((entry) => [...(entry.errors || []).map((item) => `${item.path}: ${item.message}`), ...(entry.warnings || [])]);
  errors.hidden = !allErrors.length;
  errors.textContent = allErrors.join("\n");
  const hooks = entries.flatMap((entry) => entry.hooks || []);
  if (!hooks.length) list.innerHTML = '<span class="control-empty">当前项目没有发现 Hooks。</span>';
  for (const hook of hooks) list.append(controlCard(`${hook.eventName} · ${hook.handlerType}`, hook.trustStatus, hook.command || hook.statusMessage || "", `${hook.source} · ${hook.matcher || "*"} · ${hook.sourcePath}`));
  const runs = $("#hook-runs");
  runs.replaceChildren();
  for (const run of result.runs || []) {
    const row = document.createElement("div");
    row.className = "audit-row";
    const time = document.createElement("time");
    time.textContent = new Date(run.startedAt || Date.now()).toLocaleTimeString();
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${run.eventName} · ${run.status}`;
    const detail = document.createElement("span");
    detail.textContent = `${run.durationMs ?? "…"} ms · ${(run.entries || []).map((item) => item.text).join(" · ") || run.sourcePath}`;
    copy.append(title, detail); row.append(time, copy); runs.append(row);
  }
  if (!(result.runs || []).length) runs.innerHTML = '<span class="control-empty">还没有 Hook 运行记录。</span>';
}

async function refreshHooks() {
  try { renderHooks(await window.workbench.listHooks(cwdInput.value.trim())); }
  catch (error) { $("#hook-errors").hidden = false; $("#hook-errors").textContent = error.message; }
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value ? `${value} B` : "—";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderProjectFiles(result) {
  currentFilePath = result.path || "";
  currentFileParent = result.parent;
  $("#files-root-name").textContent = String(result.root || "Workspace").split("/").filter(Boolean).pop() || "Workspace";
  $("#files-current-path").textContent = currentFilePath ? `/${currentFilePath}` : "/";
  $("#files-back").disabled = result.parent === null || result.parent === undefined;
  const list = $("#project-file-list"); list.replaceChildren();
  if (!(result.entries || []).length) list.innerHTML = '<span class="file-empty">这里没有可显示的文件。</span>';
  for (const item of result.entries || []) {
    const row = document.createElement("button"); row.type = "button"; row.className = `project-file-row ${item.kind}`;
    const name = document.createElement("strong"); name.textContent = item.path || item.name; name.title = item.path;
    const size = document.createElement("span"); size.textContent = item.kind === "directory" ? "文件夹" : formatFileSize(item.size);
    row.append(name, size);
    row.addEventListener("click", async () => {
      if (item.kind === "directory") { currentFilePath = item.path; await refreshProjectFiles(); return; }
      try { await selectToolView("browser"); await openWorkspacePreview(item.path); }
      catch (error) { addEvent("error", "FILE OPEN", error.message); }
    });
    list.append(row);
  }
}

async function refreshProjectFiles() {
  const epoch = workspaceStateEpoch;
  const cwd = cwdInput.value.trim();
  const search = $("#files-search").value.trim();
  try {
    const result = search ? await window.workbench.searchProjectFiles(cwd, search) : await window.workbench.listProjectFiles(cwd, currentFilePath);
    if (epoch !== workspaceStateEpoch || cwd !== cwdInput.value.trim()) return;
    if (search) {
      const previousPath = currentFilePath; const previousParent = currentFileParent;
      renderProjectFiles({ ...result, path: `搜索：${search}`, parent: null });
      currentFilePath = previousPath; currentFileParent = previousParent;
    } else renderProjectFiles(result);
  } catch (error) {
    if (epoch === workspaceStateEpoch) $("#project-file-list").innerHTML = `<span class="file-empty">${escapeHtml(error.message)}</span>`;
  }
}

function scheduleLabel(schedule) {
  if (schedule.kind === "interval") return `每 ${schedule.intervalMinutes} 分钟`;
  if (schedule.kind === "daily") return `每天 ${schedule.time}`;
  if (schedule.kind === "rrule") return `RRULE · ${schedule.rule}`;
  return `每周${["日", "一", "二", "三", "四", "五", "六"][schedule.day]} ${schedule.time}`;
}

function updateNotificationBadge(unread = 0) {
  const count = $("#scheduled-nav-count");
  count.hidden = unread < 1;
  count.textContent = unread > 99 ? "99+" : String(unread);
}

function refreshScheduledProjectOptions() {
  const select = $("#scheduled-project");
  const previous = select.value;
  const entries = new Map();
  const remember = (projectPath, name) => {
    const value = String(projectPath || "").trim();
    if (!value || entries.has(value)) return;
    entries.set(value, name || value.split("/").filter(Boolean).at(-1) || "项目");
  };
  remember(cwdInput.value);
  for (const project of loadedProjects) if (!project.hidden) remember(project.path, project.name);
  select.replaceChildren();
  if (!entries.size) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "请先添加或选择项目";
    select.append(option);
    return;
  }
  for (const [value, name] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = name;
    select.append(option);
  }
  select.value = entries.has(previous) ? previous : (entries.has(cwdInput.value.trim()) ? cwdInput.value.trim() : entries.keys().next().value);
}

function scheduledRuntimeLabel(task) {
  const runtime = task.runtime || {};
  const items = [];
  if (runtime.model) items.push(runtime.model);
  if (runtime.reasoningEffort) items.push(runtime.reasoningEffort);
  if (runtime.permission && runtime.permission !== "inherit") items.push(runtime.permission);
  return items.length ? ` · ${items.join(" · ")}` : "";
}

function renderScheduler(state) {
  schedulerState = state || { tasks: [], runs: [], unread: 0 };
  const threadOption = $("#scheduled-destination option[value=thread]");
  threadOption.disabled = !currentThreadId;
  threadOption.textContent = currentThreadId ? `续跑当前任务 · ${currentThreadId.slice(0, 8)}` : "续跑当前任务 · 尚无任务";
  if (!currentThreadId && $("#scheduled-destination").value === "thread") $("#scheduled-destination").value = "standalone";
  updateNotificationBadge(schedulerState.unread || 0);
  $("#scheduled-unread-count").textContent = String(schedulerState.unread || 0);
  const tasks = $("#scheduled-task-list");
  tasks.replaceChildren();
  const active = schedulerState.tasks.filter((task) => task.enabled).length;
  $("#scheduled-count").textContent = `${schedulerState.tasks.length} 个计划 · ${active} 个启用`;
  if (!schedulerState.tasks.length) {
    tasks.innerHTML = '<div class="scheduled-empty"><strong>还没有计划任务</strong><span>创建一个计划，或直接在对话中说“每天 9 点检查项目”。</span></div>';
  }
  for (const task of schedulerState.tasks) {
    const destination = task.destination?.mode === "thread" ? `续跑 ${task.destination.threadId?.slice(0, 8)}` : "独立后台任务";
    const execution = task.execution?.mode === "worktree" ? "Git Worktree" : "当前项目";
    const card = document.createElement("article");
    card.className = `scheduled-task ${task.enabled ? "active" : "paused"}`;
    const rail = document.createElement("i");
    const copy = document.createElement("div");
    copy.className = "scheduled-task-copy";
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = task.name;
    const status = document.createElement("span");
    status.textContent = task.enabled ? "已启用" : "已暂停";
    header.append(title, status);
    const prompt = document.createElement("p");
    prompt.textContent = task.prompt;
    const meta = document.createElement("small");
    meta.textContent = `${scheduleLabel(task.schedule)} · ${destination} · ${execution}${scheduledRuntimeLabel(task)} · ${task.nextRunAt ? `下次 ${new Date(task.nextRunAt).toLocaleString()}` : "没有下次运行"}`;
    copy.append(header, prompt, meta);
    const actions = document.createElement("div");
    actions.className = "scheduled-task-actions";
    const run = document.createElement("button");
    run.type = "button";
    run.textContent = "立即运行";
    run.addEventListener("click", async () => { run.disabled = true; try { renderScheduler(await window.workbench.runScheduledTask(task.id)); } catch (error) { addEvent("error", "SCHEDULED", error.message); } finally { run.disabled = false; } });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = task.enabled ? "暂停" : "恢复";
    toggle.addEventListener("click", async () => renderScheduler(await window.workbench.updateScheduledTask(task.id, { enabled: !task.enabled })));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-outline";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      if (!await confirmAction(`删除计划任务“${task.name}”？\n\n已经产生的运行记录仍会保留。`, {
        title: "删除计划任务？",
        confirmLabel: "删除任务",
        tone: "danger",
      })) return;
      renderScheduler(await window.workbench.deleteScheduledTask(task.id));
    });
    actions.append(run, toggle, remove);
    card.append(rail, copy, actions);
    tasks.append(card);
  }

  const runsSection = $("#scheduled-runs-section");
  runsSection.hidden = schedulerState.runs.length === 0;
  $("#scheduled-mark-read").hidden = schedulerState.unread < 1;
  const runs = $("#scheduled-run-list");
  runs.replaceChildren();
  for (const item of schedulerState.runs.slice(0, 50)) {
    const row = document.createElement("article");
    row.className = `scheduled-run ${item.status}${item.read ? "" : " unread"}`;
    const body = document.createElement("div");
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = `${item.taskName} · ${item.status === "completed" ? "已完成" : item.status === "failed" ? "失败" : "运行中"}`;
    const time = document.createElement("time");
    time.textContent = new Date(item.completedAt || item.startedAt).toLocaleString();
    header.append(title, time);
    const copy = document.createElement("p");
    copy.textContent = item.error || item.summary || (item.status === "running" ? "任务正在后台执行…" : "没有摘要");
    body.append(header, copy);
    row.append(body);
    row.addEventListener("click", async () => {
      if (!item.read) renderScheduler(await window.workbench.markScheduledNotificationsRead(item.id));
    });
    runs.append(row);
  }
}

async function refreshScheduler() {
  try {
    refreshScheduledProjectOptions();
    renderScheduler(await window.workbench.listScheduledTasks());
  } catch (error) {
    $("#scheduled-task-list").innerHTML = `<div class="scheduled-empty"><strong>计划任务暂时无法载入</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderDiagnostics(state) {
  const labels = { appServer: "Agent Runtime", sessionRuntime: "Session / Turn Runtime", modelGateway: "Model Gateway", browser: "Embedded Browser", computerUse: "Computer Use", scheduler: "Scheduler", terminal: "Terminal" };
  $("#diagnostic-status").textContent = state.ready ? "所有核心服务正常" : state.status === "recovering" ? "正在自动恢复" : state.status === "starting" ? "正在启动运行时" : "运行时需要处理";
  $("#diagnostic-version").textContent = `${state.version || "Codex version unknown"} · OnPeople ${state.appVersion || ""}`;
  $("#diagnostic-retry").textContent = state.restartAt ? `RETRY ${new Date(state.restartAt).toLocaleTimeString()}` : "NO RETRY";
  const components = $("#diagnostic-components"); components.replaceChildren();
  for (const [key, item] of Object.entries(state.components || {})) {
    const card = document.createElement("article"); card.className = `diagnostic-component ${item.status}`;
    const dot = document.createElement("i"); const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = `${labels[key] || key} · ${item.status}`;
    const detail = document.createElement("small"); detail.textContent = item.url || item.binary || item.message || (item.sessions !== undefined ? `${item.sessions} sessions · ${item.activeItems || 0} active items` : item.activeRuns !== undefined ? `${item.activeRuns} active runs` : "ready");
    copy.append(title, detail); card.append(dot, copy); components.append(card);
  }
  const events = $("#diagnostic-events"); events.replaceChildren();
  if (!(state.events || []).length) events.innerHTML = '<span class="control-empty">尚无诊断事件。</span>';
  for (const item of (state.events || []).slice(0, 80)) {
    const row = document.createElement("article"); row.className = `diagnostic-event ${item.level}`;
    const time = document.createElement("time"); time.textContent = new Date(item.at).toLocaleTimeString();
    const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = item.title; const detail = document.createElement("span"); detail.textContent = item.detail || item.level;
    copy.append(title, detail); row.append(time, copy); events.append(row);
  }
}

async function refreshDiagnostics() {
  try { renderDiagnostics(await window.workbench.getRuntimeDiagnostics()); }
  catch (error) { $("#diagnostic-status").textContent = error.message; }
}

async function refreshControl() {
  if (activeControlView === "agents") await refreshAgents();
  else if (activeControlView === "worktrees") await refreshWorktrees();
  else if (activeControlView === "context") await refreshContext();
  else if (activeControlView === "policy") await refreshPolicy();
  else if (activeControlView === "hooks") await refreshHooks();
  else if (activeControlView === "diagnostics") await refreshDiagnostics();
  else if (activeControlView === "config") await refreshEffectiveConfig();
  else if (activeControlView === "memory") await refreshMemories();
  else if (activeControlView === "usage") await refreshUsage();
  else if (activeControlView === "secrets") await refreshSecrets();
}

modelSourceSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("[data-model-source]");
  if (button) void selectModelSource(button.dataset.modelSource);
});
modelSourceAccount.addEventListener("click", () => {
  if (!cloudAccountDialog.open) cloudAccountDialog.showModal();
  void refreshCloudAccount().catch(() => {});
});
providerSelect.addEventListener("change", () => {
  const source = modelSourceForProvider(providerSelect.value);
  if (source !== "onpeople") lastProviderBySource[source] = providerSelect.value;
  void selectProviderType(providerSelect.value);
});
modelInput.addEventListener("change", validateSelectedModel);
onpeopleModelSelect.addEventListener("change", () => {
  modelInput.value = onpeopleModelSelect.value;
  syncTaskModelPicker();
  void validateSelectedModel();
});
taskModelTrigger.addEventListener("click", () => setTaskModelPopover(taskModelPopover.hidden));
taskModelOptions.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-model-id]");
  if (!button) return;
  modelInput.value = button.dataset.modelId;
  onpeopleModelSelect.value = button.dataset.modelId;
  window.OnPeopleUI?.syncSelect?.(onpeopleModelSelect);
  syncTaskModelPicker();
  setTaskModelPopover(false);
  void validateSelectedModel();
  try {
    await persistTaskModelSelection();
  } catch (error) {
    providerStatus.textContent = cloudErrorMessage(error);
    addEvent("error", "MODEL", cloudErrorMessage(error));
  }
});
taskEffortOptions.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-reasoning-effort]");
  if (!button) return;
  selectedReasoningEffort = button.dataset.reasoningEffort;
  syncTaskModelPicker();
  setTaskModelPopover(false);
  if (!currentThreadId) return;
  try {
    await window.workbench.setThreadReasoningEffort(
      currentThreadId,
      selectedReasoningEffort,
      modelInput.value.trim(),
    );
  } catch (error) {
    addEvent("error", "REASONING", error.message);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (taskModelPopover.hidden) return;
  if (taskModelPopover.contains(event.target) || taskModelTrigger.contains(event.target)) return;
  setTaskModelPopover(false);
}, true);
window.addEventListener("resize", () => setTaskModelPopover(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !taskModelPopover.hidden) setTaskModelPopover(false);
});

$("#cloud-account-open").addEventListener("click", () => {
  if (cloudAccountState.signedIn) void openUsageProfile();
  else openCloudAccountManagement("login");
});
timeline.addEventListener("click", (event) => {
  const accountAction = event.target.closest("#welcome-account-login, #welcome-account-register");
  if (!accountAction) return;
  openCloudAccountManagement(accountAction.id === "welcome-account-register" ? "register" : "login");
});
$("#settings-close").addEventListener("click", closeSettingsCenter);
$("#settings-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-settings-route]");
  if (button) showSettingsRoute(button.dataset.settingsRoute);
});
$("#settings-search").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLocaleLowerCase();
  for (const button of $$("[data-settings-route]")) {
    button.hidden = Boolean(query) && !button.textContent.toLocaleLowerCase().includes(query);
  }
});
$("#settings-file-opener").addEventListener("change", (event) => {
  void savePreferences({ defaultFileOpener: event.target.value });
});
$("#settings-theme").addEventListener("change", (event) => {
  void savePreferences({ theme: event.target.value });
});
$("#settings-density").addEventListener("change", (event) => {
  void savePreferences({ density: event.target.value });
});
$("#settings-browser-links").addEventListener("change", (event) => {
  void savePreferences({ browserOpenLinks: event.target.value });
});
$("#settings-live-voice").addEventListener("change", (event) => {
  void savePreferences({ liveVoice: event.target.value });
});
$("#settings-live-refresh").addEventListener("click", () => {
  void refreshLiveAvailability();
});
for (const button of $$("[data-settings-toggle]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.settingsToggle;
    void savePreferences({ [key]: button.getAttribute("aria-checked") !== "true" });
  });
}
$("#settings-personalization-save").addEventListener("click", async () => {
  const button = $("#settings-personalization-save");
  const status = $("#settings-personalization-status");
  button.disabled = true;
  status.textContent = "正在保存…";
  try {
    await savePreferences({ customInstructions: $("#settings-custom-instructions").value });
    status.textContent = "已保存，将用于之后创建的任务";
  } finally {
    button.disabled = false;
  }
});
$("#settings-memory-enabled").addEventListener("click", async () => {
  const button = $("#settings-memory-enabled");
  button.disabled = true;
  try {
    await window.workbench.saveMemorySettings({ enabled: button.getAttribute("aria-checked") !== "true" });
    await refreshSettingsMemory();
  } catch (error) {
    addEvent("error", "MEMORY SETTINGS", error.message);
  } finally {
    button.disabled = false;
  }
});
$("#settings-memory-generate").addEventListener("click", async () => {
  const button = $("#settings-memory-generate");
  button.disabled = true;
  try {
    await window.workbench.saveMemorySettings({ generate: button.getAttribute("aria-checked") !== "true" });
    await refreshSettingsMemory();
  } catch (error) {
    addEvent("error", "MEMORY SETTINGS", error.message);
  } finally {
    button.disabled = false;
  }
});
$("#settings-memory-manage").addEventListener("click", () => {
  closeSettingsCenter();
  void selectControlPanel("memory");
});
$("#settings-pet-visible").addEventListener("click", async () => {
  const button = $("#settings-pet-visible");
  button.disabled = true;
  try {
    await window.workbench.togglePet();
    await refreshSettingsPet();
  } catch (error) {
    addEvent("error", "PET SETTINGS", error.message);
  } finally {
    button.disabled = false;
  }
});
$("#settings-pet-skin").addEventListener("change", async (event) => {
  try {
    await window.workbench.selectPetSkin(event.target.value);
    await refreshSettingsPet();
  } catch (error) {
    addEvent("error", "PET SETTINGS", error.message);
  }
});
$("#settings-pet-import").addEventListener("click", async () => {
  const button = $("#settings-pet-import");
  button.disabled = true;
  try {
    await window.workbench.importPetSkin();
    await refreshSettingsPet();
  } catch (error) {
    addEvent("error", "PET SETTINGS", error.message);
  } finally {
    button.disabled = false;
  }
});
$("#settings-pet-open").addEventListener("click", async () => {
  try {
    const state = await window.workbench.getPetState();
    if (!state.visible) await window.workbench.togglePet();
    await refreshSettingsPet();
  } catch (error) {
    addEvent("error", "PET SETTINGS", error.message);
  }
});
$("#settings-shortcuts-search").addEventListener("input", (event) => {
  renderSettingsShortcuts(event.target.value);
});
$("#settings-download-pick").addEventListener("click", async () => {
  const button = $("#settings-download-pick");
  button.disabled = true;
  try {
    renderPreferences(await window.workbench.pickDownloadDirectory());
  } catch (error) {
    addEvent("error", "DOWNLOAD SETTINGS", error.message);
  } finally {
    button.disabled = false;
  }
});
$("#settings-browser-clear").addEventListener("click", async () => {
  if (!await confirmAction("清除 OnPeople 内嵌浏览器的 Cookie、缓存和站点数据？\n\n这会退出已登录的网站，但不会影响系统浏览器。", {
    title: "清理浏览器数据？",
    confirmLabel: "清理数据",
    tone: "danger",
  })) return;
  const button = $("#settings-browser-clear");
  const label = button.querySelector("em");
  button.disabled = true;
  label.textContent = "清理中…";
  try {
    await window.workbench.clearBrowserDataFromSettings();
    label.textContent = "已清理";
    window.setTimeout(() => { label.textContent = "清理"; }, 1_500);
  } catch (error) {
    label.textContent = "重试";
    addEvent("error", "BROWSER SETTINGS", error.message);
  } finally {
    button.disabled = false;
  }
});
for (const button of $$("[data-settings-permission]")) {
  button.addEventListener("click", () => {
    const select = $("#permission-preset");
    select.value = button.dataset.settingsPermission;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
$("#cloud-account-close").addEventListener("click", closeCloudAccountManagement);
cloudAccountDialog.addEventListener("click", (event) => {
  if (event.target === cloudAccountDialog) closeCloudAccountManagement();
});
cloudAccountDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCloudAccountManagement();
});
$("#usage-profile-close").addEventListener("click", () => usageProfileDialog.close());
usageProfileDialog.addEventListener("click", (event) => {
  if (event.target === usageProfileDialog) usageProfileDialog.close();
});
for (const button of $$("[data-usage-profile-view]")) {
  button.addEventListener("click", () => setUsageProfileView(button.dataset.usageProfileView));
}
$("#usage-profile-account").addEventListener("click", openCloudAccountManagement);
$("#usage-profile-refresh").addEventListener("click", async () => {
  const button = $("#usage-profile-refresh");
  button.disabled = true;
  button.textContent = "同步中…";
  try {
    await Promise.all([refreshLocalUsageProfile(), cloudAccountState.signedIn ? refreshCloudUsageProfile() : Promise.resolve()]);
  } finally {
    button.disabled = false;
    button.textContent = "刷新数据";
  }
});
for (const button of $$("[data-leaderboard-period]")) {
  button.addEventListener("click", () => {
    activeLeaderboardPeriod = button.dataset.leaderboardPeriod;
    for (const option of $$("[data-leaderboard-period]")) option.classList.toggle("active", option === button);
    void refreshCloudUsageProfile();
  });
}
async function saveLeaderboardPreference() {
  if (!cloudAccountState.signedIn) {
    $("#leaderboard-participating").checked = false;
    $("#leaderboard-status").textContent = "请先登录 OnPeople，再参与排行榜。";
    return;
  }
  const participating = $("#leaderboard-participating").checked;
  const displayName = $("#leaderboard-display-name").value.trim();
  $("#leaderboard-status").textContent = "正在保存排行榜隐私设置…";
  try {
    await window.workbench.saveCloudLeaderboardPreference({ participating, displayName });
    await refreshCloudUsageProfile();
  } catch (error) {
    $("#leaderboard-status").textContent = cloudErrorMessage(error);
    $("#leaderboard-participating").checked = Boolean(cloudUsageProfile?.preference?.participating);
  }
}
$("#leaderboard-participating").addEventListener("change", () => void saveLeaderboardPreference());
$("#leaderboard-display-name").addEventListener("change", () => {
  if ($("#leaderboard-participating").checked) void saveLeaderboardPreference();
});
for (const button of $$("[data-cloud-auth-mode]")) {
  button.addEventListener("click", () => {
    setCloudAuthMode(button.dataset.cloudAuthMode, { focus: true });
    setCloudStatus(button.dataset.cloudAuthMode === "register"
      ? "填写邮箱、密码并验证邮箱即可注册。"
      : "输入 OnPeople 账号和密码登录。");
  });
}
$("#cloud-group-select").addEventListener("change", async (event) => {
  const select = event.currentTarget;
  const groupId = select.value;
  if (!groupId || !cloudAccountState.signedIn) return;
  select.disabled = true;
  setCloudStatus("正在切换默认模型分组…");
  try {
    const state = await window.workbench.selectCloudGroup(groupId);
    renderCloudAccount(state);
    setCloudStatus(`默认分组已切换到 ${state.account?.group?.name || "所选分组"}；其他分组模型仍可直接选择。`);
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), true);
    await refreshCloudGroups();
  } finally {
    select.disabled = !cloudAccountState.signedIn || !select.value;
  }
});
async function finishCloudSignIn(state) {
  renderCloudAccount(state);
  const continuePendingSelection = pendingCloudSourceSelection;
  if (continuePendingSelection) cloudAccountDialog.close();
  if (state.modelsLive && state.models?.length) {
    await selectModelSource("onpeople");
    await persistTaskModelSelection();
    providerStatus.textContent = currentThreadId
      ? "已登录 OnPeople，并应用到当前任务"
      : "已登录 OnPeople，并设为新任务默认";
  } else if (continuePendingSelection) {
    providerStatus.textContent = cloudModelsStatus(state).message;
  }
  if (state.modelsLive) {
    setCloudStatus(`登录成功，实时发现 ${state.models?.length || 0} 个模型。`);
  } else {
    const status = cloudModelsStatus(state);
    setCloudStatus(status.message, status.tone);
  }
}

$("#cloud-login").addEventListener("click", async () => {
  const button = $("#cloud-login");
  const email = $("#cloud-email").value.trim();
  const password = $("#cloud-password").value;
  button.disabled = true;
  setCloudStatus("正在登录 OnPeople…");
  try {
    const state = await window.workbench.loginCloudAccount({
      email,
      password,
      serviceUrl: $("#cloud-service-url").value.trim(),
    });
    await finishCloudSignIn(state);
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), true);
  } finally {
    button.disabled = false;
  }
});
$("#cloud-password").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    $("#cloud-login").click();
  }
});

$("#cloud-register-code").addEventListener("click", async () => {
  const button = $("#cloud-register-code");
  button.disabled = true;
  button.textContent = "发送中…";
  setCloudStatus("正在发送注册验证码…");
  try {
    const result = await window.workbench.sendCloudRegistrationCode({
      email: $("#cloud-email").value.trim(),
      serviceUrl: $("#cloud-service-url").value.trim(),
    });
    const countdown = Math.ceil(Number(result?.countdown) || 60);
    startCloudRegistrationCooldown(countdown);
    $("#cloud-code").focus();
    setCloudStatus(`验证码已发送，请检查邮箱。${countdown} 秒后可重新发送。`);
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), true);
    button.disabled = false;
    button.textContent = "发送验证码";
  }
});

$("#cloud-register-submit").addEventListener("click", async () => {
  const button = $("#cloud-register-submit");
  button.disabled = true;
  setCloudStatus("正在注册 OnPeople…");
  try {
    const state = await window.workbench.registerCloudAccount({
      email: $("#cloud-email").value.trim(),
      password: $("#cloud-password").value,
      verifyCode: $("#cloud-code").value.trim(),
    });
    await finishCloudSignIn(state);
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), true);
  } finally {
    button.disabled = false;
  }
});
$("#cloud-code").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    $("#cloud-register-submit").click();
  }
});

$("#cloud-account-refresh").addEventListener("click", () => void refreshCloudAccount().catch(() => {}));
$("#cloud-redeem-submit").addEventListener("click", async () => {
  const button = $("#cloud-redeem-submit");
  const code = $("#cloud-redeem-code").value.trim();
  button.disabled = true;
  setCloudStatus("正在兑换额度…");
  try {
    const result = await window.workbench.redeemCloudCode(code);
    renderCloudAccount(result.state);
    $("#cloud-redeem-code").value = "";
    setCloudStatus(result.redemption?.message || "兑换成功，余额已刷新。");
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), true);
  } finally {
    button.disabled = false;
  }
});
$("#cloud-account-logout").addEventListener("click", async () => {
  const button = $("#cloud-account-logout");
  button.disabled = true;
  try {
    renderCloudAccount(await window.workbench.logoutCloudAccount());
    pendingCloudSourceSelection = false;
    setCloudStatus("已退出登录，第三方 Router 配置未改变。");
    if (providerSelect.value === "onpeople") {
      providerStatus.textContent = "OnPeople 已退出；请切换 Router 或重新登录";
    }
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), true);
  } finally {
    button.disabled = false;
  }
});

$("#discover-models").addEventListener("click", async () => {
  const button = $("#discover-models");
  button.disabled = true;
  providerStatus.textContent = "正在发现模型…";
  try {
    const result = await window.workbench.discoverModels();
    modelOptions.replaceChildren(...result.models.map((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.label = `${model.name || model.id}${model.vision?.supported ? " · Vision" : " · Text"}`;
      return option;
    }));
    providerStatus.textContent = `发现 ${result.models.length} 个模型 · ${result.source}`;
    await validateSelectedModel();
  } catch (error) { providerStatus.textContent = error.message; }
  finally { button.disabled = false; }
});

$("#save-provider").addEventListener("click", async () => {
  const button = $("#save-provider");
  button.disabled = true;
  providerStatus.textContent = "正在保存…";
  try {
    const result = await window.workbench.saveProvider({ threadId: currentThreadId, type: providerSelect.value, model: modelInput.value.trim(), baseUrl: baseUrlInput.value.trim(), apiKey: apiKeyInput.value });
    renderProvider(result.settings);
    providerStatus.textContent = result.pending
      ? `当前轮结束后切换至 ${result.settings.model}`
      : (result.changed ? `当前任务已切换至 ${result.settings.model}` : "当前任务模型配置已保存");
  } catch (error) { providerStatus.textContent = error.message; }
  finally { updateProviderFields(); }
});

appUpdateAction.addEventListener("click", async () => {
  appUpdateAction.disabled = true;
  try {
    if (!appUpdateState?.supported) await window.workbench.openAppDownload();
    else if (appUpdateState.status === "available") await window.workbench.downloadAppUpdate();
    else if (appUpdateState.status === "downloaded") await window.workbench.installAppUpdate();
    else await window.workbench.checkForAppUpdate();
  } catch (error) {
    renderAppUpdate({ ...appUpdateState, status: "error", message: error.message });
  } finally {
    if (!["checking", "downloading", "installing"].includes(appUpdateState?.status)) appUpdateAction.disabled = false;
  }
});

function setCapabilityMenu(open) {
  capabilityMenu.hidden = !open;
  attachImageButton.setAttribute("aria-expanded", String(open));
  if (open) capabilityMenu.querySelector("button")?.focus();
}

attachImageButton.addEventListener("click", () => setCapabilityMenu(capabilityMenu.hidden));
capabilitySelection.addEventListener("click", () => { selectedCapability = null; renderSelectedCapability(); });

capabilityMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  setCapabilityMenu(false);
  const action = button.dataset.capabilityAction;
  if (action === "attachments") {
    try {
      const picked = await window.workbench.pickAttachments();
      const vision = selectedModelVision ?? PROVIDER_PRESETS[providerSelect.value].vision;
      const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
      for (const attachment of picked) {
        const extension = attachment.name.split(".").pop()?.toLowerCase();
        if (attachment.kind === "file" && vision && imageExtensions.has(extension)) selectedImages.push(attachment.path);
        else selectedAttachments.push(attachment);
      }
      selectedImages = [...new Set(selectedImages)].slice(0, 10);
      selectedAttachments = [...new Map(selectedAttachments.map((item) => [item.path, item])).values()].slice(0, 20);
      renderImages();
    } catch (error) { addEvent("error", "ATTACHMENT", error.message); }
    return;
  }
  if (action === "chrome") {
    profileImportDialog.showModal();
    void loadBrowserImportProfiles();
    return;
  }
  if (action === "goal" || action === "plan") {
    selectMode(action);
    promptInput.focus();
    return;
  }
  if (action === "apps") {
    await selectToolView("extensions");
    return;
  }
  if (button.dataset.capability) {
    selectedCapability = button.dataset.capability;
    renderSelectedCapability();
    selectMode("default");
    promptInput.placeholder = `${CAPABILITY_COPY[selectedCapability]}：描述要创建或完成的内容…`;
    promptInput.focus();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!capabilityMenu.hidden && !capabilityMenu.contains(event.target) && event.target !== attachImageButton) setCapabilityMenu(false);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !capabilityMenu.hidden) setCapabilityMenu(false); });

async function chooseComposerWorkspaceProject(mode = "local") {
  const initialPath = selectedWorkspaceBaseCwd || cwdInput.value.trim() || defaultWorkspaceCwd;
  const project = await window.workbench.pickProject(initialPath);
  if (!project?.path) return false;
  if (currentThreadId) {
    await startFreshTask({ workspaceMode: mode, workspaceBaseCwd: project.path, cwd: project.path });
    return true;
  }
  selectedWorkspaceMode = mode;
  selectedWorkspaceBaseCwd = project.path;
  cwdInput.value = project.path;
  updateProject(project.path);
  selectedProjectPath = project.path;
  await loadThreads();
  await refreshProjectActions();
  currentFilePath = "";
  if (activeToolView === "changes") await refreshGit();
  if (activeToolView === "files") await refreshProjectFiles();
  promptInput.focus();
  return true;
}

composerWorkspace.addEventListener("click", () => setWorkspaceMenu(composerWorkspaceMenu.hidden));
composerWorkspaceMenu.addEventListener("click", async (event) => {
  const recent = event.target.closest("[data-workspace-path]");
  if (recent) {
    const workspacePath = recent.dataset.workspacePath;
    if (currentThreadId) await startFreshTask({ workspaceMode: "local", workspaceBaseCwd: workspacePath, cwd: workspacePath });
    else {
      selectedWorkspaceMode = "local";
      selectedWorkspaceBaseCwd = workspacePath;
      cwdInput.value = workspacePath;
      updateProject(workspacePath);
      selectedProjectPath = workspacePath;
      await refreshProjectActions();
    }
    setWorkspaceMenu(false);
    promptInput.focus();
    return;
  }
  const option = event.target.closest("[data-workspace-mode]");
  if (!option) return;
  const mode = option.dataset.workspaceMode;
  if (mode === "isolated") {
    if (currentThreadId) {
      await startFreshTask({ workspaceMode: "isolated", workspaceBaseCwd: null, cwd: "" });
      setWorkspaceMenu(false);
      return;
    }
    selectedWorkspaceMode = "isolated";
    selectedWorkspaceBaseCwd = null;
    cwdInput.value = "";
    updateProject("");
    setWorkspaceMenu(false);
    promptInput.focus();
    return;
  }
  try {
    if (await chooseComposerWorkspaceProject(mode)) setWorkspaceMenu(false);
  } catch (error) {
    addEvent("error", "WORKSPACE", error.message);
  }
});
composerWorkspaceSearch.addEventListener("input", renderWorkspaceRecents);
composerWorkspaceSearch.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("pointerdown", (event) => {
  if (!composerWorkspaceMenu.hidden && !event.target.closest(".composer-workspace-picker")) setWorkspaceMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !composerWorkspaceMenu.hidden) setWorkspaceMenu(false);
});

$("#project-add").addEventListener("click", async () => {
  const button = $("#project-add");
  button.disabled = true;
  try {
    await chooseComposerWorkspaceProject("local");
  } catch (error) {
    addEvent("error", "PROJECT", error.message);
  } finally {
    button.disabled = false;
  }
});

promptInput.addEventListener("paste", async (event) => {
  const items = [...(event.clipboardData?.items || [])];
  const containsImage = items.some((item) => item.kind === "file" || item.type.startsWith("image/"));
  if (!containsImage) return;
  event.preventDefault();
  const preset = PROVIDER_PRESETS[providerSelect.value];
  const vision = selectedModelVision ?? preset.vision;
  if (!vision) {
    addEvent("error", "IMAGE", "当前模型不支持视觉输入，请切换到通过视觉能力校验的模型。");
    return;
  }
  if (selectedImages.length >= 10) {
    addEvent("error", "IMAGE", "每个任务最多添加 10 张图片。");
    return;
  }
  try {
    const pasted = await window.workbench.pasteImage();
    if (!pasted?.path) {
      addEvent("error", "IMAGE", "剪贴板中没有可读取的图片。");
      return;
    }
    selectedImages = [...new Set([...selectedImages, pasted.path])].slice(0, 10);
    if (pasted.previewDataUrl) imagePreviewUrls.set(pasted.path, pasted.previewDataUrl);
    renderImages();
  } catch (error) {
    addEvent("error", "IMAGE", error.message);
  }
});

$("#sidebar-toggle").addEventListener("click", () => appShell.classList.add("sidebar-collapsed"));
$("#sidebar-show").addEventListener("click", () => appShell.classList.remove("sidebar-collapsed"));
$("#utility-close").addEventListener("click", () => setUtilityVisible(false));
for (const button of $$("[data-tool-view]")) button.addEventListener("click", () => {
  if (button.dataset.toolView === "terminal" && terminalDockOpen) setTerminalVisible(false);
  else void selectToolView(button.dataset.toolView);
});

async function startFreshTask(options = {}) {
  const requested = options && !(options instanceof Event) ? options : {};
  try {
    closeScheduledCenter();
    if (running && currentThreadId) setThreadRuntimeState(currentThreadId, "working");
    await window.workbench.newTask();
    setRunning(false);
    setThreadHeader(null);
    selectedWorkspaceMode = requested.workspaceMode || "isolated";
    selectedWorkspaceBaseCwd = requested.workspaceBaseCwd || null;
    cwdInput.value = requested.cwd || "";
    updateProject(cwdInput.value);
    if (cwdInput.value) {
      selectedProjectPath = cwdInput.value;
      await refreshProjectActions();
    }
    setUtilityVisible(false);
    resetTimeline();
    renderGoal(null);
    renderProvider(await window.workbench.getProviderSettings(null, null));
    selectedImages = [];
    selectedAttachments = [];
    selectedCapability = null;
    imagePreviewUrls.clear();
    renderImages();
    renderSelectedCapability();
    await loadThreads();
    promptInput.focus();
  } catch (error) { addEvent("error", "NEW TASK", error.message); }
}

function closeQuickLauncher() {
  quickLauncher.hidden = true;
  quickLauncherToggle.setAttribute("aria-expanded", "false");
}

function quickRecommendation(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quick-launcher-row";
  const icon = document.createElement("span");
  icon.className = "quick-launcher-icon";
  icon.textContent = item.kind === "file" ? "▤" : "◎";
  const label = document.createElement("strong");
  label.textContent = item.label;
  button.append(icon, label);
  button.addEventListener("click", async () => {
    closeQuickLauncher();
    try {
      await selectToolView("browser");
      if (item.kind === "file") await openWorkspacePreview(item.path);
      else await window.workbench.navigate(item.url, activeBrowserRouteId);
    } catch (error) { addEvent("error", "QUICK OPEN", error.message); }
  });
  return button;
}

async function refreshQuickLauncher() {
  quickLauncherRecommendations.replaceChildren();
  const loading = document.createElement("span");
  loading.className = "quick-launcher-empty";
  loading.textContent = "正在读取当前项目…";
  quickLauncherRecommendations.append(loading);
  try {
    const suggestions = await window.workbench.getQuickLauncherSuggestions(cwdInput.value.trim(), activeBrowserRouteId);
    const items = [...(suggestions.files || []), ...(suggestions.urls || [])];
    quickLauncherRecommendations.replaceChildren();
    if (!items.length) {
      loading.textContent = "当前项目没有可快速打开的文件或本地地址。";
      quickLauncherRecommendations.append(loading);
      return;
    }
    quickLauncherRecommendations.append(...items.map(quickRecommendation));
  } catch (error) {
    loading.textContent = error.message;
    quickLauncherRecommendations.replaceChildren(loading);
  }
}

async function openQuickLauncher() {
  quickLauncher.hidden = false;
  quickLauncherToggle.setAttribute("aria-expanded", "true");
  await refreshQuickLauncher();
}

quickLauncherToggle.addEventListener("click", () => {
  if (quickLauncher.hidden) void openQuickLauncher();
  else closeQuickLauncher();
});
for (const button of $$('[data-quick-action]')) button.addEventListener("click", async () => {
  const action = button.dataset.quickAction;
  closeQuickLauncher();
  if (action === "task") await startFreshTask();
  if (action === "browser") { await selectToolView("browser"); address.focus(); }
  if (action === "terminal") { await selectToolView("terminal"); terminal?.focus(); }
});
document.addEventListener("click", (event) => {
  if (!quickLauncher.hidden && !quickLauncher.contains(event.target) && !quickLauncherToggle.contains(event.target)) closeQuickLauncher();
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
    event.preventDefault(); openCommandPalette(); return;
  }
  if (!$("#command-palette").hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeCommandPalette(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      commandPaletteSelection = Math.max(0, Math.min(commandPaletteItems.length - 1, commandPaletteSelection + direction));
      renderCommandPalette(); return;
    }
    if (event.key === "Enter" && commandPaletteItems[commandPaletteSelection]) {
      event.preventDefault(); const action = commandPaletteItems[commandPaletteSelection].run; closeCommandPalette(); void action(); return;
    }
  }
  if (event.key === "Escape" && !quickLauncher.hidden) {
    event.preventDefault();
    closeQuickLauncher();
    quickLauncherToggle.focus();
    return;
  }
  const commandModifier = isMacOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (commandModifier && event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    closeQuickLauncher();
    void startFreshTask();
    return;
  }
  if (commandModifier && !event.altKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    closeQuickLauncher();
    void selectToolView("browser").then((opened) => {
      if (!opened) return;
      createBrowserTab(activeBrowserTaskId, null, "新标签页", { activate: true });
      address.focus();
    });
    return;
  }
  if (commandModifier && !event.altKey && event.key.toLowerCase() === "p") {
    event.preventDefault(); closeQuickLauncher();
    void selectToolView("files").then(() => $("#files-search").focus());
    return;
  }
  if (!commandModifier || event.altKey) return;
  const view = ["browser", "terminal", "changes", "extensions", "control", "files"][Number(event.key) - 1];
  if (!view) return;
  event.preventDefault();
  selectToolView(view);
});

function selectControlPanel(view) {
  if (view === "agents" && !hasAgentSurfaceContent()) {
    agentSurfaceExplicitlyRequested = true;
    updateAgentSurfaceVisibility();
  } else if (view !== "agents" && agentSurfaceExplicitlyRequested && !hasAgentSurfaceContent()) {
    agentSurfaceExplicitlyRequested = false;
    updateAgentSurfaceVisibility();
  }
  applyControlPanelSelection(view);
  if (new Set(["worktrees", "context", "policy", "config", "memory", "usage", "secrets", "hooks"]).has(view)) $("#control-advanced-select").value = view;
  return selectToolView("control").then(refreshControl);
}

function paletteCandidates() {
  const tool = (id, label, hint = "工具") => ({ icon: label[0], label, hint, run: () => selectToolView(id) });
  const control = (id, label) => ({ icon: "⚙", label, hint: "控制中心", run: () => selectControlPanel(id) });
  const agents = hasAgentSurfaceContent() || agentSurfaceExplicitlyRequested
    ? control("agents", "Agents")
    : { icon: "↗", label: "新建共享任务", hint: "Codex Core 子 Agent", run: () => selectControlPanel("agents").then(openAgentComposer) };
  return [
    { icon: "+", label: "新建任务", hint: "当前窗口", shortcut: isMacOS ? "⌥⌘S" : "Ctrl+Alt+S", run: startFreshTask },
    { icon: "↗", label: "在新窗口新建任务", hint: "并行窗口", run: () => window.workbench.openTaskWindow(null) },
    { icon: "●", label: "显示 / 收起宠物", hint: "桌面任务状态", run: () => window.workbench.togglePet() },
    tool("browser", "浏览器"), tool("terminal", "终端"), tool("changes", "Git 变更"), tool("files", "项目文件"), tool("extensions", "扩展"),
    agents, { icon: "◴", label: "计划任务", hint: "独立任务与运行收件箱", run: () => showScheduledCenter("inbox") }, control("diagnostics", "诊断中心"),
    control("config", "有效配置"), control("memory", "本地记忆"), control("usage", "用量与成本"), control("secrets", "安全环境变量"), control("policy", "权限策略"),
    ...loadedThreads.filter((thread) => !thread.archived).slice(0, 40).map((thread) => ({ icon: "T", label: titleFrom(thread.name || thread.preview), hint: `${thread.cwd || "任务"} · ${thread.id.slice(0, 8)}`, run: () => resumeThread(thread.id) })),
  ];
}

function renderCommandPalette() {
  const query = $("#command-palette-search").value.trim().toLowerCase();
  commandPaletteItems = paletteCandidates().filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query));
  commandPaletteSelection = Math.min(commandPaletteSelection, Math.max(0, commandPaletteItems.length - 1));
  const list = $("#command-palette-list"); list.replaceChildren();
  if (!commandPaletteItems.length) list.innerHTML = '<span class="control-empty">没有匹配的命令或任务。</span>';
  commandPaletteItems.forEach((item, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `command-palette-item${index === commandPaletteSelection ? " selected" : ""}`;
    const icon = document.createElement("i"); icon.textContent = item.icon;
    const copy = document.createElement("div"); const label = document.createElement("strong"); label.textContent = item.label; const hint = document.createElement("small"); hint.textContent = item.hint; copy.append(label, hint);
    const shortcut = document.createElement("kbd"); shortcut.textContent = item.shortcut || ""; button.append(icon, copy, shortcut);
    button.addEventListener("mouseenter", () => {
      commandPaletteSelection = index;
      for (const [itemIndex, itemButton] of [...list.querySelectorAll(".command-palette-item")].entries()) itemButton.classList.toggle("selected", itemIndex === index);
    });
    button.addEventListener("click", () => { closeCommandPalette(); void item.run(); }); list.append(button);
  });
  list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function openCommandPalette() {
  $("#command-palette").hidden = false; $("#command-palette-search").value = ""; commandPaletteSelection = 0; renderCommandPalette(); $("#command-palette-search").focus();
}
function closeCommandPalette() { $("#command-palette").hidden = true; }
$("#command-palette-search").addEventListener("input", () => { commandPaletteSelection = 0; renderCommandPalette(); });
$("#command-palette").addEventListener("click", (event) => { if (event.target === $("#command-palette")) closeCommandPalette(); });

for (const button of $$("[data-archived]")) button.addEventListener("click", () => {
  showingArchived = button.dataset.archived === "true";
  for (const item of $$("[data-archived]")) item.classList.toggle("active", item === button);
  loadThreads();
});
taskSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadThreads, 220);
});

$("#new-task").addEventListener("click", startFreshTask);
$("#new-task-window").addEventListener("click", () => window.workbench.openTaskWindow(null));
$("#pet-toggle").addEventListener("click", () => window.workbench.togglePet());

for (const option of modeOptions) option.addEventListener("click", () => selectMode(option.dataset.mode));
goalBudgetMode.addEventListener("change", () => {
  const limited = goalBudgetMode.value === "limited";
  goalBudget.hidden = !limited;
  if (limited) goalBudget.focus();
});

goalPause.addEventListener("click", async () => {
  try { renderGoal((await window.workbench.updateGoal(currentThreadId, currentGoal?.status === "paused" ? "resume" : "pause")).goal); }
  catch (error) { addEvent("error", "GOAL", error.message); }
});
$("#goal-edit").addEventListener("click", async () => {
  const objective = await requestText({
    title: "编辑目标",
    description: "修改当前任务持续追求的目标。",
    value: currentGoal?.objective || "",
    placeholder: "目标",
    confirmLabel: "更新目标",
    maxLength: 500,
  });
  if (objective === null) return;
  try { renderGoal((await window.workbench.updateGoal(currentThreadId, "edit", objective)).goal); }
  catch (error) { addEvent("error", "GOAL", error.message); }
});
$("#goal-clear").addEventListener("click", async () => {
  if (!await confirmAction("目标的自动续跑将停止，已经完成的任务历史不会被删除。", {
    title: "清除当前目标？",
    confirmLabel: "清除目标",
    tone: "warning",
  })) return;
  try { await window.workbench.updateGoal(currentThreadId, "clear"); renderGoal(null); }
  catch (error) { addEvent("error", "GOAL", error.message); }
});

let addressNavigationPending = false;

async function submitAddress() {
  const value = address.value.trim();
  if (!value || addressNavigationPending) return;
  addressNavigationPending = true;
  address.setAttribute("aria-busy", "true");
  try {
    const result = await window.workbench.navigate(value, activeBrowserRouteId);
    if (result?.url) address.value = result.url;
  }
  catch (error) { addEvent("error", "BROWSER", error.message); }
  finally {
    addressNavigationPending = false;
    address.removeAttribute("aria-busy");
  }
}

$("#address-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submitAddress();
});
address.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void submitAddress();
});
address.addEventListener("focus", () => address.select());
$("#back").addEventListener("click", () => window.workbench.back(activeBrowserRouteId));
$("#forward").addEventListener("click", () => window.workbench.forward(activeBrowserRouteId));
$("#reload").addEventListener("click", () => window.workbench.reload(activeBrowserRouteId));
$("#browser-new-tab").addEventListener("click", () => {
  if (appPreferences.browserEnabled === false) {
    addEvent("error", "BROWSER", "内嵌浏览器已在设置中停用。");
    return;
  }
  createBrowserTab(activeBrowserTaskId, null, "新标签页", { activate: true });
  void selectToolView("browser").then(() => address.focus());
});

function openBrowserInspector(kicker, title) {
  $("#browser-inspector-kicker").textContent = kicker;
  $("#browser-inspector-title").textContent = title;
  $("#browser-inspector").hidden = false;
}

function browserInspectorEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "browser-inspector-empty";
  empty.textContent = message;
  return empty;
}

let lastAnnotationRefreshKey = "";

async function refreshBrowserAnnotations({ open = false } = {}) {
  const result = await window.workbench.listBrowserAnnotations(undefined, activeBrowserRouteId);
  $("#browser-annotation-count").textContent = String(result.annotations.length);
  if (!open) return result;
  openBrowserInspector("Page notes", `页面批注 · ${result.annotations.length}`);
  const body = $("#browser-inspector-body");
  body.replaceChildren();
  if (!result.annotations.length) {
    body.append(browserInspectorEmpty("当前页面还没有批注。点击“批注”，再选择页面中的元素或区域。"));
    return result;
  }
  const list = document.createElement("div");
  list.className = "browser-annotation-list";
  for (const annotation of result.annotations) {
    const card = document.createElement("article");
    card.className = "browser-annotation-card";
    const target = document.createElement("span");
    target.textContent = `${annotation.element || "element"} · ${annotation.selector || "selected area"}`;
    const note = document.createElement("strong");
    note.textContent = annotation.note;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.ariaLabel = "删除批注";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      await window.workbench.deleteBrowserAnnotation(annotation.id, activeBrowserRouteId);
      await refreshBrowserAnnotations({ open: true });
    });
    card.append(target, note, remove);
    list.append(card);
  }
  body.append(list);
  return result;
}

function developerRow(left, center, right = "") {
  const row = document.createElement("div");
  row.className = "browser-dev-row";
  const kind = document.createElement("em"); kind.textContent = left;
  const text = document.createElement("span"); text.textContent = center;
  const status = document.createElement("b"); status.textContent = right;
  row.append(kind, text, status);
  return row;
}

function developerSection(title, rows, emptyMessage) {
  const section = document.createElement("section");
  section.className = "browser-dev-section";
  const heading = document.createElement("strong"); heading.textContent = title;
  section.append(heading);
  if (!rows.length) section.append(browserInspectorEmpty(emptyMessage));
  else section.append(...rows);
  return section;
}

$("#browser-snapshot").addEventListener("click", async () => {
  const button = $("#browser-snapshot");
  button.disabled = true;
  openBrowserInspector("Visual snapshot", "正在捕获页面…");
  $("#browser-inspector-body").replaceChildren(browserInspectorEmpty("正在读取渲染后的浏览器视口。"));
  try {
    const result = await window.workbench.captureBrowserVisualSnapshot(activeBrowserRouteId);
    openBrowserInspector("Visual snapshot", result.title || "页面快照");
    const image = document.createElement("img");
    image.className = "browser-visual-frame";
    image.alt = result.title ? `${result.title} 页面快照` : "浏览器页面快照";
    image.src = `data:${result.mimeType};base64,${result.imageBase64}`;
    const caption = document.createElement("div");
    caption.className = "browser-inspector-caption";
    const size = document.createElement("span"); size.textContent = `${result.width}×${result.height} PNG`;
    const time = document.createElement("span"); time.textContent = new Date(result.capturedAt).toLocaleTimeString();
    caption.append(size, time);
    $("#browser-inspector-body").replaceChildren(image, caption);
  } catch (error) {
    $("#browser-inspector-body").replaceChildren(browserInspectorEmpty(error.message));
  } finally { button.disabled = false; }
});

$("#browser-inspect").addEventListener("click", async () => {
  const button = $("#browser-inspect");
  button.disabled = true;
  openBrowserInspector("Developer inspection", "正在检查页面…");
  $("#browser-inspector-body").replaceChildren(browserInspectorEmpty("正在读取 DOM、Console、Network 和页面性能摘要。"));
  try {
    const result = await window.workbench.inspectBrowserDeveloperState(activeBrowserRouteId);
    openBrowserInspector("Developer inspection", result.dom.title || "页面检查");
    const summary = document.createElement("div");
    summary.className = "browser-dev-summary";
    for (const [label, value] of [
      ["DOM", `${result.dom.nodes} nodes`],
      ["VIEWPORT", `${result.dom.viewport.width}×${result.dom.viewport.height}`],
      ["LOAD", result.dom.performance?.load ? `${result.dom.performance.load} ms` : "—"],
      ["TRANSFER", result.dom.performance?.transferSize ? `${Math.round(result.dom.performance.transferSize / 1024)} KB` : "—"],
    ]) {
      const item = document.createElement("div");
      const caption = document.createElement("span"); caption.textContent = label;
      const content = document.createElement("strong"); content.textContent = value;
      item.append(caption, content); summary.append(item);
    }
    const consoleRows = result.console.slice(-30).reverse().map((item) => developerRow(item.level, item.text || "(empty)", item.line ?? ""));
    const networkRows = result.network.slice(-50).reverse().map((item) => developerRow(item.method || item.type, item.url, item.error || item.status || "…"));
    $("#browser-inspector-body").replaceChildren(
      summary,
      developerSection("Console", consoleRows, "还没有捕获到 Console 消息。刷新页面后可继续采集。"),
      developerSection("Network", networkRows, "开发检查从启用后开始采集网络事件。刷新页面可查看完整请求。"),
    );
  } catch (error) {
    $("#browser-inspector-body").replaceChildren(browserInspectorEmpty(error.message));
  } finally { button.disabled = false; }
});

$("#browser-annotate").addEventListener("click", async () => {
  if (!$("#browser-annotation-composer").hidden) {
    await refreshBrowserAnnotations({ open: true });
    return;
  }
  const button = $("#browser-annotate");
  button.classList.add("annotation-active");
  $("#browser-inspector").hidden = true;
  try {
    const target = await window.workbench.beginBrowserAnnotation(activeBrowserRouteId);
    if (!target) return;
    pendingBrowserAnnotationTarget = target;
    $("#browser-annotation-target").textContent = target.text || target.selector || target.element;
    $("#browser-annotation-note").value = "";
    $("#browser-annotation-composer").hidden = false;
    $("#browser-annotation-note").focus();
  } catch (error) { addEvent("error", "BROWSER ANNOTATION", error.message); }
  finally { button.classList.remove("annotation-active"); }
});

async function cancelBrowserAnnotation() {
  pendingBrowserAnnotationTarget = null;
  $("#browser-annotation-composer").hidden = true;
  await window.workbench.cancelBrowserAnnotation(activeBrowserRouteId);
}

$("#browser-annotation-cancel").addEventListener("click", () => { void cancelBrowserAnnotation(); });
$("#browser-annotation-composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = $("#browser-annotation-note").value.trim();
  if (!note || !pendingBrowserAnnotationTarget) return;
  const button = $("#browser-annotation-save");
  button.disabled = true;
  try {
    await window.workbench.saveBrowserAnnotation({ ...pendingBrowserAnnotationTarget, note }, activeBrowserRouteId);
    pendingBrowserAnnotationTarget = null;
    $("#browser-annotation-composer").hidden = true;
    await refreshBrowserAnnotations({ open: true });
  } catch (error) { addEvent("error", "BROWSER ANNOTATION", error.message); }
  finally { button.disabled = false; }
});

$("#browser-inspector-close").addEventListener("click", () => { $("#browser-inspector").hidden = true; });
$("#browser-fill-credential").addEventListener("click", async () => {
  try {
    const result = await window.workbench.fillSavedBrowserCredential(activeBrowserRouteId);
    if (!result.found) addEvent("warning", "BROWSER PASSWORD", "当前网站没有已导入的密码");
    else if (!result.filled) addEvent("warning", "BROWSER PASSWORD", "当前页面没有可填充的密码输入框");
    else addEvent("success", "BROWSER PASSWORD", "已在当前页面填充本地加密保险库中的凭据");
  } catch (error) { addEvent("error", "BROWSER PASSWORD", error.message); }
});

function formatStorageSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "缓存小于 1 MB";
  return `${Math.max(0.1, bytes / 1024 / 1024).toFixed(1)} MB 本地缓存`;
}

async function refreshBrowserAccount() {
  const status = $("#browser-account-status");
  status.textContent = "正在读取本地会话摘要…";
  try {
    const summary = await window.workbench.getBrowserSessionStatus(activeBrowserRouteId);
    const google = summary.providers.find((provider) => provider.id === "google");
    $("#browser-profile-state").textContent = summary.persistent ? "独立持久化" : "临时会话";
    $("#browser-profile-size").textContent = formatStorageSize(summary.cacheBytes);
    $("#google-session-title").textContent = google?.hasLocalSessionData ? "检测到 Google 本地会话数据" : "尚未检测到 Google 会话";
    $("#google-session-copy").textContent = google?.hasLocalSessionData
      ? `OnPeople 中保存了 ${google.cookieCount} 条相关 Cookie 记录；值不会发送到界面或模型。`
      : "在 OnPeople 内完成登录。账号状态只保存在这个浏览器资料中。";
    $("#google-sign-in").textContent = google?.hasLocalSessionData ? "打开 Google 账号" : "在 OnPeople 登录 Google";
    $("#google-session-clear").disabled = !google?.hasLocalSessionData;
    status.textContent = "凭据值不会发送到界面、日志或模型。";
  } catch (error) { status.textContent = error.message; }
}

let browserImportProfiles = [];

function syncBrowserImportOptions() {
  const profile = browserImportProfiles.find((item) => item.id === profileImportSelect.value);
  const cookies = $("#profile-import-cookies");
  const passwords = $("#profile-import-passwords");
  cookies.disabled = !profile?.hasCookies;
  passwords.disabled = !profile?.hasPasswords;
  cookies.checked = Boolean(profile?.hasCookies);
  passwords.checked = Boolean(profile?.hasPasswords);
  $("#profile-import-run").disabled = !profile || (!cookies.checked && !passwords.checked);
  $("#profile-import-guidance").textContent = profile
    ? `导入前，请完全关闭 ${profile.appName || "来源浏览器"}。`
    : "没有找到可导入的浏览器资料。";
}

function updateBrowserImportButton() {
  const profile = browserImportProfiles.find((item) => item.id === profileImportSelect.value);
  $("#profile-import-run").disabled = !profile
    || (!$("#profile-import-cookies").checked && !$("#profile-import-passwords").checked);
}

async function loadBrowserImportProfiles() {
  const status = $("#profile-import-status");
  status.className = "profile-import-status";
  status.textContent = "正在查找本机浏览器资料…";
  profileImportSelect.replaceChildren();
  browserImportProfiles = [];
  try {
    const result = await window.workbench.listBrowserImportProfiles();
    if (!result.available) {
      status.classList.add("error");
      status.textContent = result.reason;
      syncBrowserImportOptions();
      return;
    }
    browserImportProfiles = result.profiles;
    for (const profile of browserImportProfiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = [profile.appName, profile.profileName || profile.profileDirectoryName].filter(Boolean).join(" · ");
      profileImportSelect.append(option);
    }
    status.textContent = browserImportProfiles.length
      ? "敏感值只在原生导入器与目标浏览器会话之间流转。"
      : "未找到 Chrome 或 Atlas 浏览器资料。";
    syncBrowserImportOptions();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
    syncBrowserImportOptions();
  }
}

function importedCount(step) {
  return step?.imported || step?.profile?.imported || 0;
}

$("#browser-account").addEventListener("click", () => {
  browserAccountSheet.hidden = false;
  void refreshBrowserAccount();
});
$("#browser-account-close").addEventListener("click", () => { browserAccountSheet.hidden = true; });
$("#profile-import-open").addEventListener("click", () => {
  profileImportDialog.showModal();
  void loadBrowserImportProfiles();
});
profileImportSelect.addEventListener("change", syncBrowserImportOptions);
$("#profile-import-cookies").addEventListener("change", updateBrowserImportButton);
$("#profile-import-passwords").addEventListener("change", updateBrowserImportButton);
$("#profile-import-run").addEventListener("click", async () => {
  const button = $("#profile-import-run");
  const status = $("#profile-import-status");
  button.disabled = true;
  status.className = "profile-import-status";
  status.textContent = "正在导入，请保持来源浏览器完全关闭…";
  try {
    const result = await window.workbench.importBrowserProfile({
      profileId: profileImportSelect.value,
      importCookies: $("#profile-import-cookies").checked,
      importPasswords: $("#profile-import-passwords").checked,
    }, activeBrowserRouteId);
    status.classList.add("success");
    status.textContent = `导入完成：Cookie ${importedCount(result.cookies)}，密码 ${importedCount(result.passwords)}。`;
    await refreshBrowserAccount();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    syncBrowserImportOptions();
  }
});
$("#google-sign-in").addEventListener("click", async () => {
  browserAccountSheet.hidden = true;
  try { await window.workbench.openBrowserSignIn("google", activeBrowserRouteId); }
  catch (error) { addEvent("error", "BROWSER ACCOUNT", error.message); }
});
$("#google-session-clear").addEventListener("click", async () => {
  if (!await confirmAction("Google、Gmail、Drive、Docs、Calendar 和 YouTube 会话数据将被清除，相关网站会退出登录。", {
    title: "退出 Google 会话？",
    confirmLabel: "清除并退出",
    tone: "danger",
  })) return;
  try { await window.workbench.clearBrowserSession("google", activeBrowserRouteId); await refreshBrowserAccount(); }
  catch (error) { $("#browser-account-status").textContent = error.message; }
});
$("#browser-data-clear").addEventListener("click", async () => {
  if (!await confirmAction("将清除内嵌浏览器的全部 Cookie、站点存储、Service Worker 和缓存，所有网站都会退出登录。", {
    title: "清除全部浏览器数据？",
    confirmLabel: "清除全部数据",
    tone: "danger",
  })) return;
  try { await window.workbench.clearAllBrowserData(activeBrowserRouteId); await refreshBrowserAccount(); }
  catch (error) { $("#browser-account-status").textContent = error.message; }
});

$("#terminal-new").addEventListener("click", startTerminal);

$("#git-refresh").addEventListener("click", refreshGit);
$("#git-choose-project").addEventListener("click", () => $("#project-add").click());
$("#git-init-repository").addEventListener("click", async () => {
  const cwd = cwdInput.value.trim();
  if (!cwd) return;
  if (!await confirmAction(`${cwd}\n\n这会创建 .git 文件夹，不会提交或上传任何文件。`, {
    title: "初始化 Git 仓库？",
    confirmLabel: "初始化仓库",
    tone: "warning",
  })) return;
  const button = $("#git-init-repository");
  button.disabled = true;
  button.textContent = "正在初始化…";
  try {
    await window.workbench.initGitRepository(cwd);
    await refreshGit();
  } catch (error) {
    showGitEmptyState(error);
  } finally {
    button.disabled = false;
    button.textContent = "初始化 Git 仓库";
  }
});
$("#git-stage-all").addEventListener("click", () => runGitMutation("stageAll"));
$("#git-unstage-all").addEventListener("click", () => runGitMutation("unstageAll"));
$("#git-commit-message").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); $("#git-commit").click(); }
});
$("#git-commit").addEventListener("click", async () => {
  if (gitBusy) return;
  const message = $("#git-commit-message").value.trim();
  if (!message) { $("#git-commit-message").focus(); return; }
  setGitBusy(true);
  try {
    const result = await window.workbench.commitGit(cwdInput.value.trim(), message);
    $("#git-commit-message").value = "";
    currentGitState = result.state;
    selectedGitFile = null;
    renderGitFiles(currentGitState);
    renderDiff(currentGitState.diff);
    addEvent("tool", "GIT COMMIT", result.output || `已提交：${message}`);
  } catch (error) { addEvent("error", "GIT COMMIT", error.message); }
  finally { setGitBusy(false); if (currentGitState) renderGitFiles(currentGitState); }
});
$("#git-push").addEventListener("click", async () => {
  if (gitBusy || !currentGitState) return;
  const destination = currentGitState.upstream || `${currentGitState.remotes[0] || "remote"}/${currentGitState.branch}`;
  if (!await confirmAction(`分支：${currentGitState.branch}\n目标：${destination}\n\n推送会修改远程仓库。`, {
    title: "推送当前分支？",
    confirmLabel: "推送到远程",
    tone: "warning",
  })) return;
  setGitBusy(true);
  try {
    const result = await window.workbench.pushGit(cwdInput.value.trim(), currentGitState.remotes[0] || null);
    currentGitState = result.state;
    renderGitFiles(currentGitState);
    addEvent("tool", "GIT PUSH", result.output || `已推送 ${currentGitState.branch}`);
  } catch (error) { addEvent("error", "GIT PUSH", error.message); }
  finally { setGitBusy(false); if (currentGitState) renderGitFiles(currentGitState); }
});
$("#git-prepare-pr").addEventListener("click", async () => {
  if (gitBusy || !currentGitState?.canPreparePr) return;
  setGitBusy(true);
  try {
    const result = await window.workbench.preparePullRequest(cwdInput.value.trim(), currentGitState.baseBranch);
    await selectToolView("browser");
    await window.workbench.navigate(result.url, activeBrowserRouteId);
    addEvent("tool", "PULL REQUEST", `已打开 ${result.base} ← ${result.branch} 的 GitHub PR 页面；提交前请核对标题、说明和目标分支。`);
  } catch (error) { addEvent("error", "PULL REQUEST", error.message); }
  finally { setGitBusy(false); if (currentGitState) renderGitFiles(currentGitState); }
});
$("#review-target").addEventListener("change", (event) => {
  $("#review-value").disabled = event.target.value === "uncommittedChanges";
});
$("#review-start").addEventListener("click", async () => {
  if (running) return;
  setRunning(true);
  try {
    const result = await window.workbench.startReview({ cwd: cwdInput.value.trim(), targetType: $("#review-target").value, value: $("#review-value").value });
    currentThreadId = result.threadId;
    resetTimeline();
    activateBrowserTask(currentThreadId);
    setThreadRuntimeState(currentThreadId, "working");
    threadLabel.textContent = result.threadId.slice(0, 13).toUpperCase();
  } catch (error) { addEvent("error", "REVIEW", error.message); setRunning(false); }
});
$("#review-comments-clear").addEventListener("click", async () => {
  reviewComments.clear(); updateReviewCommentControls();
  if (selectedGitFile) {
    const hunks = await window.workbench.getGitHunks(cwdInput.value.trim(), selectedGitFile);
    renderGitHunks(hunks);
  } else if (currentGitState) renderDiff(currentGitState.diff);
});
$("#review-comments-submit").addEventListener("click", async () => {
  const button = $("#review-comments-submit"); button.disabled = true;
  try {
    const result = await window.workbench.submitReviewComments({ cwd: cwdInput.value.trim(), comments: [...reviewComments.values()] });
    if (result?.threadId && result.threadId !== currentThreadId) {
      currentThreadId = result.threadId;
      resetTimeline();
      activateBrowserTask(currentThreadId);
      threadLabel.textContent = result.threadId.slice(0, 13).toUpperCase();
    }
    reviewComments.clear(); updateReviewCommentControls();
    if (selectedGitFile) renderGitHunks(await window.workbench.getGitHunks(cwdInput.value.trim(), selectedGitFile));
  } catch (error) { addEvent("error", "INLINE REVIEW", error.message); }
  finally { updateReviewCommentControls(); }
});

for (const button of $$("[data-extension-view]")) button.addEventListener("click", () => {
  for (const item of $$("[data-extension-view]")) item.classList.toggle("active", item === button);
  for (const list of $$("[data-extension-list]")) list.classList.toggle("active", list.dataset.extensionList === button.dataset.extensionView);
});
$("#extensions-refresh").addEventListener("click", refreshExtensions);

for (const button of $$('[data-control-view]')) button.addEventListener("click", async () => {
  await selectControlPanel(button.dataset.controlView);
});
$("#control-advanced-toggle").addEventListener("click", () => {
  const toggle = $("#control-advanced-toggle"); const expanded = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", String(expanded)); toggle.textContent = expanded ? "高级设置⌃" : "高级设置⌄";
  for (const item of $$(".advanced-control-item")) item.hidden = !expanded;
  if (!expanded && new Set(["worktrees", "context", "policy", "config", "memory", "usage", "secrets", "hooks"]).has(activeControlView)) void selectControlPanel("diagnostics");
});
$("#control-advanced-select").addEventListener("change", (event) => { if (event.target.value) void selectControlPanel(event.target.value); });
$("#agent-advanced-open").addEventListener("click", openAgentComposer);
$("#agent-advanced-close").addEventListener("click", () => { $("#agent-create").hidden = true; $("#agent-advanced-open").hidden = false; });
for (const button of $$("[data-agent-board-state]")) button.addEventListener("click", () => {
  const requested = button.dataset.agentBoardState;
  activeAgentBoardFilter = activeAgentBoardFilter === requested ? "all" : requested;
  renderAgents(managedAgentState, policyState?.maxAgents || 4, agentBoardState);
});
$("#control-refresh").addEventListener("click", refreshControl);
$("#effective-config-refresh").addEventListener("click", refreshEffectiveConfig);
$("#agent-profile").addEventListener("change", (event) => applyAgentProfile(agentProfiles.find((profile) => profile.id === event.target.value)));
$("#profile-agent-new").addEventListener("click", () => resetAgentProfileForm());
$("#agent-profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await window.workbench.saveAgentProfile({ id: $("#profile-agent-id").value || undefined, name: $("#profile-agent-name").value, role: $("#profile-agent-role").value, model: $("#profile-agent-model").value, effort: $("#profile-agent-effort").value, sandbox: $("#profile-agent-sandbox").value, instructions: $("#profile-agent-instructions").value });
  renderAgentProfiles(result.profiles); $("#agent-profile").value = result.profile.id; applyAgentProfile(result.profile); resetAgentProfileForm(result.profile);
});
$("#profile-agent-delete").addEventListener("click", async () => {
  const id = $("#profile-agent-id").value;
  if (!id || !await confirmAction("已经使用该配置创建的任务不会被删除。", {
    title: "删除自定义 Agent？",
    confirmLabel: "删除 Agent",
    tone: "danger",
  })) return;
  const result = await window.workbench.deleteAgentProfile(id); renderAgentProfiles(result.profiles); resetAgentProfileForm();
});
$("#memory-settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  await window.workbench.saveMemorySettings({ enabled: $("#memory-enabled").checked, generate: $("#memory-generate").checked });
  const content = $("#memory-content").value.trim();
  if (content) await window.workbench.saveMemory({ content, scope: $("#memory-scope").value, projectPath: cwdInput.value.trim(), enabled: true, source: "user" });
  $("#memory-content").value = ""; await refreshMemories();
});
$("#memory-enabled").addEventListener("change", async () => { await window.workbench.saveMemorySettings({ enabled: $("#memory-enabled").checked }); await refreshMemories(); });
$("#memory-generate").addEventListener("change", async () => { await window.workbench.saveMemorySettings({ generate: $("#memory-generate").checked }); await refreshMemories(); });
$("#usage-price-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const key = $("#usage-price-key").value.trim(); if (!key) return;
  renderUsage(await window.workbench.saveUsagePrice(key, { input: $("#usage-price-input").value, cached: $("#usage-price-cached").value, output: $("#usage-price-output").value }));
});
$("#secret-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await window.workbench.saveSecret({ id: $("#secret-id").value || undefined, name: $("#secret-name").value, value: $("#secret-value").value, scope: $("#secret-scope").value, projectPath: cwdInput.value.trim(), allowedHosts: $("#secret-hosts").value });
  event.currentTarget.reset(); $("#secret-id").value = ""; await refreshSecrets();
});

$("#files-back").addEventListener("click", async () => { if (currentFileParent !== null) { currentFilePath = currentFileParent; await refreshProjectFiles(); } });
$("#files-refresh").addEventListener("click", refreshProjectFiles);
$("#files-search").addEventListener("input", () => { clearTimeout(fileSearchTimer); fileSearchTimer = setTimeout(refreshProjectFiles, 180); });

function setScheduledCenterMode(mode = "inbox") {
  scheduledCenterMode = mode === "create" ? "create" : "inbox";
  $("#scheduled-inbox-view").hidden = scheduledCenterMode !== "inbox";
  $("#scheduled-create-view").hidden = scheduledCenterMode !== "create";
  $("#scheduled-create-open").hidden = scheduledCenterMode === "create";
  if (scheduledCenterMode === "create") {
    refreshScheduledProjectOptions();
    window.setTimeout(() => $("#scheduled-prompt").focus(), 0);
  }
}

async function showScheduledCenter(mode = "inbox") {
  $("#scheduled-center").hidden = false;
  appShell.classList.add("scheduled-open");
  $("#scheduled-nav").classList.add("active");
  setScheduledCenterMode(mode);
  await refreshScheduler();
}

function closeScheduledCenter() {
  $("#scheduled-center").hidden = true;
  appShell.classList.remove("scheduled-open");
  $("#scheduled-nav").classList.remove("active");
  scheduledCenterMode = "inbox";
}

$("#scheduled-nav").addEventListener("click", () => {
  if ($("#scheduled-center").hidden) void showScheduledCenter("inbox");
  else closeScheduledCenter();
});
$("#scheduled-center-close").addEventListener("click", closeScheduledCenter);
$("#scheduled-create-open").addEventListener("click", () => setScheduledCenterMode("create"));
$("#scheduled-create-back").addEventListener("click", () => setScheduledCenterMode("inbox"));
$("#scheduled-kind").addEventListener("change", () => {
  const kind = $("#scheduled-kind").value;
  $("#scheduled-time-wrap").hidden = kind === "interval" || kind === "rrule";
  $("#scheduled-day-wrap").hidden = kind !== "weekly";
  $("#scheduled-interval-wrap").hidden = kind !== "interval";
  $("#scheduled-rrule-wrap").hidden = kind !== "rrule";
  if (kind === "rrule") $("#scheduled-advanced").open = true;
});
$("#scheduled-create").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const kind = $("#scheduled-kind").value;
  const schedule = kind === "rrule" ? { kind, rule: $("#scheduled-rrule").value } : kind === "interval" ? { kind, intervalMinutes: Number($("#scheduled-interval").value) } : kind === "weekly" ? { kind, day: Number($("#scheduled-day").value), time: $("#scheduled-time").value } : { kind, time: $("#scheduled-time").value };
  try {
    const destinationMode = $("#scheduled-destination").value;
    if (destinationMode === "thread" && !currentThreadId) throw new Error("当前没有可续跑的会话");
    const prompt = $("#scheduled-prompt").value.trim();
    const name = $("#scheduled-name").value.trim() || prompt.split(/\n/)[0].replace(/[。！？.!?]+$/, "").slice(0, 100);
    renderScheduler(await window.workbench.createScheduledTask({
      name, prompt, cwd: $("#scheduled-project").value, schedule,
      destination: { mode: destinationMode, threadId: destinationMode === "thread" ? currentThreadId : null },
      execution: { mode: $("#scheduled-execution").value, ref: "HEAD" },
      runtime: {
        model: $("#scheduled-model").value.trim(),
        reasoningEffort: $("#scheduled-effort").value,
        permission: $("#scheduled-permission").value,
      },
    }));
    $("#scheduled-name").value = "";
    $("#scheduled-prompt").value = "";
    $("#scheduled-model").value = "";
    $("#scheduled-effort").value = "";
    $("#scheduled-permission").value = "inherit";
    $("#scheduled-advanced").open = false;
    setScheduledCenterMode("inbox");
  } catch (error) { addEvent("error", "SCHEDULED", error.message); } finally { button.disabled = false; }
});
$("#scheduled-mark-read").addEventListener("click", async () => renderScheduler(await window.workbench.markScheduledNotificationsRead()));
$("#runtime-restart").addEventListener("click", async () => {
  const button = $("#runtime-restart"); button.disabled = true;
  try { renderDiagnostics(await window.workbench.restartRuntime()); }
  catch (error) { addEvent("error", "RUNTIME", error.message); }
  finally { button.disabled = false; }
});

$("#agent-create").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = $("#agent-prompt").value.trim();
  if (!prompt) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const created = await window.workbench.createAgentTask({
      parentThreadId: currentThreadId,
      title: $("#agent-name").value.trim() || prompt.split(/\n/)[0].slice(0, 80),
      role: $("#agent-role").value,
      model: $("#agent-model").value.trim(), effort: $("#agent-effort").value,
      description: prompt,
      dependencyIds: [...$("#agent-dependencies").selectedOptions].map((option) => option.value).filter(Boolean),
      profileId: $("#agent-profile").value,
      instructions: agentProfiles.find((profile) => profile.id === $("#agent-profile").value)?.instructions || "",
    });
    if (button.dataset.agentAction === "dispatch") await window.workbench.dispatchAgentTask(created.task.id);
    $("#agent-name").value = "";
    $("#agent-prompt").value = "";
    for (const option of $("#agent-dependencies").options) option.selected = false;
    addEvent("tool", button.dataset.agentAction === "dispatch" ? "CODEX CORE" : "SHARED TASK",
      button.dataset.agentAction === "dispatch"
        ? "共享任务已创建并交给 Codex Core。"
        : "任务已加入看板，满足依赖后可以派发。");
    await refreshAgents();
  } catch (error) { addEvent("error", "SUBAGENT", error.message); }
  finally { button.disabled = false; }
});

$("#worktree-create").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await window.workbench.createWorktree({ cwd: cwdInput.value.trim(), name: $("#worktree-name").value.trim(), ref: $("#worktree-ref").value.trim() });
    addEvent("tool", "WORKTREE CREATED", `${result.branch}\n${result.path}`);
    $("#worktree-name").value = "";
    await refreshWorktrees();
  } catch (error) { addEvent("error", "WORKTREE", error.message); }
  finally { button.disabled = false; }
});

$("#context-steer").addEventListener("click", async () => {
  const text = $("#context-message").value.trim();
  if (!text) return;
  try { await window.workbench.steerTurn(text); $("#context-message").value = ""; addEvent("user", "STEER", text); }
  catch (error) { addEvent("error", "CONTEXT", error.message); }
});
$("#context-queue").addEventListener("click", async () => {
  const text = $("#context-message").value.trim();
  if (!text) return;
  try { renderContext(await window.workbench.queueMessage(text)); $("#context-message").value = ""; }
  catch (error) { addEvent("error", "CONTEXT", error.message); }
});
$("#context-compact").addEventListener("click", async () => {
  if (!await confirmAction("原始任务历史仍会保留，但模型后续将使用压缩后的摘要。", {
    title: "压缩当前任务上下文？",
    confirmLabel: "开始压缩",
    tone: "neutral",
  })) return;
  try { await window.workbench.compactContext(); addEvent("tool", "CONTEXT", "已开始压缩当前任务上下文。"); }
  catch (error) { addEvent("error", "CONTEXT", error.message); }
});

$("#policy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const sandbox = $("#policy-sandbox").value;
  const approvalPolicy = $("#policy-approval").value;
  if ((sandbox === "danger-full-access" || approvalPolicy === "never") && !await confirmAction("该策略会显著减少安全边界，并应用到当前任务和后续任务。", {
    title: "应用宽松安全策略？",
    confirmLabel: "应用策略",
    tone: "danger",
  })) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await window.workbench.savePolicy(currentThreadId, {
      sandbox, approvalPolicy,
      networkAccess: $("#policy-network").checked,
      approvalsReviewer: $("#policy-reviewer").value,
      multiAgentMode: $("#policy-multi-agent").value,
      maxAgents: $("#policy-max-agents").value,
    });
    renderPolicy(result);
  } catch (error) { addEvent("error", "POLICY", error.message); }
  finally { button.disabled = false; }
});

$("#permission-preset").addEventListener("change", async (event) => {
  const selected = event.target.value;
  if (selected === "full_access" && !await confirmAction("OnPeople 将直接使用文件系统、网络、命令和普通工具，不再逐次请求批准。\n\n公开发布、购买和删除外部数据仍会单独向你确认。", {
    kicker: "权限范围",
    title: "开启完全访问",
    confirmLabel: "开启",
    cancelLabel: "保持请求批准",
    tone: "danger",
  })) {
    renderPermissionPreset(policyState);
    return;
  }
  const presets = {
    ask: { sandbox: "workspace-write", networkAccess: false, approvalPolicy: "on-request", approvalsReviewer: "user" },
    auto_review: { sandbox: "workspace-write", networkAccess: false, approvalPolicy: "on-request", approvalsReviewer: "auto_review" },
    full_access: { sandbox: "danger-full-access", networkAccess: true, approvalPolicy: "never", approvalsReviewer: "user" },
  };
  event.target.disabled = true;
  try {
    const result = await window.workbench.savePolicy(currentThreadId, { ...policyState, ...presets[selected] });
    renderPolicy(result);
    addEvent("tool", "PERMISSIONS", selected === "ask" ? "已切换为请求批准。" : selected === "auto_review" ? "已切换为审阅 Agent 代为审批。" : "已启用完全访问。");
  } catch (error) {
    renderPermissionPreset(policyState);
    addEvent("error", "PERMISSIONS", error.message);
  }
});

$("#hook-create").addEventListener("submit", async (event) => {
  event.preventDefault();
  const command = $("#hook-command").value.trim();
  if (!command || !await confirmAction(`保存后仍需按哈希审阅并信任，才会执行：\n\n${command}`, {
    title: "保存命令 Hook？",
    confirmLabel: "保存 Hook",
    tone: "warning",
  })) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await window.workbench.createHook({
      cwd: cwdInput.value.trim(), event: $("#hook-event").value,
      matcher: $("#hook-matcher").value.trim(), command,
      statusMessage: $("#hook-status").value.trim(), timeout: $("#hook-timeout").value,
    });
    $("#hook-command").value = "";
    addEvent("tool", "HOOK SAVED", `${result.file}\n待审阅信任后执行。`);
    await refreshHooks();
  } catch (error) { addEvent("error", "HOOK", error.message); }
  finally { button.disabled = false; }
});

window.workbench.onBrowserState((state) => {
  const record = browserTabs.get(state.routeId);
  if (record) {
    record.url = state.url || record.url;
    record.title = state.title || record.title;
    if (record.taskId === activeBrowserTaskId) renderBrowserTabStrip();
    persistBrowserGroups();
  }
  if (state.routeId !== activeBrowserRouteId) return;
  const browserHome = !state.url || state.url.startsWith("data:") || state.url.endsWith("/browser-home.html");
  const documentPreview = /\/preview\/[^/]+\/.*\.pdf(?:\?|$)/i.test(state.url || "");
  browserView.classList.toggle("document-preview", documentPreview);
  if (!address.matches(":focus")) address.value = browserHome ? "" : (state.url || "");
  permission.className = `site-permission ${state.approved ? "approved" : ""}`;
  permission.querySelector("span").textContent = browserHome
    ? "等待访问"
    : (state.approved ? `${state.host} 已批准` : "域名未批准");
  $("#back").disabled = !state.canGoBack;
  $("#forward").disabled = !state.canGoForward;
  // Annotations are keyed by URL, so title-only state events need no re-list.
  const annotationKey = `${state.routeId}|${state.url || ""}`;
  if (annotationKey !== lastAnnotationRefreshKey) {
    lastAnnotationRefreshKey = annotationKey;
    void refreshBrowserAnnotations().catch(() => {});
  }
});

window.workbench.onAgentBrowserNavigation((event) => {
  if (event.routeId !== activeBrowserRouteId) return;
  void selectToolView("browser");
});
window.workbench.onBrowserPreviewUpdated((event) => {
  if (event.routeId !== activeBrowserRouteId) return;
  permission.classList.add("preview-live");
  permission.querySelector("span").textContent = `已刷新 ${event.path}`;
  window.setTimeout(() => permission.classList.remove("preview-live"), 900);
});
window.workbench.onBrowserNewTabRequested((event) => {
  const opener = browserTabs.get(event.routeId);
  if (!opener) return;
  createBrowserTab(opener.taskId, event.url || null, "正在载入…", { activate: opener.taskId === activeBrowserTaskId });
});

async function createScheduleFromConversation(prompt) {
  const result = await window.workbench.createScheduledTaskFromText({
    text: prompt,
    cwd: cwdInput.value.trim(),
    model: modelInput.value.trim(),
    reasoningEffort: selectedReasoningEffort,
  });
  if (!result?.matched) return false;
  const clientMessageId = crypto.randomUUID();
  addEvent("user", "YOU", prompt, { clientMessageId, deliveryStatus: result.error ? "failed" : "sent" });
  promptInput.value = "";
  if (result.error) {
    addEvent("error", "SCHEDULED", result.error);
    return true;
  }
  renderScheduler(result.state);
  addEvent("agent", "计划任务", `已创建“${result.task.name}”。${scheduleLabel(result.task.schedule)}执行，可从左侧“计划任务”查看、暂停或立即运行。`);
  return true;
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting) return;
  const wasRunning = running;
  const typedPrompt = promptInput.value.trim();
  if (!typedPrompt && !selectedImages.length && !selectedAttachments.length) return;
  const prompt = typedPrompt || (selectedAttachments.length ? "请分析所附文件或文件夹。" : "请分析所附图片。");
  if (selectedMode === "goal" && goalBudgetMode.value === "limited" && !goalBudget.value) {
    goalBudget.focus();
    addEvent("error", "GOAL BUDGET", "请输入 Token 预算，或选择“∞ 无限”。");
    return;
  }
  if (!wasRunning && selectedMode === "default" && !selectedImages.length && !selectedAttachments.length) {
    try {
      if (await createScheduleFromConversation(prompt)) return;
    } catch (error) {
      addEvent("error", "SCHEDULED", error.message);
      return;
    }
  }
  taskTitle.textContent = titleFrom(prompt);
  const clientMessageId = crypto.randomUUID();
  addEvent("user", "YOU", prompt, { clientMessageId, deliveryStatus: "pending" });
  promptInput.value = "";
  activeAgentMessage = null;
  setSubmitting(true);
  try {
    const common = {
      threadId: currentThreadId,
      browserRouteId: activeBrowserRouteId,
      clientMessageId,
      cwd: cwdInput.value.trim(),
      workspaceMode: selectedWorkspaceMode,
      workspaceBaseCwd: selectedWorkspaceBaseCwd,
      modelProvider: providerSelect.value,
      model: modelInput.value.trim(),
      reasoningEffort: selectedReasoningEffort,
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value,
    };
    const result = !wasRunning && selectedMode === "goal"
      ? await window.workbench.setGoal({ ...common, objective: prompt, tokenBudget: goalBudgetMode.value === "limited" ? goalBudget.value : null, attachments: selectedAttachments, capability: selectedCapability })
      : await window.workbench.sendPrompt({ ...common, prompt, mode: wasRunning ? "default" : selectedMode, images: wasRunning ? [] : selectedImages, attachments: wasRunning ? [] : selectedAttachments, capability: wasRunning ? null : selectedCapability });
    setUserMessageDelivery(clientMessageId, result.queued ? "queued" : "sent");
    selectedImages = [];
    selectedAttachments = [];
    selectedCapability = null;
    imagePreviewUrls.clear();
    renderImages();
    renderSelectedCapability();
    currentThreadId = result.threadId;
    if (result.cwd) {
      cwdInput.value = result.cwd;
      selectedWorkspaceMode = result.workspaceMode || selectedWorkspaceMode;
      selectedWorkspaceBaseCwd = result.workspaceBaseCwd || selectedWorkspaceBaseCwd;
      cwdInput.disabled = true;
      updateProject(result.cwd);
    }
    await promoteBrowserTab(result.threadId);
    threadLabel.textContent = result.threadId.slice(0, 13).toUpperCase();
    if (result.goal) renderGoal(result.goal);
    await loadThreads();
  } catch (error) {
    setUserMessageDelivery(clientMessageId, "failed", error.message);
    setThreadRuntimeState(currentThreadId, "failed");
    addEvent("error", "AGENT", error.message);
  } finally { setSubmitting(false); }
});
promptInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  composer.requestSubmit();
});
promptInput.addEventListener("input", updateComposerPrimaryAction);
sendButton.addEventListener("click", async (event) => {
  if (sendButton.dataset.action !== "stop") return;
  event.preventDefault();
  if (!running || submitting) return;
  sendButton.disabled = true;
  try {
    await window.workbench.interrupt(currentThreadId);
  } catch (error) {
    addTraceError("STOP", error.message);
  } finally {
    setThreadRuntimeState(currentThreadId, "stopped");
    setRunning(false);
  }
});
liveStartButton.addEventListener("click", async () => {
  liveStartButton.disabled = true;
  try {
    await startLiveConversation();
  } catch (error) {
    const message = cloudErrorMessage(error);
    releaseLiveConversation({ keepPanel: true });
    setLivePanel({ title: "无法启动 GPT-Live", status: message, transcript: "检查登录、模型分组和麦克风权限后重试。", error: true, paused: true });
    addEvent("error", "GPT-LIVE", message);
  } finally {
    liveStartButton.disabled = false;
  }
});
liveEndButton.addEventListener("click", () => releaseLiveConversation());
liveMuteButton.addEventListener("click", () => {
  if (!liveConversation) return;
  liveConversation.muted = !liveConversation.muted;
  for (const track of liveConversation.localStream.getAudioTracks()) track.enabled = !liveConversation.muted;
  liveMuteButton.setAttribute("aria-pressed", String(liveConversation.muted));
  liveMuteButton.setAttribute("aria-label", liveConversation.muted ? "取消麦克风静音" : "静音麦克风");
  liveMuteLabel.textContent = liveConversation.muted ? "取消静音" : "静音";
  setLivePanel({
    title: liveConversation.muted ? "麦克风已静音" : "GPT-Live 正在聆听",
    status: liveConversation.muted ? "远端音频仍会继续播放" : "实时音频已连接",
    transcript: liveCallTranscript.textContent,
    paused: liveConversation.muted,
    phase: liveConversation.muted ? "muted" : "listening",
  });
});

window.workbench.onAgentEvent((event) => {
  if (event.type === "skills-changed") {
    const refreshButton = $("#extensions-refresh");
    refreshButton.classList.add("attention");
    refreshButton.textContent = "检测到更新";
    if (extensionRefreshTimer) clearTimeout(extensionRefreshTimer);
    extensionRefreshTimer = setTimeout(() => {
      extensionRefreshTimer = null;
      if (activeToolView === "extensions") void refreshExtensions();
    }, 180);
    return;
  }
  if (event.type === "thread-lifecycle") {
    const phase = event.state?.phase || "idle";
    const presentation = phase === "running" ? "working" : phase === "idle" ? "completed" : phase;
    setThreadRuntimeState(event.threadId, presentation);
    if (event.threadId === currentThreadId && new Set(["idle", "failed"]).has(phase)) {
      reconcileCurrentThreadTerminalState({
        threadId: event.threadId,
        status: phase,
        completedAt: event.state?.updatedAt,
        error: event.state?.error,
        finalText: event.state?.finalText,
      });
    }
    return;
  }
  if (event.type === "message-delivery") {
    setUserMessageDelivery(event.clientMessageId, event.status, event.message);
    if (event.status === "failed") {
      setThreadRuntimeState(event.threadId, "failed");
      if (event.threadId === currentThreadId) setRunning(false);
    }
    return;
  }
  if (event.type === "thread-status-changed") {
    setThreadRuntimeState(event.threadId, event.status);
    if (event.threadId === currentThreadId && new Set(["completed", "failed", "stopped"]).has(event.status)) {
      reconcileCurrentThreadTerminalState({
        threadId: event.threadId,
        status: event.status,
      });
    }
    return;
  }
  if (event.type === "terminal-output") {
    terminalSessions.get(event.processId)?.terminal.write(event.data);
    return;
  }
  if (event.type === "terminal-exit") {
    const session = terminalSessions.get(event.processId);
    if (!session) return;
    session.terminal.writeln(`\r\n\x1b[38;5;245m[process exited ${event.exitCode}]\x1b[0m`);
    session.exited = true;
    session.tab.classList.add("exited");
    if (activeTerminalId === event.processId) terminalProcessId = null;
    return;
  }
  if (event.type === "terminal-error") {
    const session = terminalSessions.get(event.processId);
    if (!session) return;
    session.terminal.writeln(`\r\n\x1b[31m${event.message}\x1b[0m`);
    session.exited = true;
    session.tab.classList.add("exited");
    if (activeTerminalId === event.processId) terminalProcessId = null;
    return;
  }
  if (event.type === "smoke-started") { addEvent("user", "SMOKE TEST", event.prompt); setRunning(true); return; }
  if (event.type === "smoke-thread" || event.type === "thread-ready") {
    currentThreadId = event.threadId;
    if (running) setThreadRuntimeState(currentThreadId, "working");
    threadLabel.textContent = event.threadId.slice(0, 13).toUpperCase();
    loadThreads();
    return;
  }
  if (event.type === "ready") { setRuntime("ready", event.recovered ? "Agent 已恢复" : "Agent 已连接"); loadThreads(); return; }
  if (event.type === "thread-recovered") {
    if (event.threadId !== currentThreadId) return;
    threadLabel.textContent = event.threadId.slice(0, 13).toUpperCase();
    return;
  }
  if (event.type === "goal-state") { renderGoal(event.goal); return; }
  if (event.type === "agents-updated") { renderAgents(event.agents || [], event.maxAgents || policyState?.maxAgents || 4, event.board); return; }
  if (event.type === "context-updated") { if (!event.state?.threadId || event.state.threadId === currentThreadId) renderContext(event.state); return; }
  if (event.type === "context-compacted") { if (activeToolView === "control" && activeControlView === "context") refreshContext(); return; }
  if (event.type === "queued-message-started") {
    if (!event.state?.threadId || event.state.threadId === currentThreadId) {
      addEvent("user", "QUEUED", event.message.text);
      renderContext(event.state);
      setRunning(true);
    }
    return;
  }
  if (event.type === "context-error") { addTraceError("CONTEXT", event.message); return; }
  if (event.type === "hooks-updated") { if (activeToolView === "control" && activeControlView === "hooks") refreshHooks(); return; }
  if (event.type === "audit-entry") { auditState.unshift(event.entry); if (activeToolView === "control" && activeControlView === "policy") renderAudit(auditState.slice(0, 100)); return; }
  if (event.type === "fatal" || event.type === "server-exit") {
    setThreadRuntimeState(currentThreadId, "failed");
    setRuntime("error", event.message || "Agent 已断开");
    addTraceError("RUNTIME", event.message || `App Server exited: ${event.code ?? "unknown"}`);
    setRunning(false);
    return;
  }
  if (event.type === "server-log") { console.debug("Codex App Server:", event.text); return; }
  if (event.type === "approval-required") { addApproval(event.request); return; }
  if (event.type === "unsupported-server-request") { addTraceError("UNSUPPORTED REQUEST", event.request.method); return; }
});

window.workbench.onTurnEvent((event) => {
  if (event.type !== "turn-event") return;
  const message = { method: event.name, params: event.params || {} };
  const eventThreadId = event.threadId || null;
  if (message.method === "turn/started") {
    currentTurnStartedAt = Date.now();
    setThreadRuntimeState(eventThreadId || currentThreadId, "working");
    setRunning(true);
    if (
      pendingLiveDelegation
      && (!pendingLiveDelegation.threadId || !eventThreadId || pendingLiveDelegation.threadId === eventThreadId)
    ) {
      pendingLiveDelegation.turnStarted = true;
      clearLiveDelegationWait(pendingLiveDelegation);
      updateLiveDelegationTrace(pendingLiveDelegation, "inProgress", "当前任务正在运行");
      setLivePanel({
        title: "当前任务正在运行",
        status: "工具进度已开始记录",
        transcript: pendingLiveDelegation.text,
        paused: true,
        phase: "delegating",
      });
    }
  }
  else if (message.method === "thread/status/changed") {
    const status = message.params?.status || {};
    const activeFlags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
    const raw = [status.type, ...activeFlags].filter(Boolean).join(" ").toLocaleLowerCase();
    const state = raw.includes("waitingOnApproval".toLocaleLowerCase()) ? "waiting-approval"
      : raw.includes("waitingOnUserInput".toLocaleLowerCase()) ? "waiting-input"
        : raw.includes("failed") ? "failed"
          : raw.includes("paused") || raw.includes("blocked") ? "paused"
            : status.type === "active" ? "working" : "completed";
    setThreadRuntimeState(eventThreadId || currentThreadId, state);
  }
  else if (message.method === "thread/goal/updated") renderGoal(message.params.goal);
  else if (message.method === "thread/goal/cleared") renderGoal(null);
  else if (message.method === "turn/plan/updated") renderPlan(message.params);
  else if (message.method === "item/started" && message.params?.item?.type === "agentMessage") {
    activeAgentMessagePhase = message.params.item.phase === "commentary" ? "commentary" : "final";
    if (activeAgentMessagePhase === "commentary") activeAgentMessage = addProcessUpdate();
    else {
      finishProcessFlow("completed");
      activeAgentMessage = addEvent("agent", "AGENT");
    }
  }
  else if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
    if (activeAgentMessage && message.params.item.text) {
      cancelScheduledAgentMarkdownRender(activeAgentMessage);
      renderAgentMarkdown(activeAgentMessage, message.params.item.text);
    }
    if (
      pendingLiveDelegation
      && message.params.item.phase !== "commentary"
      && message.params.item.text
    ) {
      finalizePendingLiveDelegation({
        threadId: eventThreadId || currentThreadId,
        finalText: message.params.item.text,
      });
    }
    activeAgentMessage = null;
    activeAgentMessagePhase = null;
  }
  else if (message.method === "item/started" && isTraceItem(message.params?.item)) {
    ensureProcessFlow();
    upsertTraceItem(message.params.item, "started");
    if (pendingLiveDelegation) {
      setLivePanel({
        title: "当前任务正在运行",
        status: "正在使用工具，详细进度已展开",
        transcript: pendingLiveDelegation.text,
        paused: true,
        phase: "delegating",
      });
    }
  }
  else if (message.method === "item/completed" && isTraceItem(message.params?.item)) {
    ensureProcessFlow();
    upsertTraceItem(message.params.item, message.params.item.status || "completed");
    void renderGeneratedImagesFromToolItem(message.params.item, eventThreadId || currentThreadId);
  }
  else if (message.method === "item/agentMessage/delta") {
    if (!activeAgentMessage) activeAgentMessage = activeAgentMessagePhase === "commentary" ? addProcessUpdate() : addEvent("agent", "AGENT");
    activeAgentMessage._markdownSource = `${activeAgentMessage._markdownSource || ""}${message.params.delta || ""}`;
    scheduleAgentMarkdownRender(activeAgentMessage);
  } else if (message.method === "item/commandExecution/outputDelta") appendToolOutput("COMMAND", message.params);
  else if (message.method === "item/mcpToolCall/progress") appendToolOutput("MCP", { ...message.params, delta: `${JSON.stringify(message.params)}\n` });
  else if (message.method === "error") addTraceError("ERROR", message.params.message || JSON.stringify(message.params));
  else if (message.method === "warning") upsertTraceItem({ type: "event", label: "WARNING", message: message.params.message || JSON.stringify(message.params), status: "completed" });
  else if (message.method === "thread/name/updated" || message.method === "thread/archived" || message.method === "thread/unarchived") loadThreads();
  else if (message.method === "turn/completed") {
    const turn = message.params?.turn;
    if (turn?.status === "failed") addTraceError("TURN FAILED", turn.error?.message || JSON.stringify(turn.error || {}));
    reconcileCurrentThreadTerminalState({
      threadId: eventThreadId || currentThreadId,
      status: turn?.status === "failed" ? "failed" : "completed",
      completedAt: turn?.completedAt || turn?.updatedAt,
      error: turn?.error?.message,
    });
    loadThreads();
    if (activeToolView === "changes") refreshGit();
  }
});

window.workbench.onSchedulerUpdated((state) => {
  schedulerState = state;
  updateNotificationBadge(state.unread || 0);
  if (!$("#scheduled-center").hidden) renderScheduler(state);
});
window.workbench.onSchedulerOpen(() => { void showScheduledCenter(); });
window.workbench.onRuntimeUpdated((state) => {
  if (activeToolView === "control" && activeControlView === "diagnostics") renderDiagnostics(state);
});
window.workbench.onPetState((state) => {
  $("#pet-toggle").classList.toggle("active", Boolean(state?.visible));
  $("#pet-toggle").title = state?.visible ? "收起 OnPeople 宠物" : "显示 OnPeople 宠物";
  if (!settingsPetPage.hidden) void refreshSettingsPet();
});
window.workbench.onPreferencesChanged(renderPreferences);
window.workbench.onCloudAccountUpdated((state) => {
  renderCloudAccount(state);
  if (!settingsVoicePage.hidden) void refreshLiveAvailability();
});
window.workbench.onLiveSidebandEvent((event = {}) => {
  if (!liveConversation || String(event.callId || "") !== String(liveConversation.callId || "")) return;
  let data = String(event.data || "");
  if (event.encoding === "base64") {
    try { data = atob(data); } catch { return; }
  }
  handleLiveDataMessage(data);
});
window.workbench.onLiveSidebandStatus((state = {}) => {
  if (!liveConversation || String(state.callId || "") !== String(liveConversation.callId || "")) return;
  if (state.state === "connected" && liveCallPanel.dataset.phase !== "delegating") {
    setLivePanel({
      title: liveCallTitle.textContent || "GPT-Live 正在聆听",
      status: "实时语音与任务协作通道已连接",
      transcript: liveCallTranscript.textContent || "你可以开始说话。",
      phase: liveCallPanel.dataset.phase || "listening",
    });
  } else if (new Set(["reconnecting", "unavailable"]).has(state.state) && liveCallPanel.dataset.phase !== "delegating") {
    setLivePanel({
      title: liveCallTitle.textContent || "GPT-Live 正在聆听",
      status: state.state === "reconnecting" ? "任务协作通道正在重新连接" : "任务协作通道暂时不可用，实时语音仍可继续",
      transcript: liveCallTranscript.textContent || "你可以继续说话。",
      phase: liveCallPanel.dataset.phase || "listening",
    });
  }
});
window.workbench.onAppUpdateState(renderAppUpdate);

window.workbench.onDeepLink((target) => {
  if (target?.type === "control" && target.view === "scheduled") void showScheduledCenter("inbox");
  else if (target?.type === "control" && target.view) void selectControlPanel(target.view);
  if (target?.type === "account") {
    if (!cloudAccountDialog.open) cloudAccountDialog.showModal();
    void refreshCloudAccount().catch(() => {});
  }
});
window.workbench.onCommandPalette(openCommandPalette);
document.addEventListener("click", closeProjectMenus);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeProjectMenus();
  if (cloudAccountDialog.open) return;
  if (!$("#scheduled-center").hidden) { closeScheduledCenter(); return; }
  if (!settingsCenter.hidden) closeSettingsCenter();
});
window.addEventListener("beforeunload", () => releaseLiveConversation());

window.workbench.agentStatus().then((status) => {
  defaultWorkspaceCwd = status.defaultCwd || "";
  if (status.ready) setRuntime("ready", "Agent 已连接");
  // Application-level runtime state can point at a task running in another
  // window. Only the window-scoped binding proves this pane rendered it.
  currentThreadId = status.windowThreadId || null;
  if (!currentThreadId) {
    selectedWorkspaceMode = "isolated";
    selectedWorkspaceBaseCwd = null;
    cwdInput.value = "";
  }
  updateProject(cwdInput.value);
  if (cwdInput.value.trim()) void refreshProjectActions();
  if (currentThreadId) threadLabel.textContent = currentThreadId.slice(0, 13).toUpperCase();
  renderGoal(status.goal);
  renderProvider(status.provider);
  computerCapability = status.capabilities?.computer || { available: Boolean(status.computerUse?.running), reason: status.computerUse?.message };
  updateProviderFields();
  if (status.policy) {
    renderPolicy({ policy: status.policy, audit: [] });
  }
  renderContext(status.context || {});
  if (status.windowThreadId) {
    return window.workbench.resumeThread(status.windowThreadId).then((result) => {
      activateThread(result);
      return loadThreads();
    });
  }
  return loadThreads();
}).catch((error) => setRuntime("error", error.message));
window.workbench.getPetState().then((state) => {
  $("#pet-toggle").classList.toggle("active", Boolean(state?.visible));
}).catch(() => {});
void refreshCloudAccount({ quiet: true }).catch(() => {});
window.workbench.getAppUpdateState().then(renderAppUpdate).catch((error) => {
  renderAppUpdate({ supported: false, status: "error", message: error.message });
});
void refreshPreferences();
void refreshScheduler();

cwdInput.addEventListener("change", (event) => {
  if (!currentThreadId) {
    selectedWorkspaceMode = event.target.value.trim() ? "local" : "isolated";
    selectedWorkspaceBaseCwd = event.target.value.trim() || null;
  }
  updateProject(event.target.value);
  void refreshProjectActions();
  resetTaskScopedUtilityState();
});
selectMode("default");
setRunning(false);
