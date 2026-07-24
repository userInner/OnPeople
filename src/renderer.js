const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const isMacOS = navigator.userAgent.includes("Macintosh");
const isWindows = navigator.userAgent.includes("Windows");
document.documentElement.classList.toggle("platform-macos", isMacOS);
document.documentElement.classList.toggle("platform-windows", isWindows);

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
const composer = $("#composer");
const promptInput = $("#prompt");
const sendButton = $("#send");
const stopButton = $("#stop");
const threadLabel = $("#thread-label");
const taskTitle = $("#task-title");
const taskList = $("#task-list");
const pinnedTaskList = $("#pinned-task-list");
const pinnedSection = $("#pinned-section");
const taskSearch = $("#task-search");
const providerSelect = $("#provider");
const modelInput = $("#model");
const modelOptions = $("#model-options");
const baseUrlInput = $("#base-url");
const apiKeyInput = $("#api-key");
const providerStatus = $("#provider-status");
const modelCapability = $("#model-capability");
const attachImageButton = $("#attach-image");
const imageAttachments = $("#image-attachments");
const capabilityMenu = $("#capability-menu");
const capabilitySelection = $("#capability-selection");
const cwdInput = $("#cwd");
const appShell = $("#app-shell");
const contentArea = $("#content-area");
const primaryWorkspace = $("#primary-workspace");
const terminalDock = $("#terminal-dock");
const terminalResizer = $("#terminal-resizer");
const workspaceResizer = $("#workspace-resizer");
const embeddedBrowser = $("#embedded-browser");
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
const goalPanel = $("#goal-panel");
const goalStatus = $("#goal-status");
const goalObjective = $("#goal-objective");
const goalUsage = $("#goal-usage");
const goalPause = $("#goal-pause");
const initialTimeline = timeline.innerHTML;
const traceFormatter = window.OnPeopleTrace;

