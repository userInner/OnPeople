const { app, BrowserWindow, ipcMain, webContents } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const readline = require("node:readline");

const APP_ROOT = path.resolve(__dirname, "..");
const MCP_SCRIPT = path.join(__dirname, "browser-mcp.cjs");
const COMPUTER_USE_TOOLS = [
  "check_permissions",
  "start_session",
  "end_session",
  "get_session_state",
  "get_agent_cursor_state",
  "get_accessibility_tree",
  "list_apps",
  "list_windows",
  "get_window_state",
  "launch_app",
  "click",
  "double_click",
  "right_click",
  "type_text",
  "press_key",
  "hotkey",
  "scroll",
  "drag",
  "set_value",
  "move_cursor",
];
const COMPUTER_USE_READ_TOOLS = [
  "check_permissions",
  "start_session",
  "end_session",
  "get_session_state",
  "get_agent_cursor_state",
  "get_accessibility_tree",
  "list_apps",
  "list_windows",
  "get_window_state",
];
const DEFAULT_CWD = process.env.INTERNAL_AGENT_WORKSPACE || path.join(os.homedir(), "Documents", "Codex");
const START_URL = process.argv.find((value) => value.startsWith("--start-url="))?.slice("--start-url=".length) || null;
const SMOKE_PROMPT = process.argv.find((value) => value.startsWith("--smoke-prompt="))?.slice("--smoke-prompt=".length) || null;

function findCodexBinary() {
  const candidates = [
    process.env.CODEX_BIN,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync("test", ["-x", candidate]);
      return candidate;
    } catch {}
  }
  try {
    return execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Codex CLI was not found. Set CODEX_BIN to an executable Codex CLI path.");
  }
}