const PROVIDER_PRESETS = {
  openai: { model: "gpt-5.6-terra", baseUrl: "https://api.openai.com/v1", vision: true, protocol: "Responses API" },
  deepseek: { model: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com", vision: false, protocol: "内嵌 Chat 适配" },
  minimax: { model: "MiniMax-M2.7", baseUrl: "https://api.minimaxi.com/v1", vision: true, protocol: "内嵌 Chat 适配" },
  kimi: { model: "kimi-k2.6", baseUrl: "https://api.moonshot.cn/v1", vision: true, protocol: "内嵌 Chat 适配" },
  grok: { model: "grok-4.5", baseUrl: "https://api.x.ai/v1", vision: true, protocol: "Responses API" },
  sub2api: {
    model: "gpt-5.6-sol",
    baseUrl: "https://sub2api.aibro.vip/v1",
    vision: true,
    protocol: "Responses API",
    models: [
      { id: "gpt-5.6-sol", name: "5.6 Sol" },
      { id: "gpt-5.6-terra", name: "5.6 Terra" },
      { id: "gpt-5.6-luna", name: "5.6 Luna" },
    ],
  },
  compatible: { model: "", baseUrl: "https://api.openai.com/v1", vision: true, protocol: "Responses API" },
  ollama: { model: "", baseUrl: "", vision: false, protocol: "本地运行时" },
  lmstudio: { model: "", baseUrl: "", vision: false, protocol: "本地运行时" },
};

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
const imagePreviewUrls = new Map();
let selectedModelVision = null;
let activeAgentMessage = null;
let running = false;
let submitting = false;
let threadSwitchSequence = 0;
let pendingThreadId = null;
let showingArchived = false;
let searchTimer = null;
let terminal = null;
let terminalFit = null;
let terminalProcessId = null;
let activeTerminalId = null;
const terminalSessions = new Map();
let terminalSequence = 0;
let terminalMenuBound = false;
let terminalCopyStatusTimer = null;
let activeToolView = "browser";
let terminalDockOpen = false;
const activeToolMessages = new Map();
const traceCards = new Map();
const generatedImageCards = new Map();
let traceSequence = 0;
let managedAgentState = [];
let policyState = null;
let auditState = [];
let contextSnapshot = null;
let activeControlView = "agents";
let pendingBrowserAnnotationTarget = null;
let currentGitState = null;
let selectedGitFile = null;
let gitBusy = false;
let currentFilePath = "";
let currentFileParent = null;
let fileSearchTimer = null;
let schedulerState = { tasks: [], runs: [], unread: 0 };
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

function updateProject(cwd) {
  const value = String(cwd || "").replace(/\/$/, "");
  const pathLabel = $("#project-path");
  const nameLabel = $("#project-name");
  if (pathLabel) pathLabel.textContent = value || "未设置工作目录";
  if (nameLabel) nameLabel.textContent = value.split("/").filter(Boolean).pop() || "Workspace";
  if (!nameLabel && $("#project-list")) renderProjects(loadedThreads);
}

function titleFrom(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > 46 ? `${clean.slice(0, 46)}…` : (clean || "未命名任务");
}

function setThreadHeader(thread = null) {
  currentThreadId = thread?.id || null;
  const title = thread ? titleFrom(thread.name || thread.preview) : "新任务";
  taskTitle.textContent = title;
  threadLabel.textContent = thread?.id ? thread.id.slice(0, 13).toUpperCase() : "NEW THREAD";
  if (thread?.cwd) {
    cwdInput.value = thread.cwd;
    updateProject(thread.cwd);
    void refreshProjectActions();
  }
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

function setUtilityVisible(visible) {
  contentArea.classList.toggle("utility-collapsed", !visible);
  updateToolButtonStates(visible);
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

async function selectToolView(view) {
  if (view === "terminal") {
    setTerminalVisible(true);
    await ensureTerminal();
    terminal?.focus();
    return;
  }
  activeToolView = view;
  setUtilityVisible(true);
  for (const panel of $$(".utility-view")) panel.classList.toggle("active", panel.dataset.view === view);
  const [title, subtitle] = TOOL_COPY[view];
  $("#utility-title").textContent = title;
  $("#utility-subtitle").textContent = subtitle;
  if (view === "changes") await refreshGit();
  if (view === "files") await refreshProjectFiles();
  if (view === "extensions") await refreshExtensions();
  if (view === "control") await refreshControl();
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
  if (!window.confirm(warning)) return;
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
  if (!renderingThreadHistory) timeline.scrollTop = timeline.scrollHeight;
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
  if (!renderingThreadHistory) timeline.scrollTop = timeline.scrollHeight;
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
  if (!renderingThreadHistory) timeline.scrollTop = timeline.scrollHeight;
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
      await window.workbench.navigate(href);
      return;
    }
    let target = decodeURIComponent(href);
    let line = 1;
    const lineMatch = target.match(/#L(\d+)$/i) || target.match(/:(\d+)$/);
    if (lineMatch) {
      line = Number(lineMatch[1]) || 1;
      target = target.slice(0, -lineMatch[0].length);
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
  return new Set(["plan", "commandExecution", "fileChange", "mcpToolCall", "reasoning", "webSearch"]).has(item.type);
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
  if (!renderingThreadHistory) timeline.scrollTop = timeline.scrollHeight;
  return card;
}

function addTraceError(label, message) {
  return upsertTraceItem({ type: "error", label, message, status: "failed" }, "failed", { open: true });
}

function resetTimeline() {
  discardProcessFlow();
  timeline.innerHTML = initialTimeline;
  pendingUserMessages.clear();
  activeAgentMessage = null;
  activeToolMessages.clear();
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
  activeToolMessages.clear();
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
  if (!timeline.children.length) timeline.innerHTML = initialTimeline;
  timeline.scrollTop = timeline.scrollHeight;
  requestAnimationFrame(() => timeline.classList.remove("instant-scroll"));
}

function threadTime(thread) {
  const stamp = Number(thread.recencyAt || thread.updatedAt || thread.createdAt || 0) * 1000;
  if (!stamp) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(stamp);
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
      cwdInput.value = project.path;
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
      if (!window.confirm(`归档“${project.name}”中的 ${project.count} 个任务？\n\n项目文件不会被修改。`)) return;
      const result = await window.workbench.archiveProjectTasks(project.path);
      if (result.archived && selectedProjectPath === project.path) selectedProjectPath = null;
      await loadThreads();
    }, { disabled: project.count < 1 });
    action("×", "移除", async () => {
      if (!window.confirm(`从 OnPeople 侧栏移除“${project.name}”？\n\n不会删除项目文件或任务历史。`)) return;
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
  const visible = selectedProjectPath ? threads.filter((thread) => thread.projectPath === selectedProjectPath) : threads;
  const pinnedThreads = showingArchived ? [] : visible.filter((thread) => thread.pinned);
  const regularThreads = showingArchived ? visible : visible.filter((thread) => !thread.pinned);
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
  try {
    const result = await window.workbench.listThreads({ search: taskSearch.value, archived: showingArchived });
    loadedThreads = result.threads || [];
    loadedProjects = result.projects || [];
    renderThreads(loadedThreads);
  } catch (error) {
    taskList.innerHTML = `<span class="empty-list">${error.message}</span>`;
  }
}

async function resumeThread(threadId) {
  if (!threadId) return;
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
  setThreadHeader(thread);
  setRunning(Boolean(result.running));
  if (result.running) setThreadRuntimeState(thread.id, "working");
  else if (result.restoring) setThreadRuntimeState(thread.id, "restoring");
  renderThreadHistory(thread);
  renderGoal(result.goal);
  loadThreads();
  promptInput.focus();
}

function updateProviderFields() {
  const preset = PROVIDER_PRESETS[providerSelect.value];
  const remote = !new Set(["ollama", "lmstudio"]).has(providerSelect.value);
  $("#base-url-wrap").hidden = !remote;
  $("#api-key-wrap").hidden = !remote;
  const vision = selectedModelVision ?? preset.vision;
  const imageGenerationButton = capabilityMenu.querySelector('[data-capability="imagegen"]');
  if (imageGenerationButton) {
    imageGenerationButton.disabled = !remote;
    imageGenerationButton.title = remote ? "" : "本地模型提供商尚未配置图片生成接口";
  }
  if (!remote && selectedCapability === "imagegen") {
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
}

function renderPresetModelOptions(preset = {}) {
  modelOptions.replaceChildren(...(preset.models || []).map((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.label = model.name;
    return option;
  }));
}

async function validateSelectedModel() {
  if (!modelInput.value.trim()) {
    selectedModelVision = null;
    updateProviderFields();
    return;
  }
  try {
    const result = await window.workbench.validateModel(providerSelect.value, modelInput.value.trim());
    selectedModelVision = Boolean(result.supported);
  } catch { selectedModelVision = null; }
  updateProviderFields();
}

function renderProvider(settings = {}) {
  providerSelect.value = settings.type || "openai";
  renderPresetModelOptions(PROVIDER_PRESETS[providerSelect.value]);
  modelInput.value = settings.model || "";
  baseUrlInput.value = settings.baseUrl || "https://api.openai.com/v1";
  apiKeyInput.value = "";
  apiKeyInput.placeholder = settings.hasApiKey ? "已加密保存；留空保持不变" : "可选，取决于服务端";
  providerStatus.textContent = settings.hasApiKey ? "API Key 已按提供商加密保存" : "未保存 API Key";
  selectedModelVision = settings.vision ?? null;
  void validateSelectedModel();
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

function appendToolOutput(kind, params) {
  ensureProcessFlow();
  const key = String(params.itemId || params.processId || `${kind}:current`);
  const type = kind === "COMMAND" ? "commandExecution" : "mcpToolCall";
  const card = upsertTraceItem({ id: key, type, command: params.command, tool: params.tool, server: params.server, status: "inProgress" }, "started", { open: true });
  card._traceOutput = traceFormatter.truncateTraceText(`${card._traceOutput || ""}${params.delta || ""}`);
  renderTraceCard(card, card._traceItem, "started", { open: true });
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
  timeline.scrollTop = timeline.scrollHeight;
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
  promptInput.placeholder = mode === "goal" ? "描述可验证的结果、约束和完成标准。" : mode === "plan" ? "描述任务；Agent 会先调查并生成实施计划。" : "描述一个任务…";
}

function setRunning(value) {
  running = value;
  // A running turn still accepts a follow-up from the composer. The main
  // process routes it through turn/steer; Stop remains a separate action.
  sendButton.disabled = submitting;
  stopButton.disabled = !value;
  promptInput.disabled = false;
  promptInput.placeholder = value ? "补充指令；发送后会加入当前运行任务…" : (
    selectedMode === "goal" ? "描述可验证的结果、约束和完成标准。" :
      selectedMode === "plan" ? "描述任务；Agent 会先调查并生成实施计划。" :
        "描述一个任务…"
  );
  for (const option of modeOptions) option.disabled = value;
  goalBudgetMode.disabled = value;
  goalBudget.disabled = value;
  updateProviderFields();
}

function setSubmitting(value) {
  submitting = Boolean(value);
  sendButton.disabled = submitting;
  if (!running) {
    promptInput.placeholder = submitting ? "正在确认消息已进入任务…"
      : (selectedMode === "goal" ? "描述可验证的结果、约束和完成标准。" :
        selectedMode === "plan" ? "描述任务；Agent 会先调查并生成实施计划。" :
          "描述一个任务…");
  }
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
  const duplicates = [...terminalSessions.values()].filter((session) => session.baseTitle === base).length;
  return duplicates ? `${base} ${duplicates + 1}` : base;
}

function activateTerminalSession(processId, { focus = true } = {}) {
  const session = terminalSessions.get(processId);
  if (!session) return;
  activeTerminalId = processId;
  terminal = session.terminal;
  terminalFit = session.fit;
  terminalProcessId = session.exited ? null : processId;
  for (const item of terminalSessions.values()) {
    const active = item.processId === processId;
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
    terminalFit = null;
    terminalProcessId = null;
    if (replacement) activateTerminalSession(replacement.processId);
    else setTerminalVisible(false);
  }
}

function createTerminalSession(processId, cwd) {
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
    void selectToolView("browser").then(() => window.workbench.navigate(uri));
  }));
  instance.open(host);
  instance.options.theme = terminalTheme;
  instance.element.style.color = terminalTheme.foreground;
  instance.element.style.backgroundColor = terminalTheme.background;

  const session = {
    processId,
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
  if (!activeTerminalId || terminalSessions.get(activeTerminalId)?.exited) await startTerminal();
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
    const type = text.startsWith("+") && !text.startsWith("+++") ? "add" : text.startsWith("-") && !text.startsWith("---") ? "remove" : text.startsWith("diff ") || text.startsWith("# ") || text.startsWith("---") || text.startsWith("+++") ? "header" : "context";
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
  card.addEventListener("click", () => { reviewComments.delete(key); updateReviewCommentControls(); card.replaceWith(commentComposer(comment)); });
  return card;
}

function commentComposer(comment) {
  const key = reviewKey(comment.path, comment.line, comment.side);
  const composer = document.createElement("div"); composer.className = "diff-comment-composer";
  const textarea = document.createElement("textarea"); textarea.placeholder = `评论 ${comment.path}:${comment.line}`; textarea.value = comment.body || "";
  const actions = document.createElement("div"); actions.className = "diff-comment-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消";
  const save = document.createElement("button"); save.type = "button"; save.className = "primary"; save.textContent = "保存评论";
  cancel.addEventListener("click", () => composer.remove());
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
  if (action === "restore" && !window.confirm(`还原 ${selectedGitFile} 中这个代码块的修改？\n\n这部分修改将无法从 OnPeople 恢复。`)) return;
  setGitBusy(true);
  try {
    const result = await window.workbench.mutateGitHunk({ cwd: cwdInput.value.trim(), path: selectedGitFile, area: hunk.area, hunkId: hunk.id, action });
    currentGitState = result.state;
    renderGitFiles(currentGitState);
    if (result.hunks.staged.length || result.hunks.unstaged.length) renderGitHunks(result.hunks);
    else { selectedGitFile = null; renderDiff(currentGitState.diff); }
  } catch (error) { addEvent("error", "GIT HUNK", error.message); }
  finally { setGitBusy(false); if (currentGitState) renderGitFiles(currentGitState); }
}

function gitFileAction(label, action, item, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.classList.toggle("danger", danger);
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (gitBusy) return;
    if (action === "restore" && !window.confirm(`还原 ${item.path} 的未暂存修改？\n\n这部分修改将无法从 OnPeople 恢复。`)) return;
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
  $("#git-summary").textContent = "正在读取 Git 状态…";
  setGitBusy(true);
  try {
    const state = await window.workbench.getGitState(cwdInput.value.trim());
    currentGitState = state;
    hideGitEmptyState();
    $("#git-branch").textContent = state.branch;
    $("#git-root").textContent = state.root;
    if (selectedGitFile && !state.files.some((item) => item.path === selectedGitFile)) selectedGitFile = null;
    renderGitFiles(state);
    if (selectedGitFile) {
      const hunks = await window.workbench.getGitHunks(cwdInput.value.trim(), selectedGitFile);
      if (hunks.staged.length || hunks.unstaged.length) renderGitHunks(hunks);
      else renderDiff((await window.workbench.getGitDiff(cwdInput.value.trim(), selectedGitFile)).diff);
    } else renderDiff(state.diff);
  } catch (error) {
    currentGitState = null;
    $("#git-branch").textContent = "Git";
    $("#git-root").textContent = cwdInput.value.trim() || "未选择项目";
    $("#git-summary").textContent = "Git 尚未就绪";
    $("#git-upstream").textContent = "—";
    showGitEmptyState(error);
  } finally {
    setGitBusy(false);
    if (currentGitState) renderGitFiles(currentGitState);
    else for (const button of $$("#git-stage-all, #git-unstage-all, #git-commit, #git-push, #git-prepare-pr")) button.disabled = true;
  }
}

async function runGitMutation(action, filePath = null) {
  if (gitBusy) return;
  setGitBusy(true);
  try {
    currentGitState = await window.workbench.mutateGit({ cwd: cwdInput.value.trim(), action, path: filePath });
    if (selectedGitFile && !currentGitState.files.some((item) => item.path === selectedGitFile)) selectedGitFile = null;
    renderGitFiles(currentGitState);
    if (selectedGitFile) {
      const hunks = await window.workbench.getGitHunks(cwdInput.value.trim(), selectedGitFile);
      if (hunks.staged.length || hunks.unstaged.length) renderGitHunks(hunks);
      else renderDiff((await window.workbench.getGitDiff(cwdInput.value.trim(), selectedGitFile)).diff);
    } else renderDiff(currentGitState.diff);
  } catch (error) { addEvent("error", "GIT", error.message); }
  finally { setGitBusy(false); if (currentGitState) renderGitFiles(currentGitState); }
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
  const activeList = $(".extension-list.active");
  if (activeList) activeList.innerHTML = '<span class="empty-list">正在刷新扩展…</span>';
  try {
    const data = await window.workbench.listExtensions(cwdInput.value.trim());
    renderSkills(data.skills || []);
    renderPlugins(data.plugins || []);
    renderMcp(data.mcpServers || []);
    const errors = $("#extension-errors");
    errors.hidden = !(data.errors || []).length;
    errors.textContent = (data.errors || []).join("\n");
  } catch (error) {
    $("#extension-errors").hidden = false;
    $("#extension-errors").textContent = error.message;
  }
}

function renderSkills(skills) {
  const list = $("#skills-list");
  list.replaceChildren();
  if (!skills.length) list.innerHTML = '<span class="empty-list">当前目录没有发现 Skills</span>';
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
      `${skill.scope} · ${skill.path}`,
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

function renderAgents(agents = managedAgentState, maxAgents = policyState?.maxAgents || 4) {
  managedAgentState = agents;
  const activeStatuses = new Set(["starting", "running", "waitingOnApproval", "waitingOnUserInput"]);
  const active = agents.filter((agent) => activeStatuses.has(agent.status)).length;
  $("#agent-capacity").textContent = `${active} / ${maxAgents} ACTIVE`;
  const list = $("#agent-list");
  list.replaceChildren();
  if (!agents.length) list.innerHTML = '<span class="control-empty">没有子 Agent。需要并行处理时，直接在对话中说明如何分工。</span>';
  for (const group of [{ label: "Active", items: agents.filter((agent) => activeStatuses.has(agent.status)) }, { label: "Done", items: agents.filter((agent) => !activeStatuses.has(agent.status)) }]) {
    if (!group.items.length) continue;
    const heading = document.createElement("div"); heading.className = "agent-list-section"; heading.textContent = `${group.label} · ${group.items.length}`; list.append(heading);
    for (const agent of group.items) {
      const card = controlCard(agent.name, agent.status, agent.prompt, `${agent.role} · ${agent.model || "继承模型"} · ${agent.effort} · ${agent.threadId?.slice(0, 12) || "starting"}`);
      const actions = document.createElement("div"); actions.className = "control-card-actions";
      const inspect = document.createElement("button"); inspect.type = "button"; inspect.textContent = group.label === "Active" ? "查看进度" : "查看结果";
      inspect.addEventListener("click", async () => {
        try {
          const result = await window.workbench.readAgent(agent.id);
          const messages = (result.thread.turns || []).flatMap((turn) => turn.items || []).filter((item) => item.type === "agentMessage" && item.text);
          addEvent("agent", `SUBAGENT · ${agent.name}`, messages.at(-1)?.text || "暂时没有可显示的结果。");
        } catch (error) { addEvent("error", "SUBAGENT", error.message); }
      });
      actions.append(inspect);
      if (group.label === "Active") {
        const stop = document.createElement("button"); stop.type = "button"; stop.className = "danger-outline"; stop.textContent = "停止";
        stop.addEventListener("click", async () => { await window.workbench.stopAgent(agent.id); await refreshAgents(); });
        actions.append(stop);
      }
      card.append(actions); list.append(card);
    }
  }
}

async function refreshAgents() {
  try {
    const [result, profileResult] = await Promise.all([window.workbench.listAgents(), window.workbench.listAgentProfiles()]);
    renderAgentProfiles(profileResult.profiles || []);
    renderAgents(result.agents || [], result.maxAgents);
  } catch (error) { $("#agent-list").innerHTML = `<span class="control-empty">${escapeHtml(error.message)}</span>`; }
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
    remove.addEventListener("click", async () => { if (window.confirm(`删除安全变量 ${secret.name}？`)) { await window.workbench.deleteSecret(secret.id); await refreshSecrets(); } });
    actions.append(edit, remove); card.append(actions); list.append(card);
  }
}

async function refreshSecrets() { try { renderSecrets(await window.workbench.listSecrets()); } catch (error) { $("#secret-list").textContent = error.message; } }

function renderWorktrees(result) {
  $("#worktree-root").textContent = result.root;
  const list = $("#worktree-list");
  list.replaceChildren();
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
        if (!window.confirm(`保存补丁快照并清理这个 Worktree？\n${worktree.path}`)) return;
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
  catch (error) { $("#worktree-root").textContent = error.message; $("#worktree-list").replaceChildren(); }
}

function renderContext(state) {
  contextSnapshot = state;
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
  renderAgents(managedAgentState, policyState.maxAgents);
}

async function refreshPolicy() {
  try { renderPolicy(await window.workbench.getPolicy()); }
  catch (error) { addEvent("error", "POLICY", error.message); }
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
      try { await selectToolView("browser"); await window.workbench.openWorkspaceFile(cwdInput.value.trim(), item.path); }
      catch (error) { addEvent("error", "FILE OPEN", error.message); }
    });
    list.append(row);
  }
}

async function refreshProjectFiles() {
  const search = $("#files-search").value.trim();
  try {
    const result = search ? await window.workbench.searchProjectFiles(cwdInput.value.trim(), search) : await window.workbench.listProjectFiles(cwdInput.value.trim(), currentFilePath);
    if (search) {
      const previousPath = currentFilePath; const previousParent = currentFileParent;
      renderProjectFiles({ ...result, path: `搜索：${search}`, parent: null });
      currentFilePath = previousPath; currentFileParent = previousParent;
    } else renderProjectFiles(result);
  } catch (error) { $("#project-file-list").innerHTML = `<span class="file-empty">${escapeHtml(error.message)}</span>`; }
}

function scheduleLabel(schedule) {
  if (schedule.kind === "interval") return `每 ${schedule.intervalMinutes} 分钟`;
  if (schedule.kind === "daily") return `每天 ${schedule.time}`;
  if (schedule.kind === "rrule") return `RRULE · ${schedule.rule}`;
  return `每周${["日", "一", "二", "三", "四", "五", "六"][schedule.day]} ${schedule.time}`;
}

function updateNotificationBadge(unread = 0) {
  const count = $("#notification-count"); count.hidden = unread < 1; count.textContent = unread > 99 ? "99+" : String(unread);
}

function renderScheduler(state) {
  schedulerState = state || { tasks: [], runs: [], unread: 0 };
  const threadOption = $("#scheduled-destination option[value=thread]");
  threadOption.disabled = !currentThreadId;
  threadOption.textContent = currentThreadId ? `续跑当前会话 · ${currentThreadId.slice(0, 8)}` : "续跑当前会话 · 尚无会话";
  if (!currentThreadId && $("#scheduled-destination").value === "thread") $("#scheduled-destination").value = "standalone";
  updateNotificationBadge(schedulerState.unread || 0);
  const tasks = $("#scheduled-task-list"); tasks.replaceChildren();
  const active = schedulerState.tasks.filter((task) => task.enabled).length;
  $("#scheduled-count").textContent = `${active} ACTIVE`;
  if (!schedulerState.tasks.length) tasks.innerHTML = '<span class="control-empty">还没有计划任务。</span>';
  for (const task of schedulerState.tasks) {
    const destination = task.destination?.mode === "thread" ? `续跑 ${task.destination.threadId?.slice(0, 8)}` : "新会话";
    const execution = task.execution?.mode === "worktree" ? `Worktree${task.worktreePath ? ` · ${task.worktreePath}` : ""}` : "当前工作区";
    const card = controlCard(task.name, task.enabled ? "active" : "paused", task.prompt, `${scheduleLabel(task.schedule)} · ${destination} · ${execution} · 下次 ${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "已暂停或已结束"}`);
    const actions = document.createElement("div"); actions.className = "control-card-actions";
    const run = document.createElement("button"); run.type = "button"; run.textContent = "立即运行";
    run.addEventListener("click", async () => { run.disabled = true; try { renderScheduler(await window.workbench.runScheduledTask(task.id)); } catch (error) { addEvent("error", "SCHEDULED", error.message); } finally { run.disabled = false; } });
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = task.enabled ? "暂停" : "恢复";
    toggle.addEventListener("click", async () => renderScheduler(await window.workbench.updateScheduledTask(task.id, { enabled: !task.enabled })));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger-outline"; remove.textContent = "删除";
    remove.addEventListener("click", async () => { if (window.confirm(`删除计划任务“${task.name}”？`)) renderScheduler(await window.workbench.deleteScheduledTask(task.id)); });
    actions.append(run, toggle, remove); card.append(actions); tasks.append(card);
  }
  const runs = $("#scheduled-run-list"); runs.replaceChildren();
  if (!schedulerState.runs.length) runs.innerHTML = '<span class="control-empty">还没有运行记录。</span>';
  for (const item of schedulerState.runs.slice(0, 50)) {
    const row = document.createElement("article"); row.className = `scheduled-run ${item.status}${item.read ? "" : " unread"}`;
    const header = document.createElement("header"); const title = document.createElement("strong"); title.textContent = `${item.taskName} · ${item.status === "completed" ? "已完成" : item.status === "failed" ? "失败" : "运行中"}`;
    const time = document.createElement("time"); time.textContent = new Date(item.completedAt || item.startedAt).toLocaleString(); header.append(title, time);
    const copy = document.createElement("p"); copy.textContent = item.error || item.summary || (item.status === "running" ? "任务正在独立线程中执行…" : "没有摘要");
    row.append(header, copy); row.addEventListener("click", async () => { if (!item.read) renderScheduler(await window.workbench.markScheduledNotificationsRead(item.id)); }); runs.append(row);
  }
}

async function refreshScheduler() {
  try { renderScheduler(await window.workbench.listScheduledTasks()); }
  catch (error) { $("#scheduled-task-list").innerHTML = `<span class="control-empty">${escapeHtml(error.message)}</span>`; }
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
  else if (activeControlView === "scheduled") await refreshScheduler();
  else if (activeControlView === "config") await refreshEffectiveConfig();
  else if (activeControlView === "memory") await refreshMemories();
  else if (activeControlView === "usage") await refreshUsage();
  else if (activeControlView === "secrets") await refreshSecrets();
}

providerSelect.addEventListener("change", () => {
  const preset = PROVIDER_PRESETS[providerSelect.value];
  modelInput.value = preset.model;
  baseUrlInput.value = preset.baseUrl;
  selectedModelVision = null;
  renderPresetModelOptions(preset);
  void validateSelectedModel();
});
modelInput.addEventListener("change", validateSelectedModel);

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
    const result = await window.workbench.saveProvider({ type: providerSelect.value, model: modelInput.value.trim(), baseUrl: baseUrlInput.value.trim(), apiKey: apiKeyInput.value });
    renderProvider(result.settings);
    providerStatus.textContent = result.reconnected
      ? `已切换至 ${result.settings.model}；当前任务已重新连接`
      : (result.changed ? `已切换至 ${result.settings.model}` : "模型配置已保存");
  } catch (error) { providerStatus.textContent = error.message; }
  finally { button.disabled = false; }
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

$("#project-add").addEventListener("click", async () => {
  const button = $("#project-add");
  button.disabled = true;
  try {
    const project = await window.workbench.pickProject(cwdInput.value.trim());
    if (!project?.path) return;
    cwdInput.value = project.path;
    selectedProjectPath = project.path;
    await loadThreads();
    await refreshProjectActions();
    currentFilePath = "";
    if (activeToolView === "changes") await refreshGit();
    if (activeToolView === "files") await refreshProjectFiles();
    promptInput.focus();
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

async function startFreshTask() {
  try {
    if (running && currentThreadId) setThreadRuntimeState(currentThreadId, "working");
    await window.workbench.newTask();
    setRunning(false);
    setThreadHeader(null);
    resetTimeline();
    renderGoal(null);
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
      if (item.kind === "file") await window.workbench.openWorkspaceFile(cwdInput.value.trim(), item.path);
      else await window.workbench.navigate(item.url);
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
    const suggestions = await window.workbench.getQuickLauncherSuggestions(cwdInput.value.trim());
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
    void selectToolView("browser").then(() => address.focus());
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
  activeControlView = view;
  for (const item of $$('[data-control-view]')) item.classList.toggle("active", item.dataset.controlView === view);
  if (new Set(["worktrees", "context", "policy", "config", "memory", "usage", "secrets", "hooks"]).has(view)) $("#control-advanced-select").value = view;
  for (const panel of $$('[data-control-panel]')) panel.classList.toggle("active", panel.dataset.controlPanel === view);
  return selectToolView("control").then(refreshControl);
}

function paletteCandidates() {
  const tool = (id, label, hint = "工具") => ({ icon: label[0], label, hint, run: () => selectToolView(id) });
  const control = (id, label) => ({ icon: "⚙", label, hint: "控制中心", run: () => selectControlPanel(id) });
  return [
    { icon: "+", label: "新建任务", hint: "当前窗口", shortcut: isMacOS ? "⌥⌘S" : "Ctrl+Alt+S", run: startFreshTask },
    { icon: "↗", label: "在新窗口新建任务", hint: "并行窗口", run: () => window.workbench.openTaskWindow(null) },
    { icon: "●", label: "显示 / 收起宠物", hint: "桌面任务状态", run: () => window.workbench.togglePet() },
    tool("browser", "浏览器"), tool("terminal", "终端"), tool("changes", "Git 变更"), tool("files", "项目文件"), tool("extensions", "扩展"),
    control("agents", "Agents"), control("scheduled", "Scheduled Tasks"), control("diagnostics", "诊断中心"),
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
  if (!window.confirm("清除当前目标？目标的自动续跑将停止。")) return;
  try { await window.workbench.updateGoal(currentThreadId, "clear"); renderGoal(null); }
  catch (error) { addEvent("error", "GOAL", error.message); }
});

embeddedBrowser.addEventListener("dom-ready", async () => {
  try { await window.workbench.attachBrowser(embeddedBrowser.getWebContentsId()); }
  catch (error) { addEvent("error", "BROWSER", error.message); }
}, { once: true });
let addressNavigationPending = false;

async function submitAddress() {
  const value = address.value.trim();
  if (!value || addressNavigationPending) return;
  addressNavigationPending = true;
  address.setAttribute("aria-busy", "true");
  try {
    const result = await window.workbench.navigate(value);
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
$("#back").addEventListener("click", () => window.workbench.back());
$("#forward").addEventListener("click", () => window.workbench.forward());
$("#reload").addEventListener("click", () => window.workbench.reload());

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

async function refreshBrowserAnnotations({ open = false } = {}) {
  const result = await window.workbench.listBrowserAnnotations();
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
      await window.workbench.deleteBrowserAnnotation(annotation.id);
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
    const result = await window.workbench.captureBrowserVisualSnapshot();
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
    const result = await window.workbench.inspectBrowserDeveloperState();
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
    const target = await window.workbench.beginBrowserAnnotation();
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
  await window.workbench.cancelBrowserAnnotation();
}

$("#browser-annotation-cancel").addEventListener("click", () => { void cancelBrowserAnnotation(); });
$("#browser-annotation-composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = $("#browser-annotation-note").value.trim();
  if (!note || !pendingBrowserAnnotationTarget) return;
  const button = $("#browser-annotation-save");
  button.disabled = true;
  try {
    await window.workbench.saveBrowserAnnotation({ ...pendingBrowserAnnotationTarget, note });
    pendingBrowserAnnotationTarget = null;
    $("#browser-annotation-composer").hidden = true;
    await refreshBrowserAnnotations({ open: true });
  } catch (error) { addEvent("error", "BROWSER ANNOTATION", error.message); }
  finally { button.disabled = false; }
});

$("#browser-inspector-close").addEventListener("click", () => { $("#browser-inspector").hidden = true; });
$("#browser-fill-credential").addEventListener("click", async () => {
  try {
    const result = await window.workbench.fillSavedBrowserCredential();
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
    const summary = await window.workbench.getBrowserSessionStatus();
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
    });
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
  try { await window.workbench.openBrowserSignIn("google"); }
  catch (error) { addEvent("error", "BROWSER ACCOUNT", error.message); }
});
$("#google-session-clear").addEventListener("click", async () => {
  if (!window.confirm("清除 OnPeople 浏览器中的 Google、Gmail、Drive、Docs、Calendar 和 YouTube 会话数据？这会让相关网站退出登录。")) return;
  try { await window.workbench.clearBrowserSession("google"); await refreshBrowserAccount(); }
  catch (error) { $("#browser-account-status").textContent = error.message; }
});
$("#browser-data-clear").addEventListener("click", async () => {
  if (!window.confirm("清除 OnPeople 内嵌浏览器的全部 Cookie、站点存储、Service Worker 和缓存？所有网站都会退出登录。")) return;
  try { await window.workbench.clearAllBrowserData(); await refreshBrowserAccount(); }
  catch (error) { $("#browser-account-status").textContent = error.message; }
});

$("#terminal-new").addEventListener("click", startTerminal);

$("#git-refresh").addEventListener("click", refreshGit);
$("#git-choose-project").addEventListener("click", () => $("#project-add").click());
$("#git-init-repository").addEventListener("click", async () => {
  const cwd = cwdInput.value.trim();
  if (!cwd) return;
  if (!window.confirm(`在当前项目中初始化 Git 仓库？\n\n${cwd}\n\n这会创建 .git 文件夹，不会提交或上传任何文件。`)) return;
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
  if (!window.confirm(`推送 ${currentGitState.branch} 到 ${destination}？\n\n这会修改远程仓库。`)) return;
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
    await window.workbench.navigate(result.url);
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
    if (result?.threadId) { currentThreadId = result.threadId; threadLabel.textContent = result.threadId.slice(0, 13).toUpperCase(); }
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
  if (!expanded && new Set(["worktrees", "context", "policy", "config", "memory", "usage", "secrets", "hooks"]).has(activeControlView)) $("[data-control-view=agents]").click();
});
$("#control-advanced-select").addEventListener("change", (event) => { if (event.target.value) void selectControlPanel(event.target.value); });
$("#agent-advanced-open").addEventListener("click", () => { $("#agent-create").hidden = false; $("#agent-advanced-open").hidden = true; $("#agent-name").focus(); });
$("#agent-advanced-close").addEventListener("click", () => { $("#agent-create").hidden = true; $("#agent-advanced-open").hidden = false; });
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
  const id = $("#profile-agent-id").value; if (!id || !window.confirm("删除这个自定义 Agent？")) return;
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

function showScheduledCenter() {
  activeControlView = "scheduled";
  for (const item of $$('[data-control-view]')) item.classList.toggle("active", item.dataset.controlView === "scheduled");
  for (const panel of $$('[data-control-panel]')) panel.classList.toggle("active", panel.dataset.controlPanel === "scheduled");
  return selectToolView("control").then(refreshScheduler);
}

$("#notification-center").addEventListener("click", showScheduledCenter);
$("#scheduled-kind").addEventListener("change", () => {
  const kind = $("#scheduled-kind").value;
  $("#scheduled-time-wrap").hidden = kind === "interval" || kind === "rrule";
  $("#scheduled-day-wrap").hidden = kind !== "weekly";
  $("#scheduled-interval-wrap").hidden = kind !== "interval";
  $("#scheduled-rrule-wrap").hidden = kind !== "rrule";
});
$("#scheduled-create").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const kind = $("#scheduled-kind").value;
  const schedule = kind === "rrule" ? { kind, rule: $("#scheduled-rrule").value } : kind === "interval" ? { kind, intervalMinutes: Number($("#scheduled-interval").value) } : kind === "weekly" ? { kind, day: Number($("#scheduled-day").value), time: $("#scheduled-time").value } : { kind, time: $("#scheduled-time").value };
  try {
    const destinationMode = $("#scheduled-destination").value;
    if (destinationMode === "thread" && !currentThreadId) throw new Error("当前没有可续跑的会话");
    renderScheduler(await window.workbench.createScheduledTask({
      name: $("#scheduled-name").value, prompt: $("#scheduled-prompt").value, cwd: cwdInput.value.trim(), schedule,
      destination: { mode: destinationMode, threadId: destinationMode === "thread" ? currentThreadId : null },
      execution: { mode: $("#scheduled-execution").value, ref: "HEAD" },
    }));
    $("#scheduled-name").value = ""; $("#scheduled-prompt").value = "";
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
    await window.workbench.spawnAgent({
      name: $("#agent-name").value.trim(), role: $("#agent-role").value,
      model: $("#agent-model").value.trim(), effort: $("#agent-effort").value,
      prompt, cwd: cwdInput.value.trim(),
      profileId: $("#agent-profile").value,
      instructions: agentProfiles.find((profile) => profile.id === $("#agent-profile").value)?.instructions || "",
      sandbox: agentProfiles.find((profile) => profile.id === $("#agent-profile").value)?.sandbox || "inherit",
    });
    $("#agent-prompt").value = "";
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
  if (!window.confirm("压缩当前任务上下文？原始任务历史仍保留，但模型后续会使用压缩摘要。")) return;
  try { await window.workbench.compactContext(); addEvent("tool", "CONTEXT", "已开始压缩当前任务上下文。"); }
  catch (error) { addEvent("error", "CONTEXT", error.message); }
});

$("#policy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const sandbox = $("#policy-sandbox").value;
  const approvalPolicy = $("#policy-approval").value;
  if ((sandbox === "danger-full-access" || approvalPolicy === "never") && !window.confirm("该策略会显著减少安全边界。确认应用到当前任务和后续任务？")) return;
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
  if (selected === "full_access" && !window.confirm("完全访问会移除文件系统与网络沙箱，并停止命令、文件和普通工具的审批提示。公开发布、购买或删除外部数据仍需明确意图。确认继续？")) {
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
  if (!command || !window.confirm(`保存这个命令 Hook？保存后仍需按哈希审阅信任。\n\n${command}`)) return;
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
  if (!address.matches(":focus")) address.value = state.url?.startsWith("data:") ? "" : (state.url || "");
  permission.className = `site-permission ${state.approved ? "approved" : ""}`;
  permission.querySelector("span").textContent = state.approved ? `${state.host} 已批准` : "域名未批准";
  $("#back").disabled = !state.canGoBack;
  $("#forward").disabled = !state.canGoForward;
  void refreshBrowserAnnotations().catch(() => {});
});

window.workbench.onAgentBrowserNavigation(() => {
  void selectToolView("browser");
});

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
  taskTitle.textContent = titleFrom(prompt);
  const clientMessageId = crypto.randomUUID();
  addEvent("user", "YOU", prompt, { clientMessageId, deliveryStatus: "pending" });
  promptInput.value = "";
  activeAgentMessage = null;
  setSubmitting(true);
  try {
    const common = { threadId: currentThreadId, clientMessageId, cwd: cwdInput.value.trim(), modelProvider: providerSelect.value, model: modelInput.value.trim(), baseUrl: baseUrlInput.value.trim(), apiKey: apiKeyInput.value };
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
stopButton.addEventListener("click", async () => {
  await window.workbench.interrupt(currentThreadId);
  setThreadRuntimeState(currentThreadId, "stopped");
  setRunning(false);
});

window.workbench.onAgentEvent((event) => {
  if (event.type === "thread-lifecycle") {
    const phase = event.state?.phase || "idle";
    const presentation = phase === "running" ? "working" : phase;
    setThreadRuntimeState(event.threadId, presentation);
    if (event.threadId === currentThreadId && new Set(["idle", "failed"]).has(phase)) setRunning(false);
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
  if (event.type === "thread-recovered") { currentThreadId = event.threadId; threadLabel.textContent = event.threadId.slice(0, 13).toUpperCase(); return; }
  if (event.type === "goal-state") { renderGoal(event.goal); return; }
  if (event.type === "agents-updated") { renderAgents(event.agents || []); return; }
  if (event.type === "agent-handoff") {
    const agent = event.agent || {};
    const body = agent.error || agent.summary || `${agent.name || "子 Agent"} 已结束，但没有返回摘要。`;
    addEvent(agent.error ? "error" : "agent", `子 Agent · ${agent.name || agent.role || "Worker"}`, body);
    return;
  }
  if (event.type === "context-updated") { if (!event.state?.threadId || event.state.threadId === currentThreadId) renderContext(event.state); return; }
  if (event.type === "context-compacted") { if (activeToolView === "control" && activeControlView === "context") refreshContext(); return; }
  if (event.type === "queued-message-started") { addEvent("user", "QUEUED", event.message.text); renderContext(event.state); setRunning(true); return; }
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
  if (eventThreadId && managedAgentState.some((agent) => agent.threadId === eventThreadId)) return;
  if (message.method === "turn/started") {
    currentTurnStartedAt = Date.now();
    setThreadRuntimeState(eventThreadId || currentThreadId, "working");
    setRunning(true);
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
    if (activeAgentMessage && message.params.item.text) renderAgentMarkdown(activeAgentMessage, message.params.item.text);
    activeAgentMessage = null;
    activeAgentMessagePhase = null;
  }
  else if (message.method === "item/started" && isTraceItem(message.params?.item)) {
    ensureProcessFlow();
    upsertTraceItem(message.params.item, "started");
  }
  else if (message.method === "item/completed" && isTraceItem(message.params?.item)) {
    ensureProcessFlow();
    upsertTraceItem(message.params.item, message.params.item.status || "completed");
    void renderGeneratedImagesFromToolItem(message.params.item, eventThreadId || currentThreadId);
  }
  else if (message.method === "item/agentMessage/delta") {
    if (!activeAgentMessage) activeAgentMessage = activeAgentMessagePhase === "commentary" ? addProcessUpdate() : addEvent("agent", "AGENT");
    renderAgentMarkdown(activeAgentMessage, `${activeAgentMessage._markdownSource || ""}${message.params.delta || ""}`);
    timeline.scrollTop = timeline.scrollHeight;
  } else if (message.method === "item/commandExecution/outputDelta") appendToolOutput("COMMAND", message.params);
  else if (message.method === "item/mcpToolCall/progress") appendToolOutput("MCP", { ...message.params, delta: `${JSON.stringify(message.params)}\n` });
  else if (message.method === "error") addTraceError("ERROR", message.params.message || JSON.stringify(message.params));
  else if (message.method === "warning") upsertTraceItem({ type: "event", label: "WARNING", message: message.params.message || JSON.stringify(message.params), status: "completed" });
  else if (message.method === "thread/name/updated" || message.method === "thread/archived" || message.method === "thread/unarchived") loadThreads();
  else if (message.method === "turn/completed") {
    const turn = message.params?.turn;
    if (turn?.status === "failed") addTraceError("TURN FAILED", turn.error?.message || JSON.stringify(turn.error || {}));
    finishProcessFlow(turn?.status === "failed" ? "failed" : "completed", { finishedAt: turn?.completedAt || turn?.updatedAt });
    currentTurnStartedAt = null;
    setThreadRuntimeState(eventThreadId || currentThreadId, turn?.status === "failed" ? "failed" : "completed");
    setRunning(false);
    activeAgentMessage = null;
    activeToolMessages.clear();
    loadThreads();
    if (activeToolView === "changes") refreshGit();
  }
});

window.workbench.onSchedulerUpdated((state) => {
  schedulerState = state;
  updateNotificationBadge(state.unread || 0);
  if (activeToolView === "control" && activeControlView === "scheduled") renderScheduler(state);
});
window.workbench.onSchedulerOpen(() => { void showScheduledCenter(); });
window.workbench.onRuntimeUpdated((state) => {
  if (activeToolView === "control" && activeControlView === "diagnostics") renderDiagnostics(state);
});
window.workbench.onPetState((state) => {
  $("#pet-toggle").classList.toggle("active", Boolean(state?.visible));
  $("#pet-toggle").title = state?.visible ? "收起 OnPeople 宠物" : "显示 OnPeople 宠物";
});

window.workbench.onDeepLink((target) => {
  if (target?.type === "control" && target.view) void selectControlPanel(target.view);
});
window.workbench.onCommandPalette(openCommandPalette);
document.addEventListener("click", closeProjectMenus);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeProjectMenus(); });

window.workbench.agentStatus().then((status) => {
  cwdInput.value ||= status.defaultCwd || "";
  updateProject(cwdInput.value);
  void refreshProjectActions();
  if (status.ready) setRuntime("ready", "Agent 已连接");
  // Application-level runtime state can point at a task running in another
  // window. Only the window-scoped binding proves this pane rendered it.
  currentThreadId = status.windowThreadId || null;
  if (currentThreadId) threadLabel.textContent = currentThreadId.slice(0, 13).toUpperCase();
  renderGoal(status.goal);
  renderProvider(status.provider);
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

cwdInput.addEventListener("change", (event) => { updateProject(event.target.value); void refreshProjectActions(); currentFilePath = ""; if (activeToolView === "changes") refreshGit(); if (activeToolView === "files") refreshProjectFiles(); });
selectMode("default");
setRunning(false);