function findCuaDriverBinary() {
  const candidates = [
    process.env.CUA_DRIVER_PATH,
    path.join(os.homedir(), ".local", "bin", "cua-driver"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync("test", ["-x", candidate]);
      return candidate;
    } catch {}
  }
  try {
    return execFileSync("which", ["cua-driver"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function inspectComputerUse(binary) {
  if (!binary) return { available: false, running: false, permissions: null, message: "未安装 cua-driver" };
  try {
    execFileSync(binary, ["status"], { encoding: "utf8", timeout: 5_000 });
    const raw = execFileSync(binary, ["check_permissions", JSON.stringify({ prompt: false })], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const permissions = JSON.parse(raw);
    const granted = Boolean(permissions.accessibility && permissions.screen_recording);
    return {
      available: true,
      running: true,
      permissions: {
        accessibility: Boolean(permissions.accessibility),
        screenRecording: Boolean(permissions.screen_recording),
      },
      message: granted ? "Computer Use 已就绪" : "需要系统辅助功能与录屏权限",
    };
  } catch (error) {
    return {
      available: true,
      running: false,
      permissions: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

class AppServerClient extends EventEmitter {
  constructor(binary) {
    super();
    this.binary = binary;
    this.pending = new Map();
    this.nextId = 1;
    this.process = null;
    this.ready = false;
    this.serverRequests = new Map();
  }

  async start() {
    this.process = spawn(this.binary, ["app-server", "--listen", "stdio://"], {
      cwd: DEFAULT_CWD,
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.on("exit", (code, signal) => {
      this.ready = false;
      this.emit("event", { type: "server-exit", code, signal });
      for (const pending of this.pending.values()) pending.reject(new Error("Codex App Server exited"));
      this.pending.clear();
    });
    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) this.emit("event", { type: "server-log", text });
    });
    const lines = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "internal-agent-workbench", title: "Internal Agent Workbench", version: "0.4.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized");
    this.ready = true;
  }

  handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("event", { type: "server-log", text: line });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      const isApprovalRequest = message.method.endsWith("/requestApproval")
        || new Set(["execCommandApproval", "applyPatchApproval"]).has(message.method);
      const isComputerUseElicitation = message.method === "mcpServer/elicitation/request"
        && message.params?.serverName === "computer_use"
        && new Set(["form", "openai/form"]).has(message.params?.mode);
      if (isApprovalRequest || isComputerUseElicitation) {
        this.serverRequests.set(String(message.id), message);
        this.emit("event", { type: "approval-required", request: message });
      } else {
        this.emit("event", { type: "unsupported-server-request", request: message });
        this.write({ id: message.id, error: { code: -32601, message: `Unsupported client request: ${message.method}` } });
      }
      return;
    }
    this.emit("notification", message);
  }

  write(message) {
    if (!this.process?.stdin.writable) throw new Error("Codex App Server is not running");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method, params) {
    const message = { method };
    if (params !== undefined) message.params = params;
    this.write(message);
  }

  resolveServerRequest(requestId, decision) {
    const key = String(requestId);
    const request = this.serverRequests.get(key);
    if (!request) throw new Error("Approval request is no longer pending");
    if (!new Set(["accept", "acceptForSession", "decline"]).has(decision)) {
      throw new Error("Invalid approval decision");
    }
    this.serverRequests.delete(key);
    if (request.method === "mcpServer/elicitation/request") {
      const action = decision === "decline" ? "decline" : "accept";
      const result = { action };
      if (action === "accept") result.content = this.buildElicitationContent(request.params?.requestedSchema);
      this.write({ id: request.id, result });
    } else {
      this.write({ id: request.id, result: { decision } });
    }
    return { requestId: request.id, decision };
  }

  buildElicitationContent(schema) {
    if (!schema || typeof schema !== "object") return {};
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const content = {};
    for (const name of required) {
      const field = properties[name] || {};
      if (Object.prototype.hasOwnProperty.call(field, "const")) content[name] = field.const;
      else if (Object.prototype.hasOwnProperty.call(field, "default")) content[name] = field.default;
      else if (Array.isArray(field.enum) && field.enum.length) content[name] = field.enum[0];
      else if (field.type === "boolean") content[name] = true;
      else if (field.type === "number" || field.type === "integer") content[name] = 1;
      else content[name] = "approved";
    }
    return content;
  }

  stop() {
    if (this.process && !this.process.killed) this.process.kill("SIGTERM");
  }
}

class EmbeddedBrowserBridge {
  constructor() {
    this.webContents = null;
    this.allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    this.token = crypto.randomBytes(32).toString("hex");
    this.server = null;
    this.url = null;
  }

  async start() {
    this.server = http.createServer((request, response) => this.handleHttp(request, response));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    this.url = `http://127.0.0.1:${address.port}`;
  }

  stop() {
    this.server?.close();
  }

  attach(target) {
    if (!target || target.isDestroyed()) throw new Error("Embedded browser guest is unavailable");
    this.webContents = target;
  }

  target() {
    if (!this.webContents || this.webContents.isDestroyed()) throw new Error("Embedded browser is not ready");
    return this.webContents;
  }

  async handleHttp(request, response) {
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST" || request.url !== "/command") {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }
    if (request.headers["x-internal-browser-token"] !== this.token) {
      response.statusCode = 403;
      response.end(JSON.stringify({ ok: false, error: "Invalid browser bridge token" }));
      return;
    }
    try {
      const body = await this.readBody(request);
      const value = await this.execute(body.action, body.args || {});
      response.end(JSON.stringify({ ok: true, value }));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  readBody(request) {
    return new Promise((resolve, reject) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) reject(new Error("Browser command is too large"));
      });
      request.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid browser command JSON")); }
      });
      request.on("error", reject);
    });
  }

  normalizeUrl(input) {
    const value = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const parsed = new URL(value);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Only HTTP(S) URLs are allowed");
    return parsed;
  }

  async userNavigate(input) {
    const parsed = this.normalizeUrl(input);
    this.allowedHosts.add(parsed.hostname);
    await this.target().loadURL(parsed.toString());
    return { url: parsed.toString(), host: parsed.hostname, approved: true };
  }

  async execute(action, args) {
    if (action === "navigate") {
      const parsed = this.normalizeUrl(args.url);
      if (!this.allowedHosts.has(parsed.hostname)) {
        throw new Error(`Host ${parsed.hostname} is not approved. Open it manually in the address bar first.`);
      }
      await this.target().loadURL(parsed.toString());
      return { url: this.target().getURL() };
    }
    if (action === "snapshot") return this.snapshot();
    if (action === "click") return this.click(args.elementId);
    if (action === "fill") return this.fill(args.elementId, args.text);
    throw new Error(`Unknown browser action: ${action}`);
  }

  async snapshot() {
    return this.target().executeJavaScript(`(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
        .filter(visible).slice(0, 160);
      const interactive = nodes.map((el, index) => {
        const id = 'ia-' + index;
        el.setAttribute('data-internal-agent-id', id);
        return {
          elementId: id,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          type: el.getAttribute('type'),
          text: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 240)
        };
      });
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').trim().slice(0, 16000),
        interactive
      };
    })()`, true);
  }

  async click(elementId) {
    return this.target().executeJavaScript(`(() => {
      const el = document.querySelector('[data-internal-agent-id=' + CSS.escape(${JSON.stringify(String(elementId))}) + ']');
      if (!el) throw new Error('Element is stale; take a new browser_snapshot.');
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: ${JSON.stringify(String(elementId))}, url: location.href };
    })()`, true);
  }

  async fill(elementId, text) {
    return this.target().executeJavaScript(`(() => {
      const el = document.querySelector('[data-internal-agent-id=' + CSS.escape(${JSON.stringify(String(elementId))}) + ']');
      if (!el) throw new Error('Element is stale; take a new browser_snapshot.');
      el.focus();
      const value = ${JSON.stringify(String(text))};
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: ${JSON.stringify(String(elementId))}, length: value.length };
    })()`, true);
  }
}

let mainWindow;
let browserBridge;
let appServer;
const cuaDriverBinary = findCuaDriverBinary();
let computerUseStatus = inspectComputerUse(cuaDriverBinary);
let currentThreadId = null;
let currentTurnId = null;
let currentGoal = null;
let currentModel = null;
let currentReasoningEffort = null;
let collaborationModes = [];
let smokeStarted = false;

function sendToRenderer(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

function buildThreadConfig() {
  const config = {
    features: { goals: true, collaboration_modes: true },
    mcp_servers: {
      internal_browser: {
        command: process.execPath,
        args: [MCP_SCRIPT],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          INTERNAL_BROWSER_BRIDGE_URL: browserBridge.url,
          INTERNAL_BROWSER_BRIDGE_TOKEN: browserBridge.token,
        },
        startup_timeout_sec: 10,
        default_tools_approval_mode: "approve",
      },
    },
  };
  if (cuaDriverBinary && computerUseStatus.running) {
    config.mcp_servers.computer_use = {
      command: cuaDriverBinary,
      args: ["mcp", "--host-bundle-id", "com.openai.internal-agent-workbench"],
      startup_timeout_sec: 15,
      tool_timeout_sec: 120,
      enabled_tools: COMPUTER_USE_TOOLS,
      default_tools_approval_mode: "writes",
      tools: Object.fromEntries(COMPUTER_USE_READ_TOOLS.map((name) => [name, { approval_mode: "approve" }])),
    };
  }
  return config;
}

async function ensureThread(payload = {}) {
  if (!appServer?.ready) throw new Error("Codex App Server is still starting");
  const cwd = payload.cwd || DEFAULT_CWD;
  if (!currentThreadId) {
    const provider = payload.modelProvider || null;
    const model = payload.model || null;
    const result = await appServer.request("thread/start", {
      cwd,
      model,
      modelProvider: provider,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      config: buildThreadConfig(),
      ephemeral: false,
      serviceName: "internal-agent-workbench",
      developerInstructions: "You have an internal_browser MCP server controlling the embedded browser. A host must be manually approved before browser_navigate can visit it. You also have a computer_use MCP server for native macOS apps when available. For native GUI work, start a named session with capture_scope=window, select an exact pid and window_id, call get_window_state before every action, prefer element_index actions, and call get_window_state again after every action to verify. Never use Computer Use to retrieve passwords, cookies, tokens, or session storage. Do not delete data, quit apps, send messages, submit forms, or make purchases without explicit user intent for that exact action.",
    });
    currentThreadId = result.thread.id;
    currentModel = result.model;
    currentReasoningEffort = result.reasoningEffort || null;
    sendToRenderer("agent:event", { type: "thread-ready", threadId: currentThreadId });
  }
  return { threadId: currentThreadId, cwd };
}

async function setCollaborationMode(mode) {
  if (!currentThreadId) throw new Error("Start a thread before changing modes");
  const preset = collaborationModes.find((item) => item.mode === mode);
  const model = currentModel || preset?.model;
  if (!model) throw new Error("The active model is not available for collaboration mode");
  await appServer.request("thread/settings/update", {
    threadId: currentThreadId,
    collaborationMode: {
      mode,
      settings: {
        model,
        reasoning_effort: mode === "plan" ? (preset?.reasoning_effort || currentReasoningEffort) : currentReasoningEffort,
        developer_instructions: null,
      },
    },
  });
}

async function startAgentTurn(payload) {
  const { cwd } = await ensureThread(payload);
  const mode = payload.mode === "plan" ? "plan" : "default";
  await setCollaborationMode(mode);
  const result = await appServer.request("turn/start", {
    threadId: currentThreadId,
    input: [{ type: "text", text: payload.prompt, text_elements: [] }],
    cwd,
    model: payload.model || null,
  });
  currentTurnId = result.turn?.id || result.turnId || currentTurnId;
  return { threadId: currentThreadId, turnId: currentTurnId };
}

async function setGoal(payload) {
  await ensureThread(payload);
  const objective = String(payload.objective || "").trim();
  if (!objective) throw new Error("目标不能为空");
  if (objective.length > 4_000) throw new Error("目标不能超过 4,000 个字符；请把详细要求写入文件后引用它");
  await setCollaborationMode("default");
  const params = { threadId: currentThreadId, objective, status: "active" };
  if (payload.tokenBudget !== null && payload.tokenBudget !== undefined && payload.tokenBudget !== "") {
    const tokenBudget = Number(payload.tokenBudget);
    if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) throw new Error("Token 预算必须是正整数");
    params.tokenBudget = tokenBudget;
  }
  const result = await appServer.request("thread/goal/set", params);
  currentGoal = result.goal;
  sendToRenderer("agent:event", { type: "goal-state", goal: currentGoal });
  return { threadId: currentThreadId, goal: currentGoal };
}

async function updateGoal(action, value) {
  if (!currentThreadId) throw new Error("当前没有任务");
  if (action === "clear") {
    await appServer.request("thread/goal/clear", { threadId: currentThreadId });
    currentGoal = null;
    sendToRenderer("agent:event", { type: "goal-state", goal: null });
    return { goal: null };
  }
  const params = { threadId: currentThreadId };
  if (action === "pause") params.status = "paused";
  else if (action === "resume") params.status = "active";
  else if (action === "edit") {
    const objective = String(value || "").trim();
    if (!objective || objective.length > 4_000) throw new Error("目标必须为 1–4,000 个字符");
    params.objective = objective;
  } else throw new Error(`Unknown goal action: ${action}`);
  const result = await appServer.request("thread/goal/set", params);
  currentGoal = result.goal;
  sendToRenderer("agent:event", { type: "goal-state", goal: currentGoal });
  return { goal: currentGoal };
}

async function maybeRunSmokePrompt() {
  if (!SMOKE_PROMPT || smokeStarted || !appServer?.ready || !browserBridge?.webContents) return;
  smokeStarted = true;
  sendToRenderer("agent:event", { type: "smoke-started", prompt: SMOKE_PROMPT });
  try {
    const result = await startAgentTurn({ prompt: SMOKE_PROMPT, cwd: DEFAULT_CWD });
    sendToRenderer("agent:event", { type: "smoke-thread", ...result });
  } catch (error) {
    sendToRenderer("agent:event", { type: "fatal", message: `Smoke task failed: ${error.message}` });
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 930,
    minWidth: 1080,
    minHeight: 720,
    title: "Internal Agent Workbench",
    backgroundColor: "#ffffff",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  const publishBrowserState = () => {
    if (!browserBridge?.webContents || browserBridge.webContents.isDestroyed()) return;
    const target = browserBridge.webContents;
    const raw = target.getURL();
    let host = "";
    try { host = new URL(raw).hostname; } catch {}
    sendToRenderer("browser:state", {
      url: raw,
      title: target.getTitle(),
      host,
      approved: host ? browserBridge?.allowedHosts.has(host) : false,
      canGoBack: target.canGoBack(),
      canGoForward: target.canGoForward(),
    });
  };
  browserBridge = new EmbeddedBrowserBridge();
  await browserBridge.start();

  await mainWindow.loadFile(path.join(__dirname, "index.html"));

  appServer = new AppServerClient(findCodexBinary());
  appServer.on("event", (event) => sendToRenderer("agent:event", event));
  appServer.on("notification", (message) => {
    if (message.method === "turn/started") currentTurnId = message.params?.turn?.id || message.params?.turnId || currentTurnId;
    if (message.method === "turn/completed") currentTurnId = null;
    if (message.method === "thread/goal/updated") currentGoal = message.params?.goal || currentGoal;
    if (message.method === "thread/goal/cleared") currentGoal = null;
    sendToRenderer("agent:event", { type: "notification", message });
  });
  try {
    await appServer.start();
    try {
      const modes = await appServer.request("collaborationMode/list", {});
      collaborationModes = Array.isArray(modes?.data) ? modes.data : [];
    } catch (error) {
      sendToRenderer("agent:event", { type: "server-log", text: `Collaboration presets unavailable: ${error.message}` });
    }
    sendToRenderer("agent:event", { type: "ready" });
    void maybeRunSmokePrompt();
  } catch (error) {
    sendToRenderer("agent:event", { type: "fatal", message: error.message });
  }
}

ipcMain.handle("browser:attach", async (_event, webContentsId) => {
  const target = webContents.fromId(webContentsId);
  browserBridge.attach(target);
  target.setWindowOpenHandler(({ url }) => {
    void target.loadURL(url);
    return { action: "deny" };
  });
  const publish = () => {
    const raw = target.getURL();
    let host = "";
    try { host = new URL(raw).hostname; } catch {}
    sendToRenderer("browser:state", {
      url: raw,
      title: target.getTitle(),
      host,
      approved: host ? browserBridge.allowedHosts.has(host) : false,
      canGoBack: target.canGoBack(),
      canGoForward: target.canGoForward(),
    });
  };
  target.on("did-navigate", publish);
  target.on("did-navigate-in-page", publish);
  target.on("page-title-updated", publish);
  publish();
  if (START_URL) await browserBridge.userNavigate(START_URL);
  void maybeRunSmokePrompt();
  return { attached: true };
});

ipcMain.handle("browser:navigate", async (_event, url) => browserBridge.userNavigate(url));
ipcMain.handle("browser:back", async () => browserBridge.target().canGoBack() && browserBridge.target().goBack());
ipcMain.handle("browser:forward", async () => browserBridge.target().canGoForward() && browserBridge.target().goForward());
ipcMain.handle("browser:reload", async () => browserBridge.target().reload());
ipcMain.handle("agent:status", async () => ({
  ready: Boolean(appServer?.ready),
  threadId: currentThreadId,
  goal: currentGoal,
  collaborationModes,
  defaultCwd: DEFAULT_CWD,
  computerUse: computerUseStatus,
}));

ipcMain.handle("agent:send", async (_event, payload) => startAgentTurn(payload));
ipcMain.handle("agent:goal:set", async (_event, payload) => setGoal(payload));
ipcMain.handle("agent:goal:update", async (_event, action, value) => updateGoal(action, value));
ipcMain.handle("agent:new-task", async () => {
  if (currentTurnId) throw new Error("当前任务仍在运行，请先停止");
  if (currentGoal?.status === "active") throw new Error("当前 Goal 仍在运行，请先暂停或清除");
  currentThreadId = null;
  currentTurnId = null;
  currentGoal = null;
  currentModel = null;
  currentReasoningEffort = null;
  return { created: true };
});

ipcMain.handle("agent:interrupt", async () => {
  if (!currentThreadId || !currentTurnId) return { interrupted: false };
  if (currentGoal?.status === "active") await updateGoal("pause");
  await appServer.request("turn/interrupt", { threadId: currentThreadId, turnId: currentTurnId });
  return { interrupted: true };
});

ipcMain.handle("agent:approval", async (_event, requestId, decision) => appServer.resolveServerRequest(requestId, decision));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  appServer?.stop();
  browserBridge?.stop();
});
