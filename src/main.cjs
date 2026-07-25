const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, powerSaveBlocker, safeStorage, screen, shell, webContents } = require("electron");
const { spawn, execFile, execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const fs = require("node:fs");
const readline = require("node:readline");
const { pathToFileURL } = require("node:url");
const pty = require("node-pty");
const { ModelGateway } = require("./model-gateway.cjs");
const { AgentRuntimeCoordinator } = require("./agent-runtime.cjs");
const { ThreadContextRegistry } = require("./thread-contexts.cjs");
const { ThreadRecoveryCoordinator } = require("./thread-recovery.cjs");
const { AGENT_BEHAVIOR_CONTRACT } = require("./agent-instructions.cjs");
const { BrowserSessionManager } = require("./browser-session-manager.cjs");
const { BrowserProfileImporter } = require("./browser-profile-importer.cjs");
const { BrowserCredentialVault } = require("./browser-credential-vault.cjs");
const { ChromiumProfileImporter } = require("./chromium-profile-importer.cjs");
const { loadWebContentsUrl, resolveAddressInput } = require("./browser-navigation.cjs");
const { annotationRecord, boundedPush, consoleRecord, logRecord, networkRecord } = require("./browser-visual.cjs");
const { collectWorkspaceSuggestions, resolveWorkspaceFile } = require("./quick-launcher.cjs");
const { discoverProjectActions } = require("./project-actions.cjs");
const { githubCompareUrl, githubRepositoryFromRemote, normalizeCommitMessage, parsePorcelainV1Z, parseUnifiedDiff, safeRepoPath } = require("./git-workflow.cjs");
const { resolveWorkspaceFile: resolveOpenableWorkspaceFile, shouldUseSystemPreview } = require("./workspace-location.cjs");
const { ScheduledTaskStore } = require("./scheduled-tasks.cjs");
const { listProjectDirectory, searchProjectFiles } = require("./project-files.cjs");
const { buildBrowserFillScript } = require("./browser-fill.cjs");
const { formatReviewPrompt } = require("./review-comments.cjs");
const { AgentProfileStore } = require("./agent-profiles.cjs");
const { inspectEffectiveConfig } = require("./effective-config.cjs");
const { LocalMemoryStore } = require("./local-memory.cjs");
const { UsageLedger } = require("./usage-ledger.cjs");
const { SecretStore } = require("./secret-store.cjs");
const { PetStateStore } = require("./pet-state.cjs");
const { CloudAccountClient } = require("./cloud-account.cjs");
const { imageGenerationCapability } = require("./provider-capabilities.cjs");
const { buildSkillInputItems, flattenSkillsResponse } = require("./skill-runtime.cjs");
const { watchSkillRoot } = require("./skill-watcher.cjs");
const {
  computerUseMcpArgs,
  editorCandidates,
  findCodexBinary: resolveCodexBinary,
  findCuaDriverApp: resolveCuaDriverApp,
  findCuaDriverBinary: resolveCuaDriverBinary,
  isExecutable,
  resolveTerminalShell,
  workbenchWindowOptions,
} = require("./platform-runtime.cjs");
const { version: APP_VERSION } = require("../package.json");

// Keep the original data directory as a compatibility invariant. Electron
// derives userData from package.json name by default, which made dev builds and
// renamed packages appear to lose sessions after an upgrade.
const STABLE_USER_DATA_PATH = path.join(app.getPath("appData"), "internal-agent-workbench");
if (app.getPath("userData") !== STABLE_USER_DATA_PATH) app.setPath("userData", STABLE_USER_DATA_PATH);

const EMBEDDED_BROWSER_PARTITION = "persist:internal-agent-browser";

const APP_ROOT = path.resolve(__dirname, "..");
const APP_ICON_PNG = path.join(APP_ROOT, "assets", "onpeople-app-icon.png");
const BUILTIN_PET_SKINS = Object.freeze([
  { id: "onpeople", name: "经典水獭", subtitle: "OnPeople 原生", src: "../assets/onpeople-app-icon.png", builtIn: true },
  { id: "arthur", name: "亚瑟 Cosplay", subtitle: "非官方同人灵感", src: "../assets/pets/arthur.png", builtIn: true },
  { id: "angela", name: "安琪拉 Cosplay", subtitle: "非官方同人灵感", src: "../assets/pets/angela.png", builtIn: true },
  { id: "diaochan", name: "貂蝉 Cosplay", subtitle: "非官方同人灵感", src: "../assets/pets/diaochan.png", builtIn: true },
  { id: "libai", name: "李白 Cosplay", subtitle: "非官方同人灵感", src: "../assets/pets/libai.png", builtIn: true },
]);
const EXTERNAL_RUNTIME_ROOT = path.join(process.resourcesPath, ".embedded-runtime");
const EMBEDDED_RUNTIME_ROOT = fs.existsSync(EXTERNAL_RUNTIME_ROOT)
  ? EXTERNAL_RUNTIME_ROOT
  : path.join(APP_ROOT, ".embedded-runtime");
const MCP_SCRIPT = path.join(__dirname, "browser-mcp.cjs");
const ARTIFACT_MCP_SCRIPT = path.join(__dirname, "artifact-mcp.cjs");
const IMAGE_GENERATION_MCP_SCRIPT = path.join(__dirname, "image-generation-mcp.cjs");
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
const DEFAULT_CWD = process.env.INTERNAL_AGENT_WORKSPACE || path.join(os.homedir(), "Documents", "OnPeople");
const START_URL = process.argv.find((value) => value.startsWith("--start-url="))?.slice("--start-url=".length) || null;
const SMOKE_PROMPT = process.argv.find((value) => value.startsWith("--smoke-prompt="))?.slice("--smoke-prompt=".length) || null;
const DEFAULT_CLOUD_SERVICE_URL = process.env.SUB2API_URL || process.env.ONPEOPLE_CLOUD_URL || "https://sub2api.aibro.vip";
const PROVIDERS = {
  onpeople: { name: "OnPeople · Sub2API", protocol: "responses", baseUrl: `${DEFAULT_CLOUD_SERVICE_URL.replace(/\/$/, "").replace(/\/api\/v1$/, "").replace(/\/v1$/, "")}/v1`, model: "", vision: true },
  openai: { name: "OpenAI", protocol: "responses", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-terra", vision: true },
  deepseek: { name: "DeepSeek", protocol: "chat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", vision: false },
  minimax: { name: "MiniMax", protocol: "chat", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", vision: true },
  kimi: { name: "Kimi", protocol: "chat", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.6", vision: true },
  grok: { name: "Grok (xAI)", protocol: "responses", baseUrl: "https://api.x.ai/v1", model: "grok-4.5", vision: true },
  sub2api: { name: "Sub2API", protocol: "responses", baseUrl: "https://sub2api.aibro.vip/v1", model: "gpt-5.6-sol", vision: true },
  compatible: { name: "自定义 Responses API", protocol: "responses", baseUrl: "https://api.openai.com/v1", model: "", vision: true },
  ollama: { name: "Ollama", protocol: "local", baseUrl: "", model: "", vision: false },
  lmstudio: { name: "LM Studio", protocol: "local", baseUrl: "", model: "", vision: false },
};
const DEVELOPER_INSTRUCTIONS = AGENT_BEHAVIOR_CONTRACT;
function developerInstructionsFor(cwd, extra = "") {
  const policy = readP0Settings().policy;
  const permission = policy.sandbox === "danger-full-access" && policy.approvalPolicy === "never"
    ? "The active permission profile is Full access. Do not ask for shell, filesystem, network, browser, or ordinary tool approval. This does not create user intent for a destructive or externally visible action; when the current user request already names the exact action, target, and content, do not ask for the same authorization twice."
    : "Follow the active sandbox and approval policy for tool execution.";
  const memory = localMemoryStore?.context(cwd || DEFAULT_CWD) || "";
  return [DEVELOPER_INSTRUCTIONS, permission, memory, extra].filter(Boolean).join("\n\n");
}
const CAPABILITY_INSTRUCTIONS = {
  documents: "Create or edit a DOCX document. Use workspace_artifacts.artifact_create_document for the final file.",
  pdf: "Create or edit a PDF. Use workspace_artifacts.artifact_create_pdf for the final file.",
  spreadsheets: "Create or edit an XLSX workbook. Use workspace_artifacts.artifact_create_spreadsheet for the final file.",
  presentations: "Create or edit a PPTX presentation. Use workspace_artifacts.artifact_create_presentation for the final file.",
  templates: "Create or reuse an artifact template. Use workspace_artifacts.artifact_create_template to save a customized blueprint and workspace_artifacts.artifact_apply_template to produce a real artifact from it. Verify the produced artifact with artifact_inspect.",
  sites: "Build a standalone website in the workspace. Use artifact_create_site when a generated baseline is useful, then inspect and refine the files and preview them in the embedded browser.",
  browser: "Complete this task with OnPeople's internal_browser tools and verify the resulting page state.",
  computer: "Complete this task with the computer_use tools, minimizing native GUI actions and verifying each mutation.",
  visualize: "Create a standalone interactive visualization. Use workspace_artifacts.artifact_create_visualization, then preview and verify it.",
  imagegen: "Generate the requested image with image_generation.image_generate. Use a detailed production-ready visual prompt, save the result in the active workspace, and report the generated file path. When the user requests 2–4 variations, use one image_generate call with count set to that number; do not launch parallel image_generate calls.",
  "default-templates": "Create an appropriate reusable default template with workspace_artifacts.artifact_create_template before producing any requested artifact.",
};

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

function findCodexBinary() {
  return resolveCodexBinary({ runtimeRoot: EMBEDDED_RUNTIME_ROOT });
}

function findCuaDriverBinary() {
  return resolveCuaDriverBinary({ runtimeRoot: EMBEDDED_RUNTIME_ROOT });
}

function findCuaDriverApp() {
  return resolveCuaDriverApp({ runtimeRoot: EMBEDDED_RUNTIME_ROOT });
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
    const granted = process.platform !== "darwin"
      || Boolean(permissions.accessibility && permissions.screen_recording);
    return {
      available: true,
      running: true,
      permissions: process.platform === "darwin" ? {
        accessibility: Boolean(permissions.accessibility),
        screenRecording: Boolean(permissions.screen_recording),
      } : null,
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

async function prepareComputerUse(binary, driverApp) {
  let status = inspectComputerUse(binary);
  if (!binary || status.running) return status;
  try {
    if (process.platform === "darwin" && !driverApp) return status;
    const command = process.platform === "darwin" ? "/usr/bin/open" : binary;
    const args = process.platform === "darwin" ? ["-n", "-g", driverApp, "--args", "serve"] : ["serve"];
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    return { ...status, message: `无法启动内嵌 Cua Driver: ${error.message}` };
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    status = inspectComputerUse(binary);
    if (status.running) return status;
  }
  return status;
}

class AppServerClient extends EventEmitter {
  constructor(binary) {
    super();
    this.binary = binary;
    this.pending = new Map();
    this.nextId = 1;
    this.process = null;
    this.ready = false;
    this.intentionalStop = false;
    this.serverRequests = new Map();
    this.skillWatcher = null;
  }

  async start() {
    const codexHome = path.join(app.getPath("userData"), "codex-home");
    const onPeopleSkillsHome = path.join(codexHome, "skills");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.mkdirSync(onPeopleSkillsHome, { recursive: true });
    this.skillWatcher = watchSkillRoot(onPeopleSkillsHome, () => {
      this.emit("notification", { method: "skills/changed", params: { source: "onpeople-filesystem" } });
    }, {
      onError: (error) => this.emit("event", { type: "server-log", text: `OnPeople Skills watcher: ${error.message}` }),
    });
    fs.mkdirSync(DEFAULT_CWD, { recursive: true });
    const providerSettings = readProviderSettings();
    this.process = spawn(this.binary, ["app-server", "--listen", "stdio://"], {
      cwd: DEFAULT_CWD,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        ONPEOPLE_SKILLS_HOME: onPeopleSkillsHome,
        ONPEOPLE_RUNTIME_NAME: "OnPeople",
        ONPEOPLE_NODE_RUNTIME: process.execPath,
        ONPEOPLE_SKILL_VALIDATOR: path.join(__dirname, "onpeople-skill-validator.cjs"),
        // OnPeople intentionally does not expose Codex device remote control.
        // Avoid an auth preference retry loop when using API-key providers.
        CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
        NO_COLOR: "1",
        TERM: "dumb",
        ...(providerSettings.apiKey ? { ONPEOPLE_API_KEY: providerSettings.apiKey } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.on("exit", (code, signal) => {
      this.skillWatcher?.close();
      this.skillWatcher = null;
      this.ready = false;
      if (!this.intentionalStop) this.emit("event", { type: "server-exit", code, signal });
      for (const pending of this.pending.values()) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error("Codex App Server exited"));
      }
      this.pending.clear();
    });
    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) this.emit("event", { type: "server-log", text });
    });
    const lines = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "onpeople", title: "OnPeople", version: APP_VERSION },
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
      if (pending.timer) clearTimeout(pending.timer);
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

  request(method, params, options = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
      const pending = { resolve, reject, method, timer: null };
      if (timeoutMs) {
        pending.timer = setTimeout(() => {
          if (this.pending.get(id) !== pending) return;
          this.pending.delete(id);
          const error = new Error(`${method} 超时（${Math.round(timeoutMs / 1000)} 秒）`);
          error.code = "APP_SERVER_TIMEOUT";
          error.method = method;
          reject(error);
        }, timeoutMs);
      }
      this.pending.set(id, pending);
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
    this.intentionalStop = true;
    this.skillWatcher?.close();
    this.skillWatcher = null;
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
    this.consoleEntries = [];
    this.networkEntries = new Map();
    this.developerTarget = null;
    this.developerMessageHandler = null;
    this.annotationsFile = null;
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
    this.detachDeveloperMode();
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
    return resolveAddressInput(input).url;
  }

  async userNavigate(input) {
    const resolved = resolveAddressInput(input);
    const parsed = resolved.url;
    this.allowedHosts.add(parsed.hostname);
    const navigation = await loadWebContentsUrl(this.target(), parsed.toString());
    return {
      url: navigation.url,
      host: parsed.hostname,
      approved: true,
      replaced: navigation.replaced,
      kind: resolved.kind,
      query: resolved.query || null,
    };
  }

  async openWorkspaceFile(cwd, filePath) {
    const { root, candidate } = resolveWorkspaceFile(cwd, filePath);
    const relative = path.relative(root, candidate);
    const escapeHtml = (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    const content = fs.readFileSync(candidate, "utf8");
    const title = escapeHtml(path.basename(candidate));
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f7f7f5;color:#252522;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.bar{position:sticky;top:0;padding:14px 22px;border-bottom:1px solid #deded9;background:rgba(255,255,255,.94);backdrop-filter:blur(12px)}.bar strong,.bar span{display:block}.bar strong{font-size:14px}.bar span{margin-top:4px;color:#898983;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.page{max-width:940px;margin:24px auto;padding:0 22px 60px}pre{margin:0;padding:24px;border:1px solid #deded9;border-radius:12px;background:#fff;box-shadow:0 8px 30px rgba(26,26,23,.04);font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><header class="bar"><strong>${title}</strong><span>${escapeHtml(relative)}</span></header><main class="page"><pre>${escapeHtml(content)}</pre></main></body></html>`;
    await loadWebContentsUrl(this.target(), `data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return { name: path.basename(candidate), path: relative };
  }

  async execute(action, args) {
    if (action === "navigate") {
      const parsed = this.normalizeUrl(args.url);
      const publicHttpsHost = parsed.protocol === "https:"
        && parsed.hostname.includes(".")
        && !parsed.hostname.endsWith(".local")
        && !/^\d+(?:\.\d+){3}$/.test(parsed.hostname)
        && !parsed.hostname.includes(":");
      if (!this.allowedHosts.has(parsed.hostname) && publicHttpsHost) {
        this.allowedHosts.add(parsed.hostname);
      } else if (!this.allowedHosts.has(parsed.hostname)) {
        throw new Error(`Host ${parsed.hostname} is not approved. Open it manually in the address bar first.`);
      }
      sendToRenderer("browser:agent-navigation", { url: parsed.toString() });
      return loadWebContentsUrl(this.target(), parsed.toString());
    }
    if (action === "snapshot") return this.snapshot();
    if (action === "visual_snapshot") return this.visualSnapshot();
    if (action === "annotations") return this.listAnnotations();
    if (action === "developer_inspect") return this.developerInspect();
    if (action === "click") return this.click(args.elementId);
    if (action === "fill") return this.fill(args.elementId, args.text);
    if (action === "press_key") return this.pressKey(args.key, args.elementId);
    if (action === "select") return this.select(args.elementId, args.value);
    if (action === "scroll") return this.scroll(args);
    if (action === "hover") return this.hover(args.elementId);
    if (action === "wait") return this.wait(args);
    if (action === "upload") return this.upload(args.elementId, args.paths);
    throw new Error(`Unknown browser action: ${action}`);
  }

  async snapshot() {
    return this.target().executeJavaScript(`(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="textbox"],[contenteditable="true"],[contenteditable="plaintext-only"]')]
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

  async captureScreenshot() {
    const target = this.target();
    let image = await target.capturePage();
    const original = image.getSize();
    if (original.width > 1_200) image = image.resize({ width: 1_200, quality: "best" });
    const size = image.getSize();
    return {
      url: target.getURL(),
      title: target.getTitle(),
      capturedAt: Date.now(),
      width: size.width,
      height: size.height,
      scale: original.width ? size.width / original.width : 1,
      mimeType: "image/png",
      imageBase64: image.toPNG().toString("base64"),
    };
  }

  async visualSnapshot() {
    const [page, screenshot] = await Promise.all([this.snapshot(), this.captureScreenshot()]);
    return { ...screenshot, page };
  }

  annotationFile() {
    if (!this.annotationsFile) this.annotationsFile = path.join(app.getPath("userData"), "browser-annotations.json");
    return this.annotationsFile;
  }

  readAnnotations() {
    try {
      const value = JSON.parse(fs.readFileSync(this.annotationFile(), "utf8"));
      return Array.isArray(value) ? value.slice(-500) : [];
    } catch { return []; }
  }

  writeAnnotations(annotations) {
    fs.mkdirSync(path.dirname(this.annotationFile()), { recursive: true });
    fs.writeFileSync(this.annotationFile(), `${JSON.stringify(annotations.slice(-500), null, 2)}\n`, { mode: 0o600 });
  }

  listAnnotations({ all = false } = {}) {
    const currentUrl = this.target().getURL().split("#", 1)[0];
    const annotations = this.readAnnotations();
    return {
      url: currentUrl,
      annotations: all ? annotations : annotations.filter((item) => String(item.url || "").split("#", 1)[0] === currentUrl),
    };
  }

  async beginAnnotationSelection() {
    return this.target().executeJavaScript(`(() => new Promise((resolve) => {
      window.__onpeopleAnnotationCancel?.();
      const old = document.getElementById('__onpeople-annotation-lens');
      old?.remove();
      const lens = document.createElement('div');
      lens.id = '__onpeople-annotation-lens';
      lens.setAttribute('aria-hidden', 'true');
      Object.assign(lens.style, {
        position: 'fixed', zIndex: '2147483647', pointerEvents: 'none',
        border: '2px solid #c56f3d', borderRadius: '5px',
        background: 'rgba(197,111,61,.10)', boxShadow: '0 0 0 9999px rgba(30,28,25,.08)',
        transition: 'left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease'
      });
      document.documentElement.appendChild(lens);
      let active = null;
      const selectorFor = (element) => {
        if (element.id) return '#' + CSS.escape(element.id);
        const parts = [];
        let node = element;
        while (node && node.nodeType === 1 && parts.length < 5) {
          let part = node.tagName.toLowerCase();
          const classes = [...node.classList].filter((name) => !name.startsWith('__onpeople')).slice(0, 2);
          if (classes.length) part += classes.map((name) => '.' + CSS.escape(name)).join('');
          const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item.tagName === node.tagName) : [];
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(' > ');
      };
      const point = (element) => {
        active = element;
        const rect = element.getBoundingClientRect();
        Object.assign(lens.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
      };
      const move = (event) => { if (event.target !== lens) point(event.target); };
      const cleanup = (removeLens) => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', choose, true);
        document.removeEventListener('keydown', keydown, true);
        if (removeLens) lens.remove();
        delete window.__onpeopleAnnotationCancel;
      };
      const choose = (event) => {
        if (event.target === lens) return;
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        active = event.target;
        point(active);
        const rect = active.getBoundingClientRect();
        const result = {
          selector: selectorFor(active), element: active.tagName.toLowerCase(),
          text: (active.innerText || active.value || active.getAttribute('aria-label') || '').trim().slice(0, 500),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
        cleanup(false); resolve(result);
      };
      const keydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); cleanup(true); resolve(null); } };
      window.__onpeopleAnnotationCancel = () => { cleanup(true); resolve(null); };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', choose, true);
      document.addEventListener('keydown', keydown, true);
      point(document.body);
    }))()`, true);
  }

  async finishAnnotationSelection() {
    return this.target().executeJavaScript(`(() => {
      window.__onpeopleAnnotationCancel?.();
      document.getElementById('__onpeople-annotation-lens')?.remove();
      return true;
    })()`, true);
  }

  async saveAnnotation(draft) {
    const target = this.target();
    const record = annotationRecord(draft, { url: target.getURL(), title: target.getTitle() });
    const annotations = this.readAnnotations();
    annotations.push(record);
    this.writeAnnotations(annotations);
    await this.finishAnnotationSelection();
    return record;
  }

  deleteAnnotation(annotationId) {
    const before = this.readAnnotations();
    const after = before.filter((item) => item.id !== annotationId);
    this.writeAnnotations(after);
    return { deleted: after.length !== before.length, id: annotationId };
  }

  async ensureDeveloperMode() {
    const target = this.target();
    if (this.developerTarget === target && target.debugger.isAttached()) return;
    this.detachDeveloperMode();
    if (!target.debugger.isAttached()) target.debugger.attach("1.3");
    this.developerTarget = target;
    this.developerMessageHandler = (_event, method, params) => {
      if (method === "Runtime.consoleAPICalled") boundedPush(this.consoleEntries, consoleRecord(params), 200);
      else if (method === "Log.entryAdded") boundedPush(this.consoleEntries, logRecord(params.entry), 200);
      else if (method.startsWith("Network.")) {
        const id = String(params.requestId || "");
        if (!id) return;
        const current = this.networkEntries.get(id) || {};
        this.networkEntries.set(id, networkRecord(method, params, current));
        while (this.networkEntries.size > 250) this.networkEntries.delete(this.networkEntries.keys().next().value);
      }
    };
    target.debugger.on("message", this.developerMessageHandler);
    target.debugger.on("detach", () => { this.developerTarget = null; });
    await Promise.all([
      target.debugger.sendCommand("Runtime.enable"),
      target.debugger.sendCommand("Log.enable"),
      target.debugger.sendCommand("Network.enable", { maxTotalBufferSize: 2_000_000, maxResourceBufferSize: 500_000 }),
    ]);
  }

  detachDeveloperMode() {
    const target = this.developerTarget;
    if (!target || target.isDestroyed()) { this.developerTarget = null; return; }
    if (this.developerMessageHandler) target.debugger.removeListener("message", this.developerMessageHandler);
    try { if (target.debugger.isAttached()) target.debugger.detach(); } catch {}
    this.developerTarget = null;
    this.developerMessageHandler = null;
  }

  async developerInspect() {
    await this.ensureDeveloperMode();
    const dom = await this.target().executeJavaScript(`(() => ({
      url: location.href, title: document.title,
      readyState: document.readyState,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      nodes: document.getElementsByTagName('*').length,
      scripts: document.scripts.length,
      stylesheets: document.styleSheets.length,
      forms: document.forms.length,
      images: { total: document.images.length, incomplete: [...document.images].filter((image) => !image.complete).length },
      performance: performance.getEntriesByType('navigation')[0] ? {
        domContentLoaded: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
        load: Math.round(performance.getEntriesByType('navigation')[0].loadEventEnd),
        transferSize: performance.getEntriesByType('navigation')[0].transferSize
      } : null
    }))()`, true);
    return {
      inspectedAt: Date.now(), dom,
      console: this.consoleEntries.slice(-80),
      network: [...this.networkEntries.values()].filter((item) => item.url).slice(-120),
    };
  }

  async click(elementId) {
    const before = await this.actionState(elementId);
    const clicked = await this.target().executeJavaScript(`(() => {
      const el = document.querySelector('[data-internal-agent-id=' + CSS.escape(${JSON.stringify(String(elementId))}) + ']');
      if (!el) throw new Error('Element is stale; take a new browser_snapshot.');
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: ${JSON.stringify(String(elementId))}, url: location.href };
    })()`, true);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const after = await this.actionState(elementId).catch(() => ({ url: this.target().getURL(), title: this.target().getTitle() }));
    return { ...clicked, before, after, verified: this.actionChanged(before, after) };
  }

  async fill(elementId, text) {
    const before = await this.actionState(elementId);
    const result = await this.target().executeJavaScript(buildBrowserFillScript(elementId, text), true);
    const after = await this.actionState(elementId);
    return {
      ...result,
      before,
      after,
      verified: after.value === String(text) || after.text === String(text),
    };
  }

  async actionState(elementId = null) {
    return this.target().executeJavaScript(`(() => {
      const elementId = ${JSON.stringify(elementId ? String(elementId) : null)};
      const el = elementId ? document.querySelector('[data-internal-agent-id=' + CSS.escape(elementId) + ']') : document.activeElement;
      return {
        url: location.href,
        title: document.title,
        activeTag: document.activeElement?.tagName?.toLowerCase() || null,
        activeElementId: document.activeElement?.getAttribute?.('data-internal-agent-id') || null,
        value: el && 'value' in el ? String(el.value ?? '') : null,
        checked: el && 'checked' in el ? Boolean(el.checked) : null,
        text: (el?.innerText || el?.textContent || '').trim().slice(0, 500),
        scrollX: Math.round(scrollX),
        scrollY: Math.round(scrollY),
        documentHeight: document.documentElement.scrollHeight
      };
    })()`, true);
  }

  actionChanged(before, after) {
    if (!before || !after) return false;
    return ["url", "title", "activeElementId", "value", "checked", "text", "scrollX", "scrollY", "documentHeight"]
      .some((key) => before[key] !== after[key]);
  }

  async pressKey(key, elementId = null) {
    const normalized = String(key || "").trim();
    if (!normalized || normalized.length > 40) throw new Error("Invalid key");
    const before = await this.actionState(elementId);
    if (elementId) {
      await this.target().executeJavaScript(`(() => {
        const el = document.querySelector('[data-internal-agent-id=' + CSS.escape(${JSON.stringify(String(elementId))}) + ']');
        if (!el) throw new Error('Element is stale; take a new browser_snapshot.');
        el.focus();
      })()`, true);
    }
    this.target().sendInputEvent({ type: "keyDown", keyCode: normalized });
    if (normalized.length === 1) this.target().sendInputEvent({ type: "char", keyCode: normalized });
    this.target().sendInputEvent({ type: "keyUp", keyCode: normalized });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = await this.actionState(elementId).catch(() => ({ url: this.target().getURL(), title: this.target().getTitle() }));
    return { key: normalized, before, after, verified: this.actionChanged(before, after) };
  }

  async select(elementId, value) {
    const before = await this.actionState(elementId);
    const selected = await this.target().executeJavaScript(`(() => {
      const el = document.querySelector('[data-internal-agent-id=' + CSS.escape(${JSON.stringify(String(elementId))}) + ']');
      if (!(el instanceof HTMLSelectElement)) throw new Error('Element is not a select.');
      const value = ${JSON.stringify(String(value ?? ""))};
      if (![...el.options].some((option) => option.value === value)) throw new Error('Select option was not found.');
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    })()`, true);
    const after = await this.actionState(elementId);
    return { selected, before, after, verified: after.value === selected };
  }

  async scroll({ elementId = null, deltaX = 0, deltaY = 600 } = {}) {
    const before = await this.actionState(elementId);
    await this.target().executeJavaScript(`(() => {
      const id = ${JSON.stringify(elementId ? String(elementId) : null)};
      const target = id ? document.querySelector('[data-internal-agent-id=' + CSS.escape(id) + ']') : window;
      if (!target) throw new Error('Element is stale; take a new browser_snapshot.');
      target.scrollBy({ left: ${Number(deltaX) || 0}, top: ${Number(deltaY) || 0}, behavior: 'instant' });
    })()`, true);
    const after = await this.actionState(elementId);
    return { before, after, verified: this.actionChanged(before, after) };
  }

  async hover(elementId) {
    const position = await this.target().executeJavaScript(`(() => {
      const el = document.querySelector('[data-internal-agent-id=' + CSS.escape(${JSON.stringify(String(elementId))}) + ']');
      if (!el) throw new Error('Element is stale; take a new browser_snapshot.');
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, true);
    this.target().sendInputEvent({ type: "mouseMove", x: position.x, y: position.y });
    return { hovered: String(elementId), position, verified: true };
  }

  async wait({ milliseconds = 500, text = null, timeout = 10_000 } = {}) {
    const wanted = text == null ? null : String(text);
    if (!wanted) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(30_000, Number(milliseconds) || 0))));
      return { waited: true, milliseconds: Math.max(0, Number(milliseconds) || 0), verified: true };
    }
    const deadline = Date.now() + Math.max(100, Math.min(60_000, Number(timeout) || 10_000));
    while (Date.now() < deadline) {
      const found = await this.target().executeJavaScript(`(document.body?.innerText || '').includes(${JSON.stringify(wanted)})`, true);
      if (found) return { waited: true, text: wanted, verified: true };
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out waiting for text: ${wanted.slice(0, 120)}`);
  }

  async upload(elementId, paths) {
    const files = (Array.isArray(paths) ? paths : [paths])
      .map((file) => path.resolve(String(file || "")))
      .filter(Boolean);
    if (!files.length || files.some((file) => !fs.statSync(file).isFile())) throw new Error("Upload files must exist");
    await this.ensureDeveloperMode();
    const selector = `[data-internal-agent-id="${String(elementId).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`;
    const root = await this.target().debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
    const node = await this.target().debugger.sendCommand("DOM.querySelector", { nodeId: root.root.nodeId, selector });
    if (!node.nodeId) throw new Error("Element is stale; take a new browser_snapshot.");
    await this.target().debugger.sendCommand("DOM.setFileInputFiles", { nodeId: node.nodeId, files });
    const after = await this.actionState(elementId);
    return { uploaded: files.map((file) => path.basename(file)), after, verified: true };
  }

  async fillSavedCredential(credential) {
    const payload = JSON.stringify({ username: credential.username, password: credential.password });
    return this.target().executeJavaScript(`(() => {
      const credential = ${payload};
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return !element.disabled && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const setInputValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(element, value); else element.value = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
      const password = passwords[0];
      if (!password) return { filled: false, reason: 'no-password-field' };
      const form = password.form || document;
      const usernames = [...form.querySelectorAll('input:not([type]), input[type="email"], input[type="text"], input[autocomplete="username"]')]
        .filter((element) => element !== password && visible(element));
      const username = usernames.find((element) => /user|email|login/i.test([element.autocomplete, element.name, element.id, element.placeholder].join(' '))) || usernames[0];
      if (username && credential.username) setInputValue(username, credential.username);
      setInputValue(password, credential.password);
      password.focus();
      return { filled: true, usernameFilled: Boolean(username && credential.username) };
    })()`, true);
  }
}

let mainWindow;
let petWindow;
let petStateStore;
let petMoveTimer;
const taskWindows = new Set();
const threadContexts = new ThreadContextRegistry();
const threadRecovery = new ThreadRecoveryCoordinator();
const windowThreadIds = threadContexts.windows;
const terminalFocusedWebContents = new Map();
let browserBridge;
let browserSessionManager;
let browserProfileImporter;
let browserCredentialVault;
let appServer;
let modelGateway;
let scheduledTaskStore;
let agentProfileStore;
let localMemoryStore;
let usageLedger;
let secretStore;
let cloudAccount;
let agentRuntime;
let schedulerTimer;
let activePowerBlockerId = null;
const scheduledRunsByThread = new Map();
const activeTurnIdsByThread = new Map();
const runtimeLoadedThreadIds = new Set();
const runtimeThreadLoadPromises = new Map();
const runtimeThreadReadyWaiters = new Map();
const threadLifecycleById = new Map();
const deferredPromptIds = new Set();
const goalsByThread = new Map();
const cuaDriverBinary = findCuaDriverBinary();
const cuaDriverApp = findCuaDriverApp();
let computerUseStatus = inspectComputerUse(cuaDriverBinary);
let collaborationModes = [];
let smokeStarted = false;
const terminalProcesses = new Map();
const managedAgents = new Map();
const tokenUsageByThread = new Map();
const lastAgentMessageByThread = new Map();
const queuedMessages = new Map();
const hookRuns = new Map();
const runtimeEvents = [];
const THREAD_RESTORE_SOFT_TIMEOUT_MS = 8_000;
const THREAD_RESTORE_TIMEOUT_MS = 120_000;
const TURN_CONTROL_TIMEOUT_MS = 15_000;
const AUTO_COMPACT_TOKEN_LIMIT = 220_000;
let runtimeRestartTimer = null;
let runtimeRestartAttempt = 0;
let runtimeRestartAt = null;
let runtimeStartPromise = null;
let runtimeStatus = "stopped";
let runtimeLastError = null;
let runtimeStartedAt = null;
let quitting = false;
let skillCatalogRevision = 1;
let skillCatalogRefreshedAt = null;
const skillCatalogByCwd = new Map();
const skillCatalogRefreshPromises = new Map();

function invalidateSkillCatalog() {
  skillCatalogRevision += 1;
  sendToRenderer("agent:event", { type: "skills-changed", revision: skillCatalogRevision });
}

async function refreshSkillCatalog(cwd, options = {}) {
  if (!appServer?.ready) throw new Error("Agent 运行时尚未就绪");
  const workdir = path.resolve(cwd || DEFAULT_CWD);
  const cached = skillCatalogByCwd.get(workdir);
  const forceReload = Boolean(options.forceReload) || !cached || cached.revision !== skillCatalogRevision;
  if (!forceReload) return cached.skills;
  if (skillCatalogRefreshPromises.has(workdir)) return skillCatalogRefreshPromises.get(workdir);
  const refresh = appServer.request("skills/list", { cwds: [workdir], forceReload: true })
    .then((result) => {
      const skills = flattenSkillsResponse(result);
      skillCatalogRefreshedAt = new Date().toISOString();
      skillCatalogByCwd.set(workdir, { revision: skillCatalogRevision, skills, refreshedAt: skillCatalogRefreshedAt });
      return skills;
    })
    .finally(() => skillCatalogRefreshPromises.delete(workdir));
  skillCatalogRefreshPromises.set(workdir, refresh);
  return refresh;
}

async function skillInputItemsForPrompt(cwd, prompt) {
  try {
    return buildSkillInputItems(prompt, await refreshSkillCatalog(cwd));
  } catch (error) {
    recordRuntimeEvent("warning", "Skills 动态刷新失败", error.message);
    return [];
  }
}

function threadIdForWindowContents(webContentsId) {
  return threadContexts.threadIdForWindow(webContentsId);
}

function mainWindowThreadId() {
  return mainWindow && !mainWindow.isDestroyed()
    ? threadIdForWindowContents(mainWindow.webContents.id)
    : null;
}

function mainWindowThreadContext() {
  return threadContexts.get(mainWindowThreadId());
}

function contextForThread(threadId, patch = null) {
  return patch ? threadContexts.ensure(threadId, patch) : threadContexts.get(threadId);
}

function bindWindowThread(webContentsId, threadId) {
  return threadContexts.bindWindow(webContentsId, threadId);
}

function updatePowerBlocker() {
  const shouldBlock = activeTurnIdsByThread.size > 0 || scheduledRunsByThread.size > 0;
  if (shouldBlock && activePowerBlockerId == null) {
    activePowerBlockerId = powerSaveBlocker.start("prevent-display-sleep");
  } else if (!shouldBlock && activePowerBlockerId != null) {
    if (powerSaveBlocker.isStarted(activePowerBlockerId)) powerSaveBlocker.stop(activePowerBlockerId);
    activePowerBlockerId = null;
  }
}

function setActiveTurn(threadId, turnId) {
  const id = String(threadId || "").trim();
  const turn = String(turnId || "").trim();
  if (id && turn) activeTurnIdsByThread.set(id, turn);
  updatePowerBlocker();
}

function clearActiveTurn(threadId) {
  activeTurnIdsByThread.delete(String(threadId || ""));
  updatePowerBlocker();
}

function clearAllActiveTurns() {
  activeTurnIdsByThread.clear();
  updatePowerBlocker();
}

function recordRuntimeEvent(level, title, detail = "") {
  const safeDetail = String(detail || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/(["']?(?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*)[^\s,}\]]+/gi, "$1[REDACTED]");
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), level, title, detail: safeDetail.slice(0, 2_000) };
  boundedPush(runtimeEvents, entry, 120);
  sendToRenderer("runtime:updated", runtimeSnapshot());
  return entry;
}

function runtimeSnapshot() {
  let browserUrl = null;
  const coordinated = agentRuntime?.snapshot() || { sessions: [], inFlight: [] };
  const selected = mainWindowThreadContext();
  try { browserUrl = browserBridge?.webContents?.getURL() || null; } catch {}
  return {
    status: runtimeStatus,
    ready: Boolean(appServer?.ready),
    restartAttempt: runtimeRestartAttempt,
    restartAt: runtimeRestartAt,
    lastError: runtimeLastError,
    startedAt: runtimeStartedAt,
    thread: { id: selected?.id || null, turnId: selected?.turnId || null, name: selected?.name || null },
      threadContexts: threadContexts.snapshot(),
      recovery: threadRecovery.snapshot(),
    components: {
      appServer: { status: appServer?.ready ? "healthy" : runtimeStatus, binary: appServer?.binary || null },
      sessionRuntime: { status: appServer?.ready ? "healthy" : runtimeStatus, sessions: coordinated.sessions.length, activeItems: coordinated.inFlight.length },
      modelGateway: { status: modelGateway?.server ? "healthy" : "stopped", url: modelGateway?.baseUrl || modelGateway?.url || null },
      browser: { status: browserBridge?.webContents ? "healthy" : "detached", url: browserUrl },
      computerUse: { status: computerUseStatus.running ? "healthy" : (computerUseStatus.available ? "attention" : "unavailable"), message: computerUseStatus.message },
      scheduler: { status: scheduledTaskStore ? "healthy" : "stopped", activeRuns: scheduledRunsByThread.size },
      terminal: { status: terminalProcesses.size ? "active" : "idle", sessions: terminalProcesses.size },
    },
    events: [...runtimeEvents].reverse(),
  };
}

function sendTerminalEvent(ownerWebContentsId, payload) {
  const target = webContents.fromId(ownerWebContentsId);
  if (target && !target.isDestroyed()) target.send("agent:event", payload);
}

function terminateOwnedTerminals(ownerWebContentsId) {
  for (const [processId, session] of terminalProcesses) {
    if (session.ownerWebContentsId !== ownerWebContentsId) continue;
    terminalProcesses.delete(processId);
    try { session.process.kill(); } catch {}
  }
}

function cancelRuntimeRestart() {
  if (runtimeRestartTimer) clearTimeout(runtimeRestartTimer);
  runtimeRestartTimer = null;
  runtimeRestartAt = null;
}

function scheduleRuntimeRestart(reason) {
  if (quitting || runtimeRestartTimer) return;
  runtimeRestartAttempt += 1;
  const delay = Math.min(30_000, 1_000 * (2 ** Math.min(runtimeRestartAttempt - 1, 5)));
  runtimeStatus = "recovering";
  runtimeRestartAt = new Date(Date.now() + delay).toISOString();
  recordRuntimeEvent("warning", `运行时将在 ${Math.round(delay / 1_000)} 秒后恢复`, reason);
  runtimeRestartTimer = setTimeout(() => {
    runtimeRestartTimer = null;
    runtimeRestartAt = null;
    void restartAppServer("automatic").catch((error) => scheduleRuntimeRestart(error.message));
  }, delay);
}

async function restoreActiveThread(client, threadId) {
  if (!threadId) return;
  const { settings, modelProvider, model } = providerContextForThread(threadId);
  const policy = readP0Settings().policy;
  const result = await client.request("thread/resume", {
    threadId, cwd: null, model, modelProvider,
    approvalPolicy: policy.approvalPolicy,
    approvalsReviewer: policy.approvalsReviewer,
    sandbox: policy.sandbox,
    config: buildThreadConfig(settings, knownThreadCwd(threadId), threadId),
    developerInstructions: developerInstructionsFor(knownThreadCwd(threadId)),
    deferGoalContinuation: true,
  }, { timeoutMs: THREAD_RESTORE_TIMEOUT_MS });
  runtimeLoadedThreadIds.add(threadId);
  applyActiveThread(result, threadId);
  agentRuntime?.rememberSession(result.thread, { model: result.model || model, cwd: result.thread?.cwd || knownThreadCwd(threadId) });
  threadContexts.update(threadId, { model: result.model || model });
  recordRuntimeEvent("success", "已恢复当前会话", threadId);
  sendToRenderer("agent:event", { type: "thread-recovered", threadId });
}

async function restartAppServer(reason = "manual") {
  if (runtimeStartPromise) return runtimeStartPromise;
  cancelRuntimeRestart();
  const threadId = mainWindowThreadId();
  appServer?.stop();
  appServer = null;
  skillCatalogRevision += 1;
  skillCatalogByCwd.clear();
  skillCatalogRefreshPromises.clear();
  runtimeLoadedThreadIds.clear();
  runtimeThreadLoadPromises.clear();
  for (const waiter of runtimeThreadReadyWaiters.values()) {
    waiter.reject(new Error("Agent 运行时已重启"));
  }
  runtimeThreadReadyWaiters.clear();
  clearAllActiveTurns();
  for (const [id] of threadLifecycleById) setThreadLifecycle(id, "idle");
  for (const context of threadContexts.threads.values()) {
    threadContexts.completeTurn(context.id, null, "interrupted");
  }
  runtimeStatus = "starting";
  recordRuntimeEvent("info", reason === "manual" ? "正在手动重启 Agent 运行时" : "正在自动恢复 Agent 运行时");
  runtimeStartPromise = initializeAppServer({ restoreThreadId: threadId })
    .then(() => runtimeSnapshot())
    .finally(() => { runtimeStartPromise = null; });
  return runtimeStartPromise;
}

const P0_DEFAULTS = {
  policy: {
    sandbox: "workspace-write",
    networkAccess: false,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    multiAgentMode: "explicitRequestOnly",
    maxAgents: 4,
  },
};

function p0SettingsPath() {
  return path.join(app.getPath("userData"), "p0-settings.json");
}

function readP0Settings() {
  try {
    const stored = JSON.parse(fs.readFileSync(p0SettingsPath(), "utf8"));
    return { ...P0_DEFAULTS, ...stored, policy: { ...P0_DEFAULTS.policy, ...(stored.policy || {}) } };
  } catch {
    return structuredClone(P0_DEFAULTS);
  }
}

function writeP0Settings(settings) {
  fs.mkdirSync(path.dirname(p0SettingsPath()), { recursive: true });
  fs.writeFileSync(p0SettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return settings;
}

function auditPath() {
  return path.join(app.getPath("userData"), "audit.jsonl");
}

function appendAudit(action, detail = {}) {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), action, detail };
  fs.appendFileSync(auditPath(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  sendToRenderer("agent:event", { type: "audit-entry", entry });
  return entry;
}

function readAudit(limit = 100) {
  try {
    return fs.readFileSync(auditPath(), "utf8").trim().split("\n").filter(Boolean).slice(-Math.max(1, Math.min(500, limit))).map((line) => JSON.parse(line)).reverse();
  } catch {
    return [];
  }
}

function sandboxPolicyFrom(policy) {
  if (policy.sandbox === "read-only") return { type: "readOnly", networkAccess: Boolean(policy.networkAccess) };
  if (policy.sandbox === "danger-full-access") return { type: "dangerFullAccess" };
  return { type: "workspaceWrite", writableRoots: [], networkAccess: Boolean(policy.networkAccess), excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}

function sendToRenderer(channel, value) {
  for (const window of taskWindows) {
    if (!window.isDestroyed()) window.webContents.send(channel, value);
  }
}

function petSkinCatalog() {
  const custom = (petStateStore?.snapshot().customSkins || []).filter((skin) => fs.existsSync(skin.path)).map((skin) => ({
    ...skin,
    subtitle: "用户导入",
    src: pathToFileURL(skin.path).href,
    builtIn: false,
  }));
  return [...BUILTIN_PET_SKINS, ...custom];
}

function decoratedPetState() {
  const state = petStateStore?.snapshot() || { visible: false, status: "idle", tasks: [], skinId: "onpeople", customSkins: [] };
  const skins = petSkinCatalog();
  const skin = skins.find((item) => item.id === state.skinId) || skins[0];
  return { ...state, skinId: skin.id, skin, skins };
}

function publishPetState() {
  const state = decoratedPetState();
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send("pet:state", state);
  sendToRenderer("pet:state", state);
  return state;
}

function defaultPetPosition(width, height) {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(workArea.x + workArea.width - width - 22),
    y: Math.round(workArea.y + workArea.height - height - 22),
  };
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const state = petStateStore.snapshot();
  const width = state.trayOpen ? 340 : 220;
  const height = state.trayOpen ? 420 : 260;
  const position = state.position || defaultPetPosition(width, height);
  petWindow = new BrowserWindow({
    x: position.x,
    y: position.y,
    width,
    height,
    minWidth: 220,
    minHeight: 260,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: "OnPeople 宠物",
    webPreferences: {
      preload: path.join(__dirname, "pet-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.on("move", () => {
    clearTimeout(petMoveTimer);
    petMoveTimer = setTimeout(() => {
      if (!petWindow?.isDestroyed()) {
        const [x, y] = petWindow.getPosition();
        petStateStore.saveSettings({ position: { x, y } });
      }
    }, 180);
  });
  petWindow.on("closed", () => { petWindow = null; });
  void petWindow.loadFile(path.join(__dirname, "pet.html")).then(() => publishPetState());
  return petWindow;
}

function showPet() {
  const window = createPetWindow();
  petStateStore.saveSettings({ visible: true });
  window.showInactive();
  publishPetState();
  return petStateStore.snapshot();
}

function hidePet() {
  petStateStore.saveSettings({ visible: false, trayOpen: false });
  if (petWindow && !petWindow.isDestroyed()) {
    const bounds = petWindow.getBounds();
    petWindow.setBounds({
      x: bounds.x + bounds.width - 220,
      y: bounds.y + bounds.height - 260,
      width: 220,
      height: 260,
    });
    petWindow.hide();
  }
  return publishPetState();
}

function togglePet() {
  const visible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  return visible ? hidePet() : showPet();
}

function sendToTaskThread(threadId, channel, value) {
  const id = String(threadId || "").trim();
  if (!id) return sendToRenderer(channel, value);
  for (const window of taskWindows) {
    if (!window.isDestroyed() && windowThreadIds.get(window.webContents.id) === id) window.webContents.send(channel, value);
  }
}

function publishScheduler() {
  const state = scheduledTaskStore?.snapshot() || { tasks: [], runs: [], unread: 0 };
  sendToRenderer("scheduler:updated", state);
  return state;
}

function notifyScheduledRun(run) {
  if (!Notification.isSupported()) return;
  const success = run.status === "completed";
  const notification = new Notification({
    title: success ? `计划任务完成 · ${run.taskName}` : `计划任务失败 · ${run.taskName}`,
    body: success ? (run.summary || "任务已经完成，打开通知中心查看记录。") : (run.error || "任务执行失败。"),
  });
  notification.on("click", () => {
    mainWindow?.show(); mainWindow?.focus();
    sendToRenderer("scheduler:open", {});
  });
  notification.show();
}

function notifyTaskState(threadId, title, body) {
  if (!Notification.isSupported()) return;
  const boundWindow = [...taskWindows].find((window) => (
    !window.isDestroyed() && windowThreadIds.get(window.webContents.id) === threadId
  ));
  if (boundWindow?.isFocused()) return;
  const notification = new Notification({ title, body: String(body || "").slice(0, 240) });
  notification.on("click", () => {
    const target = boundWindow && !boundWindow.isDestroyed() ? boundWindow : mainWindow;
    target?.show();
    target?.focus();
  });
  notification.show();
}

async function scheduledTaskCwd(task) {
  if (task.execution?.mode !== "worktree") return task.cwd;
  if (task.worktreePath && fs.existsSync(task.worktreePath)) return task.worktreePath;
  const created = await createWorktree({ cwd: task.cwd, name: `scheduled-${task.name}`, ref: task.execution.ref || "HEAD" });
  scheduledTaskStore.update(task.id, { worktreePath: created.path });
  task.worktreePath = created.path;
  appendAudit("scheduler.worktree.created", { taskId: task.id, path: created.path, branch: created.branch });
  return created.path;
}

async function runScheduledTask(task) {
  if (!scheduledTaskStore) throw new Error("计划任务存储尚未就绪");
  if ([...scheduledRunsByThread.values()].some((entry) => entry.taskId === task.id)) return { skipped: true, reason: "running" };
  if (task.destination?.mode === "thread" && activeTurnIdsByThread.has(task.destination.threadId)) {
    return { skipped: true, reason: "target-thread-busy" };
  }
  let run;
  try {
    if (!appServer?.ready) throw new Error("Agent 运行时尚未就绪");
    const taskCwd = await scheduledTaskCwd(task);
    run = scheduledTaskStore.beginRun(task);
    run.cwd = taskCwd;
    scheduledTaskStore.save();
    publishScheduler();
    const { settings, modelProvider, model } = providerContextForThread(task.destination?.threadId || null);
    const p0 = readP0Settings();
    const threadOptions = {
      cwd: taskCwd, model, modelProvider,
      approvalPolicy: "never",
      approvalsReviewer: p0.policy.approvalsReviewer,
      sandbox: p0.policy.sandbox,
      multiAgentMode: "explicitRequestOnly",
      config: buildThreadConfig(settings, taskCwd, task.destination?.threadId || `scheduled-${run.id}`),
      developerInstructions: developerInstructionsFor(taskCwd, "This is an unattended scheduled task. Stay within the configured sandbox. Do not request interactive approval; report any blocked action clearly."),
    };
    const started = task.destination?.mode === "thread"
      ? await appServer.request("thread/resume", { ...threadOptions, threadId: task.destination.threadId })
      : await appServer.request("thread/start", { ...threadOptions, ephemeral: false, serviceName: "onpeople-scheduled", threadSource: "appServer" });
    const threadId = started.thread.id;
    run.threadId = threadId;
    scheduledRunsByThread.set(threadId, { taskId: task.id, runId: run.id, summary: "" });
    updatePowerBlocker();
    const skillInputs = await skillInputItemsForPrompt(taskCwd, task.prompt);
    const turn = await appServer.request("turn/start", {
      threadId,
      input: [{ type: "text", text: task.prompt, text_elements: [] }, ...skillInputs],
      cwd: taskCwd,
      model,
    });
    run.turnId = turn.turn?.id || turn.turnId || null;
    scheduledTaskStore.save(); publishScheduler();
    appendAudit("scheduler.run.started", { taskId: task.id, runId: run.id, threadId });
    return { runId: run.id, threadId, turnId: run.turnId };
  } catch (error) {
    const failed = run ? scheduledTaskStore.finishRun(run.id, { status: "failed", error: error.message }) : null;
    appendAudit("scheduler.run.failed", { taskId: task.id, runId: run?.id || null, error: error.message });
    publishScheduler(); if (failed) notifyScheduledRun(failed);
    return { runId: run?.id || null, error: error.message };
  }
}

function handleScheduledNotification(message, threadId) {
  const active = scheduledRunsByThread.get(threadId);
  if (!active) return false;
  if (message.method === "item/agentMessage/delta") {
    active.summary = `${active.summary}${message.params?.delta || ""}`.slice(-4_000);
  }
  if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
    const text = message.params.item.text || message.params.item.content || "";
    if (typeof text === "string" && text.trim()) active.summary = text.slice(-4_000);
  }
  if (message.method === "turn/completed") {
    const turn = message.params?.turn || {};
    const failed = turn.status === "failed" || Boolean(turn.error);
    const result = scheduledTaskStore.finishRun(active.runId, {
      status: failed ? "failed" : "completed",
      summary: active.summary.trim().slice(0, 1_000),
      error: turn.error?.message || null,
    });
    scheduledRunsByThread.delete(threadId);
    updatePowerBlocker();
    appendAudit("scheduler.run.completed", { taskId: active.taskId, runId: active.runId, status: result?.status });
    publishScheduler(); if (result) notifyScheduledRun(result);
  }
  return true;
}

function failActiveScheduledRuns(message, notify = true) {
  for (const [threadId, active] of scheduledRunsByThread) {
    const result = scheduledTaskStore?.finishRun(active.runId, { status: "failed", summary: active.summary.trim().slice(0, 1_000), error: message });
    scheduledRunsByThread.delete(threadId);
    updatePowerBlocker();
    if (notify && result) notifyScheduledRun(result);
  }
  publishScheduler();
}

async function schedulerTick() {
  if (!scheduledTaskStore) return;
  for (const task of scheduledTaskStore.due()) await runScheduledTask(task);
}

function providerSettingsPath() {
  return path.join(app.getPath("userData"), "provider-settings.json");
}

function threadProviderSettingsPath() {
  return path.join(app.getPath("userData"), "thread-provider-settings.json");
}

function encodeStoredProvider(settings) {
  const stored = { type: settings.type, model: settings.model, baseUrl: settings.baseUrl };
  if (settings.apiKey && settings.type !== "onpeople") {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，无法保存 API Key");
    stored.encryptedApiKey = safeStorage.encryptString(settings.apiKey).toString("base64");
  }
  return stored;
}

function decodeStoredProvider(stored) {
  if (!stored?.type) return null;
  let apiKey = "";
  if (stored.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64")); } catch {}
  }
  return normalizeProviderSettings({ ...stored, apiKey }, readProviderSettings(stored.type));
}

function normalizeThreadProviderEntry(entry) {
  if (!entry || typeof entry !== "object") return { activeType: null, profiles: {} };
  if (entry.profiles && typeof entry.profiles === "object") {
    return {
      activeType: Object.hasOwn(PROVIDERS, entry.activeType) ? entry.activeType : null,
      profiles: { ...entry.profiles },
    };
  }
  const legacy = decodeStoredProvider(entry);
  return legacy
    ? { activeType: legacy.type, profiles: { [legacy.type]: encodeStoredProvider(legacy) } }
    : { activeType: null, profiles: {} };
}

function readThreadProviderSettings(threadId, requestedType = null) {
  const id = String(threadId || "").trim();
  if (!id) return null;
  try {
    const store = JSON.parse(fs.readFileSync(threadProviderSettingsPath(), "utf8"));
    const entry = normalizeThreadProviderEntry(store.threads?.[id]);
    const type = Object.hasOwn(PROVIDERS, requestedType) ? requestedType : entry.activeType;
    return type ? decodeStoredProvider(entry.profiles[type]) : null;
  } catch {
    return null;
  }
}

function persistThreadProviderSettings(threadId, settings) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("请先新建任务，再保存任务模型配置");
  let store = { threads: {} };
  try { store = JSON.parse(fs.readFileSync(threadProviderSettingsPath(), "utf8")); } catch {}
  store.threads ||= {};
  const entry = normalizeThreadProviderEntry(store.threads[id]);
  entry.activeType = settings.type;
  entry.profiles[settings.type] = encodeStoredProvider(settings);
  store.threads[id] = entry;
  fs.mkdirSync(path.dirname(threadProviderSettingsPath()), { recursive: true });
  fs.writeFileSync(threadProviderSettingsPath(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function readProviderStore() {
  try {
    return JSON.parse(fs.readFileSync(providerSettingsPath(), "utf8"));
  } catch {
    return { type: "openai", profiles: {} };
  }
}

function readProviderSettings(requestedType = null) {
  const store = readProviderStore();
  const type = Object.hasOwn(PROVIDERS, requestedType) ? requestedType : (Object.hasOwn(PROVIDERS, store.type) ? store.type : "openai");
  const preset = PROVIDERS[type];
  const legacy = store.profiles ? {} : store;
  const profile = store.profiles?.[type] || (type === store.type ? legacy : {});
  let apiKey = "";
  if (profile.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(profile.encryptedApiKey, "base64")); } catch {}
  }
  const cloudBaseUrl = type === "onpeople" && cloudAccount ? cloudAccount.apiBaseUrl() : null;
  const cloudApiKey = type === "onpeople" && cloudAccount ? cloudAccount.apiKey() : null;
  return {
    type,
    model: profile.model ?? preset.model,
    baseUrl: cloudBaseUrl || profile.baseUrl || preset.baseUrl,
    apiKey: type === "onpeople" ? (cloudApiKey || "") : apiKey,
  };
}

function publicProviderSettings(settings = readProviderSettings()) {
  const preset = PROVIDERS[settings.type] || PROVIDERS.openai;
  const imageGeneration = imageGenerationCapability(settings.type, Boolean(settings.apiKey));
  return {
    type: settings.type,
    model: settings.model,
    baseUrl: settings.baseUrl,
    hasApiKey: Boolean(settings.apiKey),
    requiresAccount: settings.type === "onpeople",
    accountSignedIn: settings.type === "onpeople" ? Boolean(cloudAccount?.accessToken() && cloudAccount?.apiKey()) : null,
    vision: preset.vision,
    protocol: preset.protocol,
    imageGeneration: imageGeneration.available,
    imageModel: imageGeneration.model,
    imageGenerationReason: imageGeneration.reason,
  };
}

function normalizeProviderSettings(input = {}, saved = readProviderSettings()) {
  const type = Object.hasOwn(PROVIDERS, input.type) ? input.type : saved.type;
  const baseline = type === saved.type ? saved : readProviderSettings(type);
  const model = String(input.model ?? baseline.model ?? "").trim();
  let baseUrl = String(type === "onpeople" && cloudAccount ? cloudAccount.apiBaseUrl() : (input.baseUrl ?? baseline.baseUrl ?? "")).trim().replace(/\/$/, "");
  if (PROVIDERS[type].protocol !== "local") {
    if (!baseUrl) throw new Error(`${PROVIDERS[type].name} 需要 API Base URL`);
    const parsed = new URL(baseUrl);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("API Base URL 仅支持 HTTP(S)");
    if (!model) throw new Error(`${PROVIDERS[type].name} 需要模型名称`);
  }
  const apiKey = type === "onpeople"
    ? (cloudAccount?.apiKey() || "")
    : (input.apiKey ? String(input.apiKey) : baseline.apiKey);
  return { type, model, baseUrl, apiKey };
}

function persistProviderSettings(input) {
  const settings = normalizeProviderSettings(input);
  const existing = readProviderStore();
  const profiles = existing.profiles || {};
  const profile = { model: settings.model, baseUrl: settings.baseUrl };
  if (settings.apiKey && settings.type !== "onpeople") {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，无法保存 API Key");
    profile.encryptedApiKey = safeStorage.encryptString(settings.apiKey).toString("base64");
  }
  const stored = { type: settings.type, profiles: { ...profiles, [settings.type]: profile } };
  fs.mkdirSync(path.dirname(providerSettingsPath()), { recursive: true });
  fs.writeFileSync(providerSettingsPath(), `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return publicProviderSettings(settings);
}

function buildThreadConfig(providerSettings, workspaceRoot = null, routeId = null) {
  const p0 = readP0Settings();
  const config = {
    features: { goals: true, collaboration_modes: true, hooks: true },
    // Third-party model metadata is not always rich enough for Codex Core to
    // choose a useful automatic compaction threshold. Keep long-running Goal
    // threads responsive instead of replaying an unbounded transcript.
    model_auto_compact_token_limit: AUTO_COMPACT_TOKEN_LIMIT,
    model_auto_compact_token_limit_scope: "total",
    sandbox_workspace_write: { network_access: Boolean(p0.policy.networkAccess) },
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
        default_tools_approval_mode: "writes",
        tools: {
          browser_navigate: { approval_mode: "approve" },
          browser_snapshot: { approval_mode: "approve" },
          browser_visual_snapshot: { approval_mode: "approve" },
          browser_annotations: { approval_mode: "approve" },
          browser_click: { approval_mode: "approve" },
          browser_fill: { approval_mode: "approve" },
          browser_press_key: { approval_mode: "approve" },
          browser_select: { approval_mode: "approve" },
          browser_scroll: { approval_mode: "approve" },
          browser_hover: { approval_mode: "approve" },
          browser_wait: { approval_mode: "approve" },
          browser_upload: { approval_mode: "approve" },
        },
      },
      workspace_artifacts: {
        command: process.execPath,
        args: [ARTIFACT_MCP_SCRIPT],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          ONPEOPLE_WORKSPACE_ROOT: workspaceRoot || DEFAULT_CWD,
        },
        startup_timeout_sec: 15,
        tool_timeout_sec: 120,
        default_tools_approval_mode: "writes",
      },
    },
  };
  const preset = PROVIDERS[providerSettings.type];
  const imageGeneration = imageGenerationCapability(providerSettings.type, Boolean(providerSettings.apiKey));
  if (preset.protocol !== "local") {
    const gatewayBaseUrl = modelGateway.registerRoute(
      routeId || crypto.randomUUID(),
      { ...providerSettings, protocol: preset.protocol },
    );
    if (imageGeneration.available) {
      config.mcp_servers.image_generation = {
        command: process.execPath,
        args: [IMAGE_GENERATION_MCP_SCRIPT],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          ONPEOPLE_WORKSPACE_ROOT: workspaceRoot || DEFAULT_CWD,
          ONPEOPLE_IMAGE_BASE_URL: providerSettings.baseUrl,
          ONPEOPLE_IMAGE_API_KEY: providerSettings.apiKey || "",
          ONPEOPLE_IMAGE_MODEL: imageGeneration.model,
        },
        startup_timeout_sec: 10,
        tool_timeout_sec: 360,
        default_tools_approval_mode: "writes",
      };
    }
    config.model_providers = {
      onpeople: {
        name: `${preset.name} via OnPeople`,
        base_url: gatewayBaseUrl,
        wire_api: "responses",
        requires_openai_auth: false,
      },
    };
  }
  if (cuaDriverBinary && computerUseStatus.running) {
    config.mcp_servers.computer_use = {
      command: cuaDriverBinary,
      args: computerUseMcpArgs(),
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
  const requestedThreadId = String(payload.threadId || "").trim();
  if (requestedThreadId) {
    const existing = contextForThread(requestedThreadId);
    const resumed = await ensureRuntimeThread(requestedThreadId, { cwd, model: payload.model || existing?.model || null });
    return {
      threadId: requestedThreadId,
      cwd: resumed?.cwd || cwd,
      created: false,
      model: payload.model || resumed?.model || existing?.model || null,
      reasoningEffort: resumed?.reasoningEffort || existing?.reasoningEffort || null,
      provider: existing?.provider || null,
    };
  }
  const savedSettings = readProviderSettings();
  const settings = normalizeProviderSettings({
    type: payload.modelProvider,
    model: payload.model,
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
  }, savedSettings);
  if (settings.apiKey && settings.apiKey !== savedSettings.apiKey) {
    throw new Error("请先保存模型配置，让 Agent 安全加载新的 API Key");
  }
  const provider = PROVIDERS[settings.type].protocol === "local" ? settings.type : "onpeople";
  const model = settings.model || null;
  const p0 = readP0Settings();
  const gatewayRouteId = `pending-${crypto.randomUUID()}`;
  const result = await appServer.request("thread/start", {
    cwd,
    model,
    modelProvider: provider,
    approvalPolicy: p0.policy.approvalPolicy,
    approvalsReviewer: p0.policy.approvalsReviewer,
    sandbox: p0.policy.sandbox,
    multiAgentMode: p0.policy.multiAgentMode,
    config: buildThreadConfig(settings, cwd, gatewayRouteId),
    ephemeral: false,
    serviceName: "onpeople",
    threadSource: "appServer",
    developerInstructions: developerInstructionsFor(cwd),
  });
  runtimeLoadedThreadIds.add(result.thread.id);
  const threadCwd = result.thread.cwd || cwd;
  const threadModel = result.model || model;
  const context = threadContexts.ensure(result.thread.id, {
    name: result.thread.name || null,
    cwd: threadCwd,
    model: threadModel,
    reasoningEffort: result.reasoningEffort || null,
    provider: { ...settings },
    gatewayRouteId,
  });
  rememberThread({ ...result.thread, cwd: threadCwd });
  agentRuntime?.rememberSession(result.thread, { model: threadModel, cwd: threadCwd });
  return { threadId: result.thread.id, cwd: threadCwd, created: true, model: threadModel, reasoningEffort: context.reasoningEffort, provider: context.provider };
}

function setThreadLifecycle(threadId, phase, detail = {}) {
  const id = String(threadId || "").trim();
  if (!id) return null;
  const state = {
    phase,
    turnId: activeTurnIdsByThread.get(id) || null,
    error: detail.error ? String(detail.error) : null,
    updatedAt: Date.now(),
  };
  threadLifecycleById.set(id, state);
  sendToRenderer("agent:event", {
    type: "thread-lifecycle",
    threadId: id,
    state,
  });
  return state;
}

function signalRuntimeThreadReady(threadId, source = "notification") {
  const id = String(threadId || "").trim();
  if (!id) return false;
  runtimeLoadedThreadIds.add(id);
  threadRecovery.ready(id, source);
  const waiter = runtimeThreadReadyWaiters.get(id);
  if (waiter) {
    runtimeThreadReadyWaiters.delete(id);
    waiter.resolve({ id, source });
  }
  return Boolean(waiter);
}

function rememberRuntimeThread(threadId, result, fallback = {}) {
  const id = String(threadId || "").trim();
  const thread = result?.thread || { id, cwd: fallback.cwd || knownThreadCwd(id) };
  const cwd = thread.cwd || fallback.cwd || knownThreadCwd(id) || DEFAULT_CWD;
  const previous = contextForThread(id);
  const model = result?.model || fallback.model || previous?.model || null;
  runtimeLoadedThreadIds.add(id);
  rememberThread({ ...thread, id, cwd });
  agentRuntime?.rememberSession({ ...thread, id, cwd }, { model, cwd });
  threadContexts.ensure(id, {
    name: thread.name || previous?.name || null,
    cwd,
    model,
    reasoningEffort: result?.reasoningEffort || previous?.reasoningEffort || null,
    provider: previous?.provider || null,
    turnId: activeTurnIdsByThread.get(id) || previous?.turnId || null,
  });
  setThreadLifecycle(id, activeTurnIdsByThread.has(id) ? "running" : "idle");
  return { ...thread, id, cwd, model, reasoningEffort: result?.reasoningEffort || null };
}

async function ensureRuntimeThread(threadId, options = {}) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("缺少任务 ID");
  if (runtimeLoadedThreadIds.has(id)) return { id, cwd: knownThreadCwd(id), model: options.model || contextForThread(id)?.model || null };
  if (runtimeThreadLoadPromises.has(id)) return runtimeThreadLoadPromises.get(id);
  threadRecovery.begin(id);
  setThreadLifecycle(id, "restoring");
  const promise = (async () => {
    const { settings, modelProvider, model } = providerContextForThread(id);
    const policy = readP0Settings().policy;
    const cwd = options.cwd || knownThreadCwd(id) || DEFAULT_CWD;
    let result;
    let readyResolve;
    const readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      runtimeThreadReadyWaiters.set(id, { resolve, reject });
    });
    const softTimer = setTimeout(() => {
      if (!runtimeLoadedThreadIds.has(id)) {
        threadRecovery.degraded(id, "任务恢复响应较慢，仍在后台继续");
        setThreadLifecycle(id, "degraded", { error: "任务恢复响应较慢，仍在后台继续" });
      }
    }, THREAD_RESTORE_SOFT_TIMEOUT_MS);
    const resumeRequest = appServer.request("thread/resume", {
      threadId: id,
      cwd: null,
      model: options.model || model,
      modelProvider,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandbox: policy.sandbox,
      config: buildThreadConfig(settings, cwd, id),
      developerInstructions: developerInstructionsFor(cwd),
      // Restoring a Session must not synchronously continue a persistent
      // Goal. The UI and queued user input decide what happens next.
      deferGoalContinuation: true,
    }, { timeoutMs: THREAD_RESTORE_TIMEOUT_MS });
    try {
      const outcome = await Promise.race([
        resumeRequest.then((value) => ({ type: "response", value })),
        readyPromise.then((value) => ({ type: "ready", value })),
      ]);
      if (outcome.type === "ready") {
        threadRecovery.ready(id, outcome.value?.source || "notification");
        const provisional = rememberRuntimeThread(id, null, { cwd, model: options.model || model });
        // Some large persistent-goal sessions register successfully and emit
        // status/token events before thread/resume sends its final JSON-RPC
        // response. Do not block user input on that bookkeeping response.
        void resumeRequest
          .then((value) => rememberRuntimeThread(id, value, { cwd, model: options.model || model }))
          .catch((error) => {
            if (!runtimeLoadedThreadIds.has(id)) {
              setThreadLifecycle(id, "failed", { error: error.message });
              return;
            }
            recordRuntimeEvent("warning", "任务恢复回包延迟", `${id}: ${error.message}`);
          });
        return provisional;
      }
      result = outcome.value;
      threadRecovery.ready(id, "response");
    } catch (error) {
      if (!/(already|exists|loaded)/i.test(String(error?.message || error))) throw error;
      result = await appServer.request("thread/read", { threadId: id, includeTurns: false }, { timeoutMs: TURN_CONTROL_TIMEOUT_MS });
    } finally {
      clearTimeout(softTimer);
      const waiter = runtimeThreadReadyWaiters.get(id);
      if (waiter?.resolve === readyResolve) runtimeThreadReadyWaiters.delete(id);
    }
    return rememberRuntimeThread(id, result, { cwd, model: options.model || model });
  })();
  runtimeThreadLoadPromises.set(id, promise);
  try {
    return await promise;
  } catch (error) {
    runtimeLoadedThreadIds.delete(id);
    threadRecovery.failed(id, error.message);
    setThreadLifecycle(id, "failed", { error: error.message });
    recordRuntimeEvent("error", "任务恢复失败", `${id}: ${error.message}`);
    throw error;
  } finally {
    if (runtimeThreadLoadPromises.get(id) === promise) runtimeThreadLoadPromises.delete(id);
  }
}

async function setCollaborationMode(mode, threadId, selectedModel = null, reasoningEffort = null) {
  if (!threadId) throw new Error("Start a thread before changing modes");
  const context = contextForThread(threadId);
  const preset = collaborationModes.find((item) => item.mode === mode);
  const model = selectedModel || context?.model || preset?.model;
  if (!model) throw new Error("The active model is not available for collaboration mode");
  await appServer.request("thread/settings/update", {
    threadId,
    collaborationMode: {
      mode,
      settings: {
        model,
        reasoning_effort: mode === "plan" ? (preset?.reasoning_effort || reasoningEffort || context?.reasoningEffort) : (reasoningEffort || context?.reasoningEffort),
        developer_instructions: null,
      },
    },
  });
}

async function startAgentTurn(payload) {
  const thread = await ensureThread(payload);
  const { cwd, threadId } = thread;
  const settings = providerContextForThread(threadId, thread.provider || null).settings;
  const images = Array.isArray(payload.images) ? payload.images : [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments.slice(0, 20) : [];
  if (images.length && !PROVIDERS[settings.type].vision) throw new Error(`${PROVIDERS[settings.type].name} 当前配置不支持图片输入`);
  for (const imagePath of images) {
    if (!path.isAbsolute(imagePath) || !fs.existsSync(imagePath)) throw new Error("图片路径无效或文件不存在");
  }
  const attachmentLines = attachments.map((entry) => {
    const candidate = path.resolve(String(entry?.path || entry || ""));
    if (!path.isAbsolute(candidate) || !fs.existsSync(candidate)) throw new Error("附件路径无效或文件不存在");
    const stat = fs.statSync(candidate);
    return `- ${stat.isDirectory() ? "folder" : "file"}: ${candidate}`;
  });
  const capabilityInstruction = CAPABILITY_INSTRUCTIONS[payload.capability] || "";
  const turnText = [capabilityInstruction, payload.prompt, attachmentLines.length ? `<onpeople_attachments>\n${attachmentLines.join("\n")}\n</onpeople_attachments>` : ""].filter(Boolean).join("\n\n");
  const mode = payload.mode === "plan" ? "plan" : "default";
  await setCollaborationMode(mode, threadId, payload.model || thread.model, thread.reasoningEffort);
  const skillInputs = await skillInputItemsForPrompt(cwd, turnText);
  const result = await appServer.request("turn/start", {
    threadId,
    input: [
      ...images.map((imagePath) => ({ type: "localImage", path: imagePath, detail: "auto" })),
      { type: "text", text: turnText, text_elements: [] },
      ...skillInputs,
    ],
    cwd,
    model: payload.model || null,
  });
  const turnId = result.turn?.id || result.turnId || null;
  if (turnId) setActiveTurn(threadId, turnId);
  threadContexts.startTurn(threadId, turnId);
  if (thread.created) {
    const threadName = String(payload.prompt || "新任务").replace(/\s+/g, " ").trim().slice(0, 64) || "新任务";
    threadContexts.update(threadId, { name: threadName });
    rememberThread({ id: threadId, name: threadName, cwd });
    void appServer.request("thread/name/set", { threadId, name: threadName }).catch(() => {});
  }
  return { threadId, turnId };
}

async function dispatchAgentPrompt(payload) {
  const threadId = String(payload?.threadId || "").trim();
  const activeTurnId = threadId ? activeTurnIdsByThread.get(threadId) : null;
  if (!threadId || !activeTurnId) return startAgentTurn(payload);
  const prompt = String(payload?.prompt || "").trim();
  if (!prompt) throw new Error("补充指令不能为空");
  try {
    const skillInputs = await skillInputItemsForPrompt(payload?.cwd || knownThreadCwd(threadId), prompt);
    await appServer.request("turn/steer", {
      threadId,
      expectedTurnId: activeTurnId,
      input: [{ type: "text", text: prompt, text_elements: [] }, ...skillInputs],
    }, { timeoutMs: TURN_CONTROL_TIMEOUT_MS });
    appendAudit("context.steer", { threadId, turnId: activeTurnId, source: "composer" });
    return { threadId, turnId: activeTurnId, steered: true };
  } catch (error) {
    const message = String(error?.message || error);
    if (!/(no active|not active|not found|already completed|turn.+(?:completed|missing)|expected.+turn)/i.test(message)) throw error;
    clearActiveTurn(threadId);
    threadContexts.completeTurn(threadId, activeTurnId, "idle");
    setThreadLifecycle(threadId, "idle");
    return startAgentTurn(payload);
  }
}

function deferPromptUntilThreadReady(senderId, payload, restorePromise) {
  const threadId = String(payload?.threadId || "").trim();
  const clientMessageId = String(payload?.clientMessageId || crypto.randomUUID());
  if (deferredPromptIds.has(clientMessageId)) return clientMessageId;
  deferredPromptIds.add(clientMessageId);
  void Promise.resolve(restorePromise)
    .then(() => dispatchAgentPrompt(payload))
    .then((result) => {
      bindWindowThread(senderId, result.threadId);
      sendToTaskThread(result.threadId, "agent:event", {
        type: "message-delivery",
        threadId: result.threadId,
        clientMessageId,
        status: "sent",
        turnId: result.turnId || null,
        steered: Boolean(result.steered),
      });
    })
    .catch((error) => {
      sendToTaskThread(threadId, "agent:event", {
        type: "message-delivery",
        threadId,
        clientMessageId,
        status: "failed",
        message: error.message,
      });
    })
    .finally(() => deferredPromptIds.delete(clientMessageId));
  return clientMessageId;
}

async function setGoal(payload) {
  const thread = await ensureThread(payload);
  const { cwd, threadId } = thread;
  const attachments = Array.isArray(payload.attachments) ? payload.attachments.slice(0, 20) : [];
  const attachmentLines = attachments.map((entry) => {
    const candidate = path.resolve(String(entry?.path || entry || ""));
    if (!fs.existsSync(candidate)) throw new Error("附件路径无效或文件不存在");
    return `- ${fs.statSync(candidate).isDirectory() ? "folder" : "file"}: ${candidate}`;
  });
  const objective = [CAPABILITY_INSTRUCTIONS[payload.capability] || "", String(payload.objective || "").trim(), attachmentLines.length ? `<onpeople_attachments>\n${attachmentLines.join("\n")}\n</onpeople_attachments>` : ""].filter(Boolean).join("\n\n");
  if (!objective) throw new Error("目标不能为空");
  if (objective.length > 4_000) throw new Error("目标不能超过 4,000 个字符；请把详细要求写入文件后引用它");
  await refreshSkillCatalog(cwd);
  await setCollaborationMode("default", threadId, payload.model || thread.model, thread.reasoningEffort);
  const params = { threadId, objective, status: "active" };
  if (payload.tokenBudget !== null && payload.tokenBudget !== undefined && payload.tokenBudget !== "") {
    const tokenBudget = Number(payload.tokenBudget);
    if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) throw new Error("Token 预算必须是正整数");
    params.tokenBudget = tokenBudget;
  }
  const result = await appServer.request("thread/goal/set", params);
  goalsByThread.set(threadId, result.goal);
  threadContexts.update(threadId, { goal: result.goal });
  sendToTaskThread(threadId, "agent:event", { type: "goal-state", threadId, goal: result.goal });
  return { threadId, goal: result.goal };
}

async function updateGoal(threadId, action, value) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("当前没有任务");
  if (action === "clear") {
    await appServer.request("thread/goal/clear", { threadId: id });
    goalsByThread.delete(id);
    threadContexts.update(id, { goal: null });
    sendToTaskThread(id, "agent:event", { type: "goal-state", threadId: id, goal: null });
    return { goal: null };
  }
  const params = { threadId: id };
  if (action === "pause") params.status = "paused";
  else if (action === "resume") params.status = "active";
  else if (action === "edit") {
    const objective = String(value || "").trim();
    if (!objective || objective.length > 4_000) throw new Error("目标必须为 1–4,000 个字符");
    await refreshSkillCatalog(knownThreadCwd(id));
    params.objective = objective;
  } else throw new Error(`Unknown goal action: ${action}`);
  const result = await appServer.request("thread/goal/set", params);
  goalsByThread.set(id, result.goal);
  threadContexts.update(id, { goal: result.goal });
  sendToTaskThread(id, "agent:event", { type: "goal-state", threadId: id, goal: result.goal });
  return { goal: result.goal };
}

function providerContextForThread(threadId = null, overrides = null) {
  const context = threadContexts.get(threadId);
  const persisted = readThreadProviderSettings(threadId);
  const saved = context?.provider
    ? normalizeProviderSettings(context.provider, readProviderSettings(context.provider.type))
    : (persisted || readProviderSettings());
  const settings = normalizeProviderSettings(overrides || {}, saved);
  return {
    settings,
    modelProvider: PROVIDERS[settings.type].protocol === "local" ? settings.type : "onpeople",
    model: settings.model || null,
  };
}

function providerProfileForThread(threadId, requestedType) {
  const type = Object.hasOwn(PROVIDERS, requestedType) ? requestedType : "openai";
  const context = threadContexts.get(threadId);
  if (context?.provider?.type === type) {
    return normalizeProviderSettings(context.provider, readProviderSettings(type));
  }
  return readThreadProviderSettings(threadId, type) || readProviderSettings(type);
}

function refreshOnPeopleRoutes() {
  for (const context of threadContexts.snapshot().threads) {
    if (context.provider?.type !== "onpeople") continue;
    const settings = normalizeProviderSettings(context.provider, readProviderSettings("onpeople"));
    threadContexts.update(context.id, { provider: { ...settings } });
    if (context.gatewayRouteId) {
      modelGateway.registerRoute(context.gatewayRouteId, { ...settings, protocol: PROVIDERS.onpeople.protocol });
    }
  }
}

async function applyThreadProvider(threadId, settings) {
  const id = String(threadId || "").trim();
  if (!id) return { applied: false, reason: "no-thread" };
  const context = threadContexts.ensure(id);
  const routeId = context.gatewayRouteId || id;
  const protocol = PROVIDERS[settings.type].protocol;
  if (protocol !== "local") modelGateway.registerRoute(routeId, { ...settings, protocol });
  threadContexts.update(id, {
    provider: { ...settings },
    model: settings.model || null,
    gatewayRouteId: routeId,
    pendingProvider: null,
  });
  if (appServer?.ready && runtimeLoadedThreadIds.has(id)) {
    await appServer.request("thread/settings/update", {
      threadId: id,
      model: settings.model || null,
    });
  }
  return { applied: true, routeId };
}

async function listThreads({ search = "", archived = false } = {}) {
  const searchTerm = String(search || "").trim();
  const result = await appServer.request("thread/list", {
    limit: 100,
    archived: Boolean(archived),
    searchTerm: searchTerm || null,
    sortKey: "recency_at",
    sortDirection: "desc",
  });
  const uiState = readThreadUiState();
  const pinned = new Set(uiState.pinnedThreadIds);
  const unread = new Set(uiState.unreadThreadIds);
  const archivedIds = new Set(uiState.archivedThreadIds);
  const merged = new Map();
  for (const thread of readLocalSessionIndex()) {
    const isArchived = archivedIds.has(thread.id);
    if (isArchived === Boolean(archived)) merged.set(thread.id, thread);
  }
  for (const thread of uiState.threads) {
    const isArchived = archivedIds.has(thread.id);
    if (isArchived === Boolean(archived)) merged.set(thread.id, { ...(merged.get(thread.id) || {}), ...thread });
  }
  for (const thread of result.data || []) merged.set(thread.id, { ...(merged.get(thread.id) || {}), ...thread });
  for (const [threadId] of activeTurnIdsByThread) {
    const known = merged.get(threadId) || readThreadUiState().threads.find((thread) => thread.id === threadId);
    if (known) merged.set(threadId, { ...known, status: { type: "active", activeFlags: ["running"] } });
  }
  if (!archived) {
    for (const context of threadContexts.threads.values()) {
      const title = context.name || "新任务";
      const matches = !searchTerm || title.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase());
      if (matches && !merged.has(context.id)) {
        merged.set(context.id, {
          id: context.id,
          name: title,
          preview: title,
          cwd: context.cwd || DEFAULT_CWD,
          recencyAt: Math.floor(context.updatedAt / 1000),
          status: context.turnId ? { type: "active" } : { type: "saved" },
        });
      }
    }
  }
  const normalizedSearch = searchTerm.toLocaleLowerCase();
  const threads = [...merged.values()].filter((thread) => {
    if (!normalizedSearch) return true;
    return String(thread.name || thread.preview || "").toLocaleLowerCase().includes(normalizedSearch);
  }).map((thread) => {
    const projectPath = path.resolve(thread.cwd || thread.workingDirectory || DEFAULT_CWD);
    return {
      ...thread,
      pinned: pinned.has(thread.id),
      unread: unread.has(thread.id),
      projectPath,
      projectName: path.basename(projectPath) || projectPath,
    };
  });
  threads.sort((left, right) => Number(right.pinned) - Number(left.pinned)
    || threadRecency(right) - threadRecency(left));
  const metadata = new Map(uiState.projects.map((project) => [project.path, project]));
  const projects = [...new Set([...uiState.projectPaths, ...uiState.hiddenProjectPaths])].map((projectPath) => ({
    path: projectPath,
    name: metadata.get(projectPath)?.name || path.basename(projectPath) || projectPath,
    pinned: Boolean(metadata.get(projectPath)?.pinned),
    hidden: uiState.hiddenProjectPaths.includes(projectPath),
  }));
  return { threads, projects, nextCursor: result.nextCursor || null };
}

function threadUiStatePath() {
  return path.join(app.getPath("userData"), "thread-ui-state.json");
}

function readThreadUiState() {
  try {
    const stored = JSON.parse(fs.readFileSync(threadUiStatePath(), "utf8"));
    return {
      pinnedThreadIds: [...new Set((stored.pinnedThreadIds || []).filter((id) => typeof id === "string" && id))],
      unreadThreadIds: [...new Set((stored.unreadThreadIds || []).filter((id) => typeof id === "string" && id))],
      archivedThreadIds: [...new Set((stored.archivedThreadIds || []).filter((id) => typeof id === "string" && id))],
      projectPaths: [...new Set((stored.projectPaths || []).filter((item) => typeof item === "string" && path.isAbsolute(item)))],
      projects: (stored.projects || []).filter((item) => item && typeof item.path === "string" && path.isAbsolute(item.path)).map((item) => ({
        path: path.resolve(item.path),
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 80) : null,
        pinned: Boolean(item.pinned),
      })),
      hiddenProjectPaths: [...new Set((stored.hiddenProjectPaths || []).filter((item) => typeof item === "string" && path.isAbsolute(item)).map((item) => path.resolve(item)))],
      threads: (stored.threads || []).filter((thread) => thread && typeof thread.id === "string").slice(-500),
    };
  } catch {
    return { pinnedThreadIds: [], unreadThreadIds: [], archivedThreadIds: [], projectPaths: [], projects: [], hiddenProjectPaths: [], threads: [] };
  }
}

function knownThreadCwd(threadId) {
  const id = String(threadId || "");
  const contextCwd = threadContexts.get(id)?.cwd;
  const saved = readThreadUiState().threads.find((thread) => thread.id === id)?.cwd;
  return contextCwd || saved || DEFAULT_CWD;
}

function generatedImagePath(threadId, candidate) {
  const cwd = path.resolve(knownThreadCwd(threadId));
  const generatedRoot = path.join(cwd, ".onpeople", "generated-images");
  const selected = path.resolve(String(candidate || ""));
  if (selected !== generatedRoot && !selected.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error("图片不在当前任务的生成目录中");
  }
  if (!fs.existsSync(selected) || !fs.statSync(selected).isFile()) throw new Error("生成图片不存在或已移动");
  const extension = path.extname(selected).toLowerCase();
  const mimeType = extension === ".png" ? "image/png"
    : extension === ".webp" ? "image/webp"
      : new Set([".jpg", ".jpeg"]).has(extension) ? "image/jpeg" : null;
  if (!mimeType) throw new Error("不支持的生成图片格式");
  const buffer = fs.readFileSync(selected);
  if (!buffer.length || buffer.length > 48 * 1024 * 1024) throw new Error("生成图片为空或超过 48 MB");
  return { path: selected, name: path.basename(selected), mimeType, bytes: buffer.length, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
}

function writeThreadUiState(state) {
  fs.writeFileSync(threadUiStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function threadRecency(thread) {
  const value = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt ?? 0;
  if (typeof value === "number") return value > 10_000_000_000 ? value / 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

function readLocalSessionIndex() {
  const indexPath = path.join(app.getPath("userData"), "codex-home", "session_index.jsonl");
  try {
    const records = new Map();
    for (const line of fs.readFileSync(indexPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (!item.id) continue;
        records.set(item.id, {
          id: item.id,
          name: item.thread_name || "未命名任务",
          preview: item.thread_name || "未命名任务",
          updatedAt: item.updated_at || null,
          recencyAt: item.updated_at ? Math.floor(Date.parse(item.updated_at) / 1000) : 0,
          status: { type: "saved" },
        });
      } catch {}
    }
    return [...records.values()];
  } catch {
    return [];
  }
}

const localRolloutPathCache = new Map();

function findLocalRolloutPath(threadId) {
  const id = String(threadId || "").trim();
  if (!id) return null;
  const cached = localRolloutPathCache.get(id);
  if (cached && fs.existsSync(cached)) return cached;
  const root = path.join(app.getPath("userData"), "codex-home", "sessions");
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name.endsWith(`${id}.jsonl`)) {
        localRolloutPathCache.set(id, candidate);
        return candidate;
      }
    }
  }
  return null;
}

function rolloutMessageText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n").trim();
}

function visibleRolloutUserText(text) {
  const value = String(text || "").trim();
  if (!value || value.startsWith("<environment_context>")) return "";
  if (value.startsWith("<codex_internal_context")) return value.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/)?.[1]?.trim() || "";
  return value;
}

function readLocalThreadSnapshot(threadId) {
  const id = String(threadId || "").trim();
  const rolloutPath = findLocalRolloutPath(id);
  if (!rolloutPath) return null;
  const saved = readThreadUiState().threads.find((thread) => thread.id === id) || {};
  const thread = { id, name: saved.name || saved.preview || "未命名任务", preview: saved.preview || saved.name || "未命名任务", cwd: saved.cwd || DEFAULT_CWD, turns: [], status: { type: "saved" } };
  const turnsById = new Map();
  let currentTurn = null;
  let goal = null;
  const ensureTurn = (turnId = null) => {
    const key = String(turnId || currentTurn?.id || `history-${thread.turns.length + 1}`);
    if (!turnsById.has(key)) {
      const turn = { id: key, status: "completed", items: [] };
      turnsById.set(key, turn);
      thread.turns.push(turn);
    }
    currentTurn = turnsById.get(key);
    return currentTurn;
  };
  try {
    for (const line of fs.readFileSync(rolloutPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const payload = record.payload || {};
      if (record.type === "session_meta") {
        thread.cwd = payload.cwd || payload.workingDirectory || thread.cwd;
        continue;
      }
      if (record.type === "event_msg" && payload.type === "thread_goal_updated") {
        goal = payload.goal || goal;
        continue;
      }
      if (record.type === "event_msg" && payload.type === "task_started") {
        const turn = ensureTurn(payload.turn_id || payload.turnId);
        turn.status = "inProgress";
        continue;
      }
      if (record.type === "event_msg" && new Set(["task_complete", "turn_aborted"]).has(payload.type)) {
        const turn = ensureTurn(payload.turn_id || payload.turnId);
        turn.status = payload.type === "turn_aborted" ? "interrupted" : "completed";
        continue;
      }
      if (record.type !== "response_item" || payload.type !== "message") continue;
      const text = rolloutMessageText(payload);
      if (payload.role === "user") {
        const visible = visibleRolloutUserText(text);
        if (visible) ensureTurn().items.push({ type: "userMessage", content: [{ type: "text", text: visible }] });
      } else if (payload.role === "assistant" && text) {
        ensureTurn().items.push({ type: "agentMessage", text, phase: payload.phase || "final", status: "completed" });
      }
    }
  } catch { return null; }
  const activeTurn = [...thread.turns].reverse().find((turn) => turn.status === "inProgress") || null;
  thread.status = activeTurn ? { type: "active", activeFlags: ["running"] } : { type: "saved" };
  return { thread, goal, running: Boolean(activeTurn), turnId: activeTurn?.id || null };
}

function rememberThread(thread) {
  if (!thread?.id) return;
  const state = readThreadUiState();
  const previous = state.threads.find((item) => item.id === thread.id) || {};
  const record = {
    ...previous,
    id: thread.id,
    name: thread.name || thread.preview || previous.name || "未命名任务",
    preview: thread.preview || thread.name || previous.preview || "未命名任务",
    cwd: thread.cwd || thread.workingDirectory || previous.cwd || DEFAULT_CWD,
    updatedAt: new Date().toISOString(),
    recencyAt: Math.floor(Date.now() / 1000),
  };
  state.threads = [...state.threads.filter((item) => item.id !== thread.id), record].slice(-500);
  writeThreadUiState(state);
}

function setThreadArchivedState(threadId, archived) {
  const state = readThreadUiState();
  const ids = new Set(state.archivedThreadIds);
  if (archived) ids.add(threadId); else ids.delete(threadId);
  state.archivedThreadIds = [...ids];
  writeThreadUiState(state);
}

async function pickProject(defaultPath) {
  const candidate = typeof defaultPath === "string" && path.isAbsolute(defaultPath) ? defaultPath : DEFAULT_CWD;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择项目文件夹",
    buttonLabel: "添加项目",
    defaultPath: candidate,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const projectPath = path.resolve(result.filePaths[0]);
  const stat = fs.statSync(projectPath);
  if (!stat.isDirectory()) throw new Error("请选择一个项目文件夹");
  const state = readThreadUiState();
  state.projectPaths = [...new Set([...state.projectPaths, projectPath])];
  state.hiddenProjectPaths = state.hiddenProjectPaths.filter((item) => item !== projectPath);
  if (!state.projects.some((item) => item.path === projectPath)) state.projects.push({ path: projectPath, name: null, pinned: false });
  writeThreadUiState(state);
  return { path: projectPath, name: path.basename(projectPath) || projectPath };
}

function updateProjectState(projectPath, action, value = null) {
  const rawPath = String(projectPath || "").trim();
  if (!rawPath || !path.isAbsolute(rawPath)) throw new Error("项目路径无效");
  const selected = path.resolve(rawPath);
  const state = readThreadUiState();
  const existing = state.projects.find((item) => item.path === selected) || { path: selected, name: null, pinned: false };
  if (action === "pin") existing.pinned = Boolean(value);
  else if (action === "rename") {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) throw new Error("项目名称必须为 1–80 个字符");
    existing.name = name;
  } else if (action === "remove") {
    state.projectPaths = state.projectPaths.filter((item) => item !== selected);
    state.projects = state.projects.filter((item) => item.path !== selected);
    state.hiddenProjectPaths = [...new Set([...state.hiddenProjectPaths, selected])];
    writeThreadUiState(state);
    return { path: selected, removed: true };
  } else throw new Error("不支持的项目操作");
  state.projects = [...state.projects.filter((item) => item.path !== selected), existing];
  state.projectPaths = [...new Set([...state.projectPaths, selected])];
  state.hiddenProjectPaths = state.hiddenProjectPaths.filter((item) => item !== selected);
  writeThreadUiState(state);
  return { ...existing, name: existing.name || path.basename(selected) || selected };
}

async function archiveProjectThreads(projectPath) {
  const rawPath = String(projectPath || "").trim();
  if (!rawPath || !path.isAbsolute(rawPath)) throw new Error("项目路径无效");
  const selected = path.resolve(rawPath);
  const result = await listThreads({ archived: false, search: "" });
  const targets = result.threads.filter((thread) => path.resolve(thread.projectPath || "") === selected);
  const running = targets.filter((thread) => activeTurnIdsByThread.has(thread.id));
  if (running.length) throw new Error(`该项目仍有 ${running.length} 个任务正在运行，请先停止`);
  for (const thread of targets) {
    await appServer.request("thread/archive", { threadId: thread.id });
    setThreadArchivedState(thread.id, true);
    threadContexts.remove(thread.id);
  }
  appendAudit("project.threads.archived", { projectPath: selected, count: targets.length });
  return { path: selected, archived: targets.length };
}

function setThreadPinned(threadId, pinned) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("缺少任务 ID");
  const state = readThreadUiState();
  const ids = new Set(state.pinnedThreadIds);
  if (pinned) ids.add(id); else ids.delete(id);
  state.pinnedThreadIds = [...ids];
  writeThreadUiState(state);
  return { threadId: id, pinned: Boolean(pinned) };
}

function setThreadUnread(threadId, unread) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("缺少任务 ID");
  const state = readThreadUiState();
  const ids = new Set(state.unreadThreadIds);
  if (unread) ids.add(id); else ids.delete(id);
  state.unreadThreadIds = [...ids];
  writeThreadUiState(state);
  return { threadId: id, unread: Boolean(unread) };
}

async function renameThread(threadId, value) {
  const id = String(threadId || "").trim();
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!id) throw new Error("缺少任务 ID");
  if (!name || name.length > 80) throw new Error("任务名称必须为 1–80 个字符");
  await ensureRuntimeThread(id, { cwd: knownThreadCwd(id), model: contextForThread(id)?.model || null });
  await appServer.request("thread/name/set", { threadId: id, name }, { timeoutMs: TURN_CONTROL_TIMEOUT_MS });
  const state = readThreadUiState();
  const previous = state.threads.find((thread) => thread.id === id) || { id, cwd: knownThreadCwd(id) };
  rememberThread({ ...previous, id, name, preview: name });
  threadContexts.update(id, { name });
  return { threadId: id, name };
}

function revealThread(threadId) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("缺少任务 ID");
  const cwd = path.resolve(knownThreadCwd(id));
  if (!fs.existsSync(cwd)) throw new Error("任务工作目录不存在或已移动");
  shell.showItemInFolder(cwd);
  return { threadId: id, path: cwd, revealed: true };
}

function applyActiveThread(result, requestedThreadId = null) {
  const threadId = result?.thread?.id || requestedThreadId;
  if (!threadId) throw new Error("任务恢复结果缺少 threadId");
  const previous = contextForThread(threadId);
  const cwd = result?.thread?.cwd || previous?.cwd || knownThreadCwd(threadId) || DEFAULT_CWD;
  const context = threadContexts.ensure(threadId, {
    turnId: activeTurnIdsByThread.get(threadId) || null,
    name: result?.thread?.name || previous?.name || null,
    cwd,
    model: result?.model || previous?.model || null,
    reasoningEffort: result?.reasoningEffort || previous?.reasoningEffort || null,
    goal: goalsByThread.get(threadId) || previous?.goal || null,
  });
  rememberThread({ ...(result?.thread || {}), id: threadId, cwd });
  return context;
}

async function resumeThread(threadId) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("缺少任务 ID");
  const { settings, model } = providerContextForThread(id);
  const provider = publicProviderSettings(settings);
  const local = readLocalThreadSnapshot(id);
  if (local) {
    rememberThread(local.thread);
    agentRuntime?.rememberSession(local.thread, { model, cwd: local.thread.cwd });
    if (local.goal) goalsByThread.set(id, local.goal);
    threadContexts.ensure(id, {
      name: local.thread.name || null,
      cwd: local.thread.cwd || knownThreadCwd(id),
      model,
      goal: local.goal || null,
      turnId: activeTurnIdsByThread.get(id) || null,
    });
    // An unfinished turn in a persisted rollout may simply mean the previous
    // app process exited mid-turn. Only live App Server events are allowed to
    // populate activeTurnIdsByThread.
    const liveTurnId = activeTurnIdsByThread.get(id) || null;
    const restoring = !runtimeLoadedThreadIds.has(id);
    void ensureRuntimeThread(id, { cwd: local.thread.cwd, model }).catch((error) => {
      recordRuntimeEvent("warning", "历史任务后台恢复失败", `${id}: ${error.message}`);
    });
    return { ...local, model, provider, running: Boolean(liveTurnId), restoring, turnId: liveTurnId };
  }
  await ensureRuntimeThread(id, { cwd: knownThreadCwd(id), model });
  const result = await appServer.request("thread/read", { threadId: id, includeTurns: true }, { timeoutMs: TURN_CONTROL_TIMEOUT_MS });
  const thread = result.thread;
  const threadCwd = thread.cwd || knownThreadCwd(thread.id) || DEFAULT_CWD;
  rememberThread({ ...thread, cwd: threadCwd });
  agentRuntime?.rememberSession(thread, { model: result.model || model, cwd: threadCwd });
  const status = thread.status || {};
  const statusIsActive = status.type === "active";
  const lastTurn = Array.isArray(thread.turns) ? thread.turns.at(-1) : null;
  if (statusIsActive && lastTurn?.id && !activeTurnIdsByThread.has(thread.id)) setActiveTurn(thread.id, lastTurn.id);
  const goal = goalsByThread.get(thread.id) || null;
  void appServer.request("thread/goal/get", { threadId: thread.id }).then((goalResult) => {
    const nextGoal = goalResult.goal || null;
    if (nextGoal) goalsByThread.set(thread.id, nextGoal); else goalsByThread.delete(thread.id);
    sendToTaskThread(thread.id, "agent:event", { type: "goal-state", threadId: thread.id, goal: nextGoal });
  }).catch(() => {});
  setThreadLifecycle(thread.id, statusIsActive || activeTurnIdsByThread.has(thread.id) ? "running" : "idle");
  threadContexts.ensure(thread.id, {
    name: thread.name || null,
    cwd: threadCwd,
    model: result.model || model,
    reasoningEffort: result.reasoningEffort || null,
    goal,
    turnId: activeTurnIdsByThread.get(thread.id) || null,
  });
  return { thread, goal, model: result.model || model, provider, running: statusIsActive || activeTurnIdsByThread.has(thread.id), restoring: false, turnId: activeTurnIdsByThread.get(thread.id) || null };
}

async function forkThread(threadId) {
  const { settings, modelProvider, model } = providerContextForThread(threadId);
  const p0 = readP0Settings();
  const result = await appServer.request("thread/fork", {
    threadId,
    model,
    modelProvider,
    approvalPolicy: p0.policy.approvalPolicy,
    approvalsReviewer: p0.policy.approvalsReviewer,
    sandbox: p0.policy.sandbox,
    config: buildThreadConfig(settings, knownThreadCwd(threadId), `fork-${crypto.randomUUID()}`),
    developerInstructions: developerInstructionsFor(knownThreadCwd(threadId)),
    deferGoalContinuation: true,
    ephemeral: false,
  });
  const thread = result.thread;
  const threadName = thread.name ? `${thread.name} · 分叉` : "分叉任务";
  await appServer.request("thread/name/set", { threadId: thread.id, name: threadName });
  thread.name = threadName;
  rememberThread({ ...thread, cwd: thread.cwd || knownThreadCwd(threadId) || DEFAULT_CWD });
  goalsByThread.delete(thread.id);
  threadContexts.ensure(thread.id, {
    name: threadName,
    cwd: thread.cwd || knownThreadCwd(threadId) || DEFAULT_CWD,
    model: result.model || model,
    reasoningEffort: result.reasoningEffort || null,
    provider: { ...settings },
  });
  return { thread, goal: null, model: result.model || model, provider: publicProviderSettings(settings) };
}

async function archiveThread(threadId) {
  if (activeTurnIdsByThread.has(threadId)) throw new Error("当前任务仍在运行，请先停止");
  await appServer.request("thread/archive", { threadId });
  setThreadArchivedState(threadId, true);
  for (const [windowId, boundThreadId] of windowThreadIds) {
    if (boundThreadId === threadId) bindWindowThread(windowId, null);
  }
  goalsByThread.delete(threadId);
  threadContexts.remove(threadId);
  return { archived: true, activeThreadId: mainWindowThreadId() };
}

async function unarchiveThread(threadId) {
  await appServer.request("thread/unarchive", { threadId });
  setThreadArchivedState(threadId, false);
  return { unarchived: true };
}

function publicAgent(agent) {
  return {
    id: agent.id,
    threadId: agent.threadId,
    parentThreadId: agent.parentThreadId,
    turnId: agent.turnId,
    name: agent.name,
    role: agent.role,
    prompt: agent.prompt,
    model: agent.model,
    effort: agent.effort,
    cwd: agent.cwd,
    status: agent.status,
    activeFlags: agent.activeFlags || [],
    startedAt: agent.startedAt,
    completedAt: agent.completedAt || null,
    error: agent.error || null,
    summary: agent.summary || null,
  };
}

function publishAgents() {
  sendToRenderer("agent:event", { type: "agents-updated", agents: [...managedAgents.values()].map(publicAgent) });
}

async function spawnManagedAgent(payload = {}) {
  if (!appServer?.ready) throw new Error("Agent 运行时尚未就绪");
  const p0 = readP0Settings();
  const activeCount = [...managedAgents.values()].filter((agent) => new Set(["starting", "running", "waitingOnApproval", "waitingOnUserInput"]).has(agent.status)).length;
  if (activeCount >= p0.policy.maxAgents) throw new Error(`已达到 ${p0.policy.maxAgents} 个并行 Agent 的限制`);
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new Error("请输入子 Agent 的任务");
  const role = String(payload.role || "worker").trim().slice(0, 40) || "worker";
  const name = String(payload.name || role).trim().slice(0, 64) || "子 Agent";
  const cwd = String(payload.cwd || DEFAULT_CWD);
  const parentThreadId = String(payload.parentThreadId || mainWindowThreadId() || "").trim() || null;
  const { settings, modelProvider, model: defaultModel } = providerContextForThread(parentThreadId);
  const model = String(payload.model || defaultModel || "").trim() || null;
  const effort = String(payload.effort || "medium");
  const requestedSandbox = new Set(["read-only", "workspace-write", "danger-full-access"]).has(payload.sandbox) ? payload.sandbox : p0.policy.sandbox;
  const profileInstructions = String(payload.instructions || "").replace(/\0/g, "").trim().slice(0, 8_000);
  const delegatedInstructions = [`You are the ${role} sub-agent. Work only on the delegated task and return a concise handoff to the parent task.`, profileInstructions].filter(Boolean).join("\n\n");
  const agent = {
    id: crypto.randomUUID(), parentThreadId, name, role, prompt, model, effort, cwd,
    threadId: null, turnId: null, status: "starting", startedAt: Date.now(),
  };
  managedAgents.set(agent.id, agent);
  publishAgents();
  try {
    let started;
    if (parentThreadId && !activeTurnIdsByThread.has(parentThreadId)) {
      started = await appServer.request("thread/fork", {
        threadId: parentThreadId,
        model,
        modelProvider,
        approvalPolicy: p0.policy.approvalPolicy,
        approvalsReviewer: p0.policy.approvalsReviewer,
        sandbox: requestedSandbox,
        config: buildThreadConfig(settings, cwd, `agent-${agent.id}`),
        developerInstructions: developerInstructionsFor(cwd, delegatedInstructions),
        deferGoalContinuation: true,
        ephemeral: false,
        threadSource: "subAgent",
      });
    } else {
      started = await appServer.request("thread/start", {
        cwd, model, modelProvider,
        approvalPolicy: p0.policy.approvalPolicy,
        approvalsReviewer: p0.policy.approvalsReviewer,
        sandbox: requestedSandbox,
        config: buildThreadConfig(settings, cwd, `agent-${agent.id}`),
        ephemeral: false,
        serviceName: "onpeople",
        threadSource: "subAgent",
        developerInstructions: developerInstructionsFor(cwd, delegatedInstructions),
      });
    }
    agent.threadId = started.thread.id;
    await appServer.request("thread/settings/update", { threadId: agent.threadId, cwd, model, effort });
    await appServer.request("thread/name/set", { threadId: agent.threadId, name: `${name} · ${role}` });
    publishAgents();
    const skillInputs = await skillInputItemsForPrompt(cwd, prompt);
    const turn = await appServer.request("turn/start", {
      threadId: agent.threadId,
      cwd,
      model,
      input: [{ type: "text", text: prompt, text_elements: [] }, ...skillInputs],
    });
    agent.turnId = turn.turn?.id || turn.turnId || null;
    agent.status = "running";
    appendAudit("agent.spawn", { agentId: agent.id, threadId: agent.threadId, parentThreadId, role, model, effort, cwd });
    publishAgents();
    return publicAgent(agent);
  } catch (error) {
    agent.status = "failed";
    agent.error = error.message;
    agent.completedAt = Date.now();
    publishAgents();
    throw error;
  }
}

async function sendManagedAgentMessage(agentId, text) {
  const agent = managedAgents.get(agentId);
  if (!agent?.threadId) throw new Error("找不到子 Agent");
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("追加指令不能为空");
  const skillInputs = await skillInputItemsForPrompt(agent.cwd, prompt);
  let result;
  if (agent.turnId && new Set(["running", "waitingOnApproval", "waitingOnUserInput"]).has(agent.status)) {
    result = await appServer.request("turn/steer", {
      threadId: agent.threadId,
      expectedTurnId: agent.turnId,
      input: [{ type: "text", text: prompt, text_elements: [] }, ...skillInputs],
    });
  } else {
    result = await appServer.request("turn/start", {
      threadId: agent.threadId,
      cwd: agent.cwd,
      model: agent.model,
      input: [{ type: "text", text: prompt, text_elements: [] }, ...skillInputs],
    });
    agent.turnId = result.turn?.id || result.turnId || null;
    agent.status = "running";
    agent.completedAt = null;
  }
  appendAudit("agent.message", { agentId, threadId: agent.threadId, mode: agent.status === "running" ? "steer-or-turn" : "turn" });
  publishAgents();
  return publicAgent(agent);
}

async function stopManagedAgent(agentId) {
  const agent = managedAgents.get(agentId);
  if (!agent?.threadId || !agent.turnId) return { stopped: false };
  await appServer.request("turn/interrupt", { threadId: agent.threadId, turnId: agent.turnId });
  agent.status = "stopped";
  agent.completedAt = Date.now();
  appendAudit("agent.stop", { agentId, threadId: agent.threadId });
  publishAgents();
  return { stopped: true };
}

async function readManagedAgent(agentId) {
  const agent = managedAgents.get(agentId);
  if (!agent?.threadId) throw new Error("找不到子 Agent");
  const result = await appServer.request("thread/read", { threadId: agent.threadId, includeTurns: true });
  return { agent: publicAgent(agent), thread: result.thread };
}

async function gitRoot(cwd) {
  return (await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).stdout.trim();
}

async function initGitRepository(cwd) {
  const selected = path.resolve(String(cwd || "").trim() || DEFAULT_CWD);
  if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) throw new Error("当前项目目录不存在或不可读取");
  const existingRoot = await gitRoot(selected).catch(() => null);
  if (existingRoot) return getGitState(existingRoot);
  await execFileAsync("git", ["-C", selected, "init"]);
  appendAudit("git.init", { root: selected });
  return getGitState(selected);
}

function managedWorktreeRoot() {
  return path.join(app.getPath("userData"), "worktrees");
}

function parseWorktrees(raw) {
  return raw.trim().split(/\n\s*\n/).filter(Boolean).map((block) => {
    const item = {};
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ");
      item[key] = rest.join(" ") || true;
    }
    const worktreePath = String(item.worktree || "");
    return {
      path: worktreePath,
      head: item.HEAD || null,
      branch: String(item.branch || "").replace(/^refs\/heads\//, "") || (item.detached ? "detached" : "unknown"),
      bare: Boolean(item.bare),
      managed: worktreePath.startsWith(`${managedWorktreeRoot()}${path.sep}`),
    };
  });
}

async function listWorktrees(cwd) {
  const root = await gitRoot(cwd || DEFAULT_CWD);
  const { stdout } = await execFileAsync("git", ["-C", root, "worktree", "list", "--porcelain"]);
  return { root, worktrees: parseWorktrees(stdout) };
}

async function createWorktree(payload = {}) {
  const root = await gitRoot(payload.cwd || DEFAULT_CWD);
  const slug = String(payload.name || "task").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "task";
  const suffix = Date.now().toString(36);
  const branch = `onpeople/${slug}-${suffix}`;
  await execFileAsync("git", ["check-ref-format", "--branch", branch]);
  const destination = path.join(managedWorktreeRoot(), path.basename(root), `${slug}-${suffix}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "-b", branch, destination, String(payload.ref || "HEAD")]);
  appendAudit("worktree.create", { root, path: destination, branch });
  return { root, path: destination, branch };
}

async function openEditorLocation(payload = {}) {
  const file = resolveOpenableWorkspaceFile(payload.cwd || DEFAULT_CWD, payload.path);
  const line = Math.max(1, Math.min(10_000_000, Number(payload.line) || 1));
  const column = Math.max(1, Math.min(100_000, Number(payload.column) || 1));
  if (shouldUseSystemPreview(file)) {
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return { opened: true, file, line, editor: "system-preview" };
  }
  const candidates = editorCandidates({ file, line, column });
  const selected = candidates.find((item) => isExecutable(item.binary));
  if (selected) {
    const child = spawn(selected.binary, selected.args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { opened: true, file, line, editor: path.basename(selected.binary) };
  }
  const error = await shell.openPath(file);
  if (error) throw new Error(error);
  return { opened: true, file, line, editor: "system" };
}

async function submitInlineReview(payload = {}) {
  const prompt = formatReviewPrompt(payload.comments);
  if (!appServer?.ready) throw new Error("Agent 运行时尚未就绪");
  const threadId = String(payload.threadId || "").trim() || null;
  const context = contextForThread(threadId);
  if (threadId && activeTurnIdsByThread.has(threadId)) return steerTurn(threadId, prompt);
  return startAgentTurn({
    threadId,
    prompt,
    cwd: payload.cwd || DEFAULT_CWD,
    mode: "default",
    images: [],
    model: context?.model || null,
    reasoningEffort: context?.reasoningEffort || null,
  });
}

async function handoffWorktree(worktreePath, threadId = null) {
  const selected = path.resolve(String(worktreePath || ""));
  if (!fs.existsSync(selected)) throw new Error("Worktree 不存在");
  const root = await gitRoot(selected);
  if (root !== selected) throw new Error("请选择 Worktree 根目录");
  const id = String(threadId || "").trim() || null;
  if (id) {
    await appServer.request("thread/settings/update", { threadId: id, cwd: selected });
    threadContexts.update(id, { cwd: selected });
  }
  appendAudit("worktree.handoff", { threadId: id, cwd: selected });
  return { cwd: selected, threadId: id };
}

async function snapshotWorktree(worktreePath) {
  const selected = path.resolve(String(worktreePath || ""));
  const root = await gitRoot(selected);
  if (root !== selected) throw new Error("请选择 Worktree 根目录");
  const [{ stdout: diff }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["-C", selected, "diff", "--binary", "HEAD"]),
    execFileAsync("git", ["-C", selected, "status", "--short", "--branch"]),
  ]);
  const snapshotDir = path.join(app.getPath("userData"), "worktree-snapshots");
  fs.mkdirSync(snapshotDir, { recursive: true });
  const file = path.join(snapshotDir, `${path.basename(selected)}-${Date.now()}.patch`);
  fs.writeFileSync(file, `# ${status.trim()}\n${diff}`, "utf8");
  appendAudit("worktree.snapshot", { path: selected, file });
  return { file, status: status.trim(), bytes: Buffer.byteLength(diff) };
}

async function removeWorktree(worktreePath) {
  const selected = path.resolve(String(worktreePath || ""));
  const managedRoot = path.resolve(managedWorktreeRoot());
  if (!selected.startsWith(`${managedRoot}${path.sep}`)) throw new Error("只能清理 OnPeople 管理的 Worktree");
  const root = await gitRoot(selected);
  const main = (await execFileAsync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
  const repoRoot = path.resolve(root, main, "..");
  await snapshotWorktree(selected);
  await execFileAsync("git", ["-C", repoRoot, "worktree", "remove", selected]);
  appendAudit("worktree.remove", { path: selected });
  return { removed: true };
}

function contextState(threadId = null) {
  const usage = threadId ? tokenUsageByThread.get(threadId) || null : null;
  return {
    threadId,
    turnId: threadId ? (activeTurnIdsByThread.get(threadId) || null) : null,
    lifecycle: threadId ? (threadLifecycleById.get(threadId) || null) : null,
    usage,
    queued: threadId ? queuedMessages.get(threadId) || [] : [],
  };
}

async function compactThread(threadId) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("当前没有任务");
  if (activeTurnIdsByThread.has(id)) throw new Error("当前任务仍在运行，请等待或先停止");
  const result = await appServer.request("thread/compact/start", { threadId: id });
  appendAudit("context.compact", { threadId: id });
  return { ...result, state: contextState(id) };
}

async function steerTurn(threadId, text) {
  const id = String(threadId || "").trim();
  const turnId = activeTurnIdsByThread.get(id) || null;
  if (!id || !turnId) throw new Error("当前没有可转向的运行任务");
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("转向指令不能为空");
  const skillInputs = await skillInputItemsForPrompt(knownThreadCwd(id), prompt);
  const result = await appServer.request("turn/steer", {
    threadId: id,
    expectedTurnId: turnId,
    input: [{ type: "text", text: prompt, text_elements: [] }, ...skillInputs],
  });
  appendAudit("context.steer", { threadId: id, turnId });
  return result;
}

function queueThreadMessage(threadId, text) {
  const id = String(threadId || "").trim();
  if (!id) throw new Error("当前没有任务");
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("排队消息不能为空");
  const queue = queuedMessages.get(id) || [];
  queue.push({ id: crypto.randomUUID(), text: prompt, queuedAt: Date.now() });
  queuedMessages.set(id, queue);
  appendAudit("context.queue", { threadId: id, queueLength: queue.length });
  return contextState(id);
}

async function applyPolicy(input = {}, threadId = null) {
  const settings = readP0Settings();
  const sandbox = new Set(["read-only", "workspace-write", "danger-full-access"]).has(input.sandbox) ? input.sandbox : settings.policy.sandbox;
  const approvalPolicy = new Set(["untrusted", "on-request", "never"]).has(input.approvalPolicy) ? input.approvalPolicy : settings.policy.approvalPolicy;
  const approvalsReviewer = new Set(["user", "auto_review"]).has(input.approvalsReviewer) ? input.approvalsReviewer : settings.policy.approvalsReviewer;
  const multiAgentMode = new Set(["explicitRequestOnly", "proactive"]).has(input.multiAgentMode) ? input.multiAgentMode : settings.policy.multiAgentMode;
  const maxAgents = Math.max(1, Math.min(16, Number(input.maxAgents) || settings.policy.maxAgents));
  settings.policy = { sandbox, approvalPolicy, approvalsReviewer, multiAgentMode, maxAgents, networkAccess: Boolean(input.networkAccess) };
  writeP0Settings(settings);
  if (threadId) {
    await appServer.request("thread/settings/update", {
      threadId,
      approvalPolicy,
      approvalsReviewer,
      sandboxPolicy: sandboxPolicyFrom(settings.policy),
    });
  }
  appendAudit("policy.update", settings.policy);
  return settings.policy;
}

const HOOK_EVENTS = new Set(["PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SessionStart", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop"]);

async function listHooks(cwd) {
  const workdir = path.resolve(cwd || DEFAULT_CWD);
  const result = await appServer.request("hooks/list", { cwds: [workdir] });
  return { entries: result.data || [], runs: [...hookRuns.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 100) };
}

async function createProjectHook(payload = {}) {
  const cwd = path.resolve(payload.cwd || DEFAULT_CWD);
  if (!HOOK_EVENTS.has(payload.event)) throw new Error("不支持的 Hook 生命周期");
  const command = String(payload.command || "").trim();
  if (!command || command.length > 4_000) throw new Error("Hook 命令必须为 1–4,000 个字符");
  const matcher = String(payload.matcher || "").trim();
  const codexDir = path.join(cwd, ".codex");
  const file = path.join(codexDir, "hooks.json");
  fs.mkdirSync(codexDir, { recursive: true });
  let config = { description: "OnPeople project lifecycle hooks", hooks: {} };
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  config.hooks ||= {};
  config.hooks[payload.event] ||= [];
  config.hooks[payload.event].push({
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "command", command, timeout: Math.max(1, Math.min(600, Number(payload.timeout) || 30)), statusMessage: String(payload.statusMessage || "OnPeople Hook").slice(0, 120) }],
  });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  appendAudit("hook.create", { cwd, file, event: payload.event, matcher, commandHash: crypto.createHash("sha256").update(command).digest("hex") });
  return { created: true, file, requiresTrustReview: true };
}

async function startNextQueuedMessage(threadId) {
  const queue = queuedMessages.get(threadId) || [];
  if (!queue.length || activeTurnIdsByThread.has(threadId)) return;
  const next = queue.shift();
  queuedMessages.set(threadId, queue);
  try {
    const skillInputs = await skillInputItemsForPrompt(knownThreadCwd(threadId), next.text);
    const result = await appServer.request("turn/start", {
      threadId,
      input: [{ type: "text", text: next.text, text_elements: [] }, ...skillInputs],
    });
    const turnId = result.turn?.id || result.turnId || null;
    if (turnId) setActiveTurn(threadId, turnId);
    threadContexts.startTurn(threadId, turnId);
    sendToRenderer("agent:event", { type: "queued-message-started", message: next, state: contextState(threadId) });
  } catch (error) {
    queue.unshift(next);
    queuedMessages.set(threadId, queue);
    sendToRenderer("agent:event", { type: "context-error", message: error.message });
  }
}

async function getGitState(cwd) {
  const workdir = cwd || DEFAULT_CWD;
  const root = await gitRoot(workdir);
  const [{ stdout: status }, { stdout: porcelain }, { stdout: unstaged }, { stdout: staged }, { stdout: branch }, remotesResult, upstreamResult] = await Promise.all([
    execFileAsync("git", ["-C", root, "status", "--short", "--branch"]),
    execFileAsync("git", ["-C", root, "status", "--porcelain=v1", "-z"]),
    execFileAsync("git", ["-C", root, "diff", "--no-ext-diff", "--no-color", "--unified=3"]),
    execFileAsync("git", ["-C", root, "diff", "--cached", "--no-ext-diff", "--no-color", "--unified=3"]),
    execFileAsync("git", ["-C", root, "branch", "--show-current"]),
    execFileAsync("git", ["-C", root, "remote"]).catch(() => ({ stdout: "" })),
    execFileAsync("git", ["-C", root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => ({ stdout: "" })),
  ]);
  const diff = [staged && "# STAGED\n", staged, unstaged && "# UNSTAGED\n", unstaged].filter(Boolean).join("\n");
  const remotes = remotesResult.stdout.split("\n").map((item) => item.trim()).filter(Boolean);
  const remoteUrls = Object.fromEntries(await Promise.all(remotes.map(async (remote) => {
    const result = await execFileAsync("git", ["-C", root, "remote", "get-url", remote]).catch(() => ({ stdout: "" }));
    return [remote, result.stdout.trim()];
  })));
  const defaultRemote = remotes.includes("origin") ? "origin" : remotes[0] || null;
  const baseResult = defaultRemote
    ? await execFileAsync("git", ["-C", root, "symbolic-ref", `refs/remotes/${defaultRemote}/HEAD`, "--short"]).catch(() => ({ stdout: "" }))
    : { stdout: "" };
  return {
    root,
    branch: branch.trim() || "detached",
    upstream: upstreamResult.stdout.trim() || null,
    remotes,
    remoteUrls,
    baseBranch: baseResult.stdout.trim().replace(`${defaultRemote}/`, "") || "main",
    canPreparePr: Boolean(upstreamResult.stdout.trim() && defaultRemote && githubRepositoryFromRemote(remoteUrls[defaultRemote])),
    status: status.trim(),
    files: parsePorcelainV1Z(porcelain),
    diff: diff || "工作区没有可显示的文本差异。",
  };
}

async function getGitDiff(cwd, filePath) {
  const root = await gitRoot(cwd || DEFAULT_CWD);
  const relative = safeRepoPath(root, filePath);
  const state = await getGitState(root);
  const file = state.files.find((item) => item.path === relative);
  if (!file) return { path: relative, diff: "这个文件当前没有未提交差异。" };
  if (file.untracked) return { path: relative, diff: `# UNTRACKED\n${relative}\n\n暂存后即可查看标准 Git Diff。` };
  const [{ stdout: staged }, { stdout: unstaged }] = await Promise.all([
    execFileAsync("git", ["-C", root, "diff", "--cached", "--no-ext-diff", "--no-color", "--unified=3", "--", relative]),
    execFileAsync("git", ["-C", root, "diff", "--no-ext-diff", "--no-color", "--unified=3", "--", relative]),
  ]);
  const diff = [staged && "# STAGED\n", staged, unstaged && "# UNSTAGED\n", unstaged].filter(Boolean).join("\n");
  return { path: relative, diff: diff || "这个文件当前没有可显示的文本差异。" };
}

async function gitHunks(cwd, filePath) {
  const root = await gitRoot(cwd || DEFAULT_CWD);
  const relative = safeRepoPath(root, filePath);
  const [{ stdout: staged }, { stdout: unstaged }] = await Promise.all([
    execFileAsync("git", ["-C", root, "diff", "--cached", "--no-ext-diff", "--no-color", "--unified=3", "--", relative]),
    execFileAsync("git", ["-C", root, "diff", "--no-ext-diff", "--no-color", "--unified=3", "--", relative]),
  ]);
  return { root, path: relative, staged: parseUnifiedDiff(staged, "staged"), unstaged: parseUnifiedDiff(unstaged, "unstaged") };
}

function publicHunks(result) {
  const expose = ({ patch, ...hunk }) => hunk;
  return { path: result.path, staged: result.staged.map(expose), unstaged: result.unstaged.map(expose) };
}

function applyGitPatch(root, args, patch) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", root, "apply", ...args, "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `git apply 退出，状态码 ${code}`)));
    child.stdin.end(patch);
  });
}

async function mutateGitHunk(payload = {}) {
  const area = payload.area === "staged" ? "staged" : "unstaged";
  const result = await gitHunks(payload.cwd, payload.path);
  const hunk = result[area].find((item) => item.id === String(payload.hunkId || ""));
  if (!hunk) throw new Error("代码块已经变化，请刷新 Diff 后重试");
  const action = String(payload.action || "");
  if (area === "unstaged" && action === "stage") await applyGitPatch(result.root, ["--cached", "--whitespace=nowarn"], hunk.patch);
  else if (area === "unstaged" && action === "restore") await applyGitPatch(result.root, ["--reverse", "--whitespace=nowarn"], hunk.patch);
  else if (area === "staged" && action === "unstage") await applyGitPatch(result.root, ["--cached", "--reverse", "--whitespace=nowarn"], hunk.patch);
  else throw new Error("这个代码块不支持所选 Git 操作");
  appendAudit("git.hunk.mutate", { root: result.root, path: result.path, area, action, hunkId: hunk.id });
  const [state, refreshed] = await Promise.all([getGitState(result.root), gitHunks(result.root, result.path)]);
  return { state, hunks: publicHunks(refreshed) };
}

async function mutateGit(payload = {}) {
  const root = await gitRoot(payload.cwd || DEFAULT_CWD);
  const action = String(payload.action || "");
  if (action === "stageAll") await execFileAsync("git", ["-C", root, "add", "-A"]);
  else if (action === "unstageAll") {
    const hasHead = await execFileAsync("git", ["-C", root, "rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
    if (hasHead) await execFileAsync("git", ["-C", root, "restore", "--staged", "."]);
    else await execFileAsync("git", ["-C", root, "rm", "-r", "--cached", "--ignore-unmatch", "."]);
  } else {
    const relative = safeRepoPath(root, payload.path);
    if (action === "stage") await execFileAsync("git", ["-C", root, "add", "--", relative]);
    else if (action === "unstage") {
      const hasHead = await execFileAsync("git", ["-C", root, "rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
      if (hasHead) await execFileAsync("git", ["-C", root, "restore", "--staged", "--", relative]);
      else await execFileAsync("git", ["-C", root, "rm", "--cached", "--ignore-unmatch", "--", relative]);
    } else if (action === "restore") {
      const state = await getGitState(root);
      const file = state.files.find((item) => item.path === relative);
      if (!file) throw new Error("文件已经没有可还原的工作区变更");
      if (file.untracked) throw new Error("OnPeople 不会自动删除未跟踪文件，请在终端中确认后处理");
      await execFileAsync("git", ["-C", root, "restore", "--worktree", "--", relative]);
    } else throw new Error("未知的 Git 操作");
  }
  appendAudit("git.mutate", { root, action, path: payload.path || null });
  return getGitState(root);
}

async function commitGit(cwd, message) {
  const root = await gitRoot(cwd || DEFAULT_CWD);
  const cleanMessage = normalizeCommitMessage(message);
  const { stdout, stderr } = await execFileAsync("git", ["-C", root, "commit", "-m", cleanMessage]);
  appendAudit("git.commit", { root, summary: cleanMessage.split("\n", 1)[0].slice(0, 120) });
  return { output: `${stdout}${stderr}`.trim(), state: await getGitState(root) };
}

async function pushGit(cwd, requestedRemote) {
  const state = await getGitState(cwd || DEFAULT_CWD);
  if (state.branch === "detached") throw new Error("当前处于 detached HEAD，请先创建分支");
  const args = ["-C", state.root, "push"];
  let remote = null;
  if (!state.upstream) {
    remote = String(requestedRemote || state.remotes[0] || "").trim();
    if (!state.remotes.includes(remote)) throw new Error("当前仓库没有可用的 Git 远程地址");
    args.push("--set-upstream", remote, state.branch);
  }
  const { stdout, stderr } = await execFileAsync("git", args);
  appendAudit("git.push", { root: state.root, branch: state.branch, remote: remote || state.upstream?.split("/", 1)[0] || null });
  return { output: `${stdout}${stderr}`.trim(), state: await getGitState(state.root) };
}

async function preparePullRequest(cwd, requestedBase) {
  const state = await getGitState(cwd || DEFAULT_CWD);
  if (!state.upstream) throw new Error("请先推送当前分支，再准备 Pull Request");
  if (state.branch === "detached") throw new Error("当前处于 detached HEAD，请先创建分支");
  const remote = state.remotes.includes("origin") ? "origin" : state.remotes[0];
  const url = githubCompareUrl(state.remoteUrls[remote], requestedBase || state.baseBranch, state.branch);
  appendAudit("git.pull-request.prepared", { root: state.root, remote, base: requestedBase || state.baseBranch, branch: state.branch });
  return { url, remote, base: requestedBase || state.baseBranch, branch: state.branch };
}

async function startReview({ threadId = null, cwd, targetType, value }) {
  const ensured = await ensureThread({ threadId, cwd });
  const id = ensured.threadId;
  let target;
  if (targetType === "baseBranch") target = { type: "baseBranch", branch: String(value || "main").trim() || "main" };
  else if (targetType === "commit") target = { type: "commit", sha: String(value || "HEAD").trim() || "HEAD" };
  else if (targetType === "custom") target = { type: "custom", instructions: String(value || "").trim() || "Review the current changes." };
  else target = { type: "uncommittedChanges" };
  const result = await appServer.request("review/start", { threadId: id, target, delivery: "inline" });
  const turnId = result.turn?.id || result.turnId || null;
  if (turnId) {
    setActiveTurn(id, turnId);
    threadContexts.startTurn(id, turnId);
  }
  return { threadId: id, turnId };
}

async function listExtensions(cwd, threadId = null) {
  const workdir = cwd || DEFAULT_CWD;
  const skillsHome = path.join(app.getPath("userData"), "codex-home", "skills");
  const [skillsResult, pluginsResult, mcpResult] = await Promise.allSettled([
    refreshSkillCatalog(workdir, { forceReload: true }),
    appServer.request("plugin/list", { cwds: [workdir] }),
    threadId
      ? appServer.request("mcpServerStatus/list", { threadId, detail: "full", limit: 100 })
      : Promise.resolve({ data: [] }),
  ]);
  const skills = skillsResult.status === "fulfilled"
    ? skillsResult.value.map((skill) => {
      const rawPath = String(skill.path || "");
      const skillFile = path.basename(rawPath) === "SKILL.md" ? rawPath : path.join(rawPath, "SKILL.md");
      const relative = path.relative(skillsHome, skillFile);
      const isOnPeopleSkill = Boolean(relative)
        && relative !== ".."
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative);
      return {
        ...skill,
        cwd: entry.cwd,
        origin: isOnPeopleSkill ? "onpeople" : (skill.scope || "project"),
        originLabel: isOnPeopleSkill ? "OnPeople 独立 Skills" : (skill.scope || "项目"),
        hasUiMetadata: fs.existsSync(path.join(path.dirname(skillFile), "agents", "openai.yaml")),
      };
    })
    : [];
  const marketplaces = pluginsResult.status === "fulfilled" ? pluginsResult.value.marketplaces || [] : [];
  const plugins = marketplaces.flatMap((marketplace) => (marketplace.plugins || []).map((plugin) => ({ ...plugin, marketplace: marketplace.name, marketplacePath: marketplace.path || null })));
  return {
    skills,
    skillsHome,
    skillsUpdatedAt: skillCatalogRefreshedAt,
    skillsRevision: skillCatalogRevision,
    plugins,
    mcpServers: mcpResult.status === "fulfilled" ? mcpResult.value.data || [] : [],
    errors: [skillsResult, pluginsResult, mcpResult].filter((item) => item.status === "rejected").map((item) => item.reason?.message || String(item.reason)),
  };
}

async function discoverModels() {
  const settings = readProviderSettings();
  const preset = PROVIDERS[settings.type];
  let models = [];
  let source = "provider";
  try {
    if (settings.type === "ollama") {
      const response = await fetch("http://127.0.0.1:11434/api/tags");
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
      const body = await response.json();
      models = (body.models || []).map((item) => ({ id: item.name, name: item.name }));
    } else {
      const baseUrl = settings.type === "lmstudio" ? "http://127.0.0.1:1234/v1" : settings.baseUrl;
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
        headers: settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {},
      });
      if (!response.ok) throw new Error(`${preset.name} returned ${response.status}`);
      const body = await response.json();
      models = (body.data || body.models || []).map((item) => ({ id: item.id || item.name || item.model, name: item.name || item.id || item.model })).filter((item) => item.id);
    }
  } catch (providerError) {
    source = "embedded-catalog";
    try {
      const result = await appServer.request("model/list", { limit: 100, includeHidden: false });
      models = (result.data || []).map((item) => ({ id: item.model, name: item.displayName, inputModalities: item.inputModalities || [], reasoning: item.supportedReasoningEfforts || [] }));
    } catch {
      throw providerError;
    }
  }
  const enriched = models.map((model) => ({ ...model, vision: detectModelVision(settings.type, model.id, model.inputModalities) }));
  return { models: enriched, source, provider: publicProviderSettings(settings) };
}

function detectModelVision(providerType, modelId, advertised = []) {
  if (advertised.includes("image")) return { supported: true, confidence: "advertised" };
  if (providerType === "deepseek") return { supported: false, confidence: "provider" };
  const id = String(modelId || "").toLowerCase();
  if (providerType === "kimi") return { supported: /vision|k2[.-]?(5|6)|k3/.test(id), confidence: "model-profile" };
  if (providerType === "minimax") return { supported: /vision|vl|multimodal/.test(id), confidence: "model-name" };
  if (providerType === "openai") return { supported: !/(whisper|tts|embedding|audio)/.test(id), confidence: "provider" };
  if (providerType === "grok") return { supported: !/(code|embedding)/.test(id), confidence: "provider" };
  return { supported: PROVIDERS[providerType]?.vision || false, confidence: "provider" };
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

async function initializeAppServer({ restoreThreadId = null } = {}) {
  const client = new AppServerClient(findCodexBinary());
  appServer = client;
  runtimeStatus = "starting";
  runtimeLastError = null;
  recordRuntimeEvent("info", "Agent 运行时正在启动", client.binary);
  client.on("event", (event) => {
    if (event.type === "approval-required") appendAudit("approval.request", { requestId: event.request?.id, method: event.request?.method });
    if (event.type === "server-log") recordRuntimeEvent("log", "App Server", event.text);
    if (event.type === "server-exit" && appServer === client) {
      if (scheduledRunsByThread.size) failActiveScheduledRuns("Agent 运行时在计划任务完成前退出");
      appServer = null;
      for (const [threadId, turnId] of activeTurnIdsByThread) {
        threadContexts.completeTurn(threadId, turnId, "interrupted");
      }
      clearAllActiveTurns();
      runtimeStatus = "failed";
      runtimeLastError = `exit=${event.code ?? "?"} signal=${event.signal || "—"}`;
      recordRuntimeEvent("error", "Agent 运行时异常退出", runtimeLastError);
      scheduleRuntimeRestart(runtimeLastError);
    }
    const eventThreadId = event.request?.params?.threadId || event.request?.params?.thread?.id || null;
    if (event.type === "approval-required" && eventThreadId) {
      sendToRenderer("agent:event", { type: "thread-status-changed", threadId: eventThreadId, status: "waiting-approval" });
      sendToTaskThread(eventThreadId, "agent:event", event);
      notifyTaskState(eventThreadId, "OnPeople 等待审批", "任务需要你的确认才能继续。");
    }
    else sendToRenderer("agent:event", event);
  });
  client.on("notification", (message) => {
    if (message.method === "skills/changed") {
      invalidateSkillCatalog();
    }
    if (message.method === "command/exec/outputDelta") {
      const params = message.params || {};
      sendToRenderer("agent:event", {
        type: "terminal-output",
        processId: params.processId,
        stream: params.stream,
        data: Buffer.from(params.deltaBase64 || "", "base64").toString("utf8"),
      });
    }
    const messageThreadId = message.params?.threadId || message.params?.thread?.id || null;
    const messageTurnId = message.params?.turn?.id || message.params?.turnId || null;
    if (messageThreadId && handleScheduledNotification(message, messageThreadId)) return;
    const turnEvent = agentRuntime?.observe(message);
    if (turnEvent) sendToTaskThread(messageThreadId, "runtime:event", turnEvent);
    const managedAgent = [...managedAgents.values()].find((agent) => agent.threadId && agent.threadId === messageThreadId);
    if (message.method === "turn/started") {
      if (messageThreadId) runtimeLoadedThreadIds.add(messageThreadId);
      if (messageThreadId && messageTurnId) setActiveTurn(messageThreadId, messageTurnId);
      if (messageThreadId) threadContexts.startTurn(messageThreadId, messageTurnId);
      if (messageThreadId) setThreadLifecycle(messageThreadId, "running");
      if (messageThreadId) sendToRenderer("agent:event", { type: "thread-status-changed", threadId: messageThreadId, status: "working" });
      if (managedAgent) {
        managedAgent.turnId = messageTurnId || managedAgent.turnId;
        managedAgent.status = "running";
        publishAgents();
      }
    }
    if (message.method === "thread/status/changed" && managedAgent) {
      const status = message.params?.status || {};
      managedAgent.status = status.type === "active" ? (status.activeFlags?.[0] || "running") : status.type;
      managedAgent.activeFlags = status.activeFlags || [];
      publishAgents();
    }
    if (message.method === "thread/status/changed" && messageThreadId) {
      signalRuntimeThreadReady(messageThreadId, "thread/status/changed");
      const status = message.params?.status || {};
      const raw = [status.type, ...(status.activeFlags || [])].filter(Boolean).join(" ").toLocaleLowerCase();
      const publicStatus = raw.includes("waitingonapproval") ? "waiting-approval"
        : raw.includes("waitingonuserinput") ? "waiting-input"
          : raw.includes("failed") ? "failed"
            : raw.includes("paused") || raw.includes("blocked") ? "paused"
              : status.type === "active" ? "working" : "completed";
      sendToRenderer("agent:event", { type: "thread-status-changed", threadId: messageThreadId, status: publicStatus });
      if (publicStatus === "waiting-input") notifyTaskState(messageThreadId, "OnPeople 等待输入", "任务需要你补充信息后才能继续。");
      if (publicStatus === "waiting-approval") notifyTaskState(messageThreadId, "OnPeople 等待审批", "任务需要你的确认才能继续。");
    }
    if (message.method === "thread/tokenUsage/updated" && messageThreadId) {
      signalRuntimeThreadReady(messageThreadId, "thread/tokenUsage/updated");
      tokenUsageByThread.set(messageThreadId, message.params?.tokenUsage || null);
      const provider = providerContextForThread(messageThreadId).settings;
      usageLedger?.record({ threadId: messageThreadId, provider: provider.type, model: provider.model, usage: message.params?.tokenUsage || {} });
      sendToRenderer("agent:event", { type: "context-updated", state: contextState(messageThreadId) });
    }
    if (message.method === "item/completed" && messageThreadId && message.params?.item?.type === "agentMessage" && message.params.item.text) {
      lastAgentMessageByThread.set(messageThreadId, String(message.params.item.text));
    }
    if (message.method === "hook/started" || message.method === "hook/completed") {
      const run = message.params?.run;
      if (run?.id) hookRuns.set(run.id, { ...run, threadId: messageThreadId, turnId: messageTurnId });
      sendToRenderer("agent:event", { type: "hooks-updated", runs: [...hookRuns.values()] });
    }
    if (message.method === "thread/compacted") {
      appendAudit("context.compacted", { threadId: messageThreadId });
      sendToRenderer("agent:event", { type: "context-compacted", threadId: messageThreadId });
    }
    if (message.method === "turn/completed") {
      if (messageThreadId) clearActiveTurn(messageThreadId);
      if (messageThreadId) {
        threadContexts.completeTurn(
          messageThreadId,
          messageTurnId,
          message.params?.turn?.status === "failed" ? "failed" : "idle",
        );
      }
      if (messageThreadId) setThreadLifecycle(messageThreadId, message.params?.turn?.status === "failed" ? "failed" : "idle", { error: message.params?.turn?.error?.message });
      if (messageThreadId) sendToRenderer("agent:event", { type: "thread-status-changed", threadId: messageThreadId, status: message.params?.turn?.status === "failed" ? "failed" : "completed" });
      const finalText = messageThreadId ? lastAgentMessageByThread.get(messageThreadId) : "";
      if (messageThreadId) {
        const failed = message.params?.turn?.status === "failed";
        notifyTaskState(
          messageThreadId,
          failed ? "OnPeople 任务失败" : "OnPeople 任务完成",
          failed ? (message.params?.turn?.error?.message || "任务执行失败。") : (finalText || "任务已经完成。"),
        );
      }
      if (managedAgent) {
        managedAgent.status = message.params?.turn?.status === "failed" ? "failed" : "completed";
        managedAgent.error = message.params?.turn?.error?.message || null;
        managedAgent.completedAt = Date.now();
        managedAgent.summary = finalText ? finalText.slice(0, 4_000) : null;
        publishAgents();
        if (managedAgent.parentThreadId) {
          sendToTaskThread(managedAgent.parentThreadId, "agent:event", {
            type: "agent-handoff",
            parentThreadId: managedAgent.parentThreadId,
            agent: publicAgent(managedAgent),
          });
        }
      }
      const memorySettings = localMemoryStore?.state();
      if (memorySettings?.generate && finalText && message.params?.turn?.status !== "failed") {
        try {
          localMemoryStore.save({ scope: "project", projectPath: knownThreadCwd(messageThreadId), content: finalText.slice(0, 1_200), enabled: false, source: `candidate:${messageThreadId}` });
        } catch {}
      }
      if (messageThreadId) lastAgentMessageByThread.delete(messageThreadId);
      const pendingProvider = messageThreadId ? threadContexts.get(messageThreadId)?.pendingProvider : null;
      if (messageThreadId && pendingProvider) {
        void applyThreadProvider(messageThreadId, pendingProvider).catch((error) => {
          recordRuntimeEvent("warning", "任务模型切换延后失败", error.message);
        });
      }
      if (messageThreadId) void startNextQueuedMessage(messageThreadId);
    }
    if (message.method === "thread/goal/updated" && messageThreadId) {
      const goal = message.params?.goal || null;
      goalsByThread.set(messageThreadId, goal);
      threadContexts.update(messageThreadId, { goal });
    }
    if (message.method === "thread/goal/cleared" && messageThreadId) {
      goalsByThread.delete(messageThreadId);
      threadContexts.update(messageThreadId, { goal: null });
    }
  });
  try {
    await client.start();
  } catch (error) {
    client.stop();
    if (appServer === client) appServer = null;
    runtimeStatus = "failed";
    runtimeLastError = error.message;
    recordRuntimeEvent("error", "Agent 运行时启动失败", error.message);
    throw error;
  }
  try {
    const modes = await client.request("collaborationMode/list", {});
    collaborationModes = Array.isArray(modes?.data) ? modes.data : [];
  } catch (error) {
    collaborationModes = [];
    sendToRenderer("agent:event", { type: "server-log", text: `Collaboration presets unavailable: ${error.message}` });
  }
  runtimeStatus = "healthy";
  runtimeLastError = null;
  runtimeStartedAt = new Date().toISOString();
  runtimeRestartAttempt = 0;
  cancelRuntimeRestart();
  recordRuntimeEvent("success", "Agent 运行时已就绪", client.binary);
  if (restoreThreadId) {
    try { await restoreActiveThread(client, restoreThreadId); }
    catch (error) { recordRuntimeEvent("warning", "运行时已恢复，但当前会话恢复失败", error.message); }
  }
  sendToRenderer("agent:event", { type: "ready", recovered: Boolean(restoreThreadId) });
}

function createWorkbenchWindow(threadId = null) {
  const window = new BrowserWindow({
    width: 1480,
    height: 930,
    minWidth: 1080,
    minHeight: 720,
    title: "OnPeople",
    icon: APP_ICON_PNG,
    backgroundColor: "#ffffff",
    ...workbenchWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  const webContentsId = window.webContents.id;
  taskWindows.add(window);
  bindWindowThread(webContentsId, threadId || null);
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = String(input.key || "").toLowerCase();
    if ((input.meta || input.control) && !input.alt && key === "k") {
      event.preventDefault();
      window.webContents.send("app:command-palette");
      return;
    }
    const terminalProcessId = terminalFocusedWebContents.get(webContentsId);
    if (!terminalProcessId) return;
    const action = input.meta && key === "a"
      ? { type: "select-all" }
      : input.meta && key === "c"
        ? { type: "copy" }
        : input.meta && key === "v"
          ? { type: "paste", text: clipboard.readText() }
          : input.control && input.shift && key === "c"
            ? { type: "copy" }
            : input.control && input.shift && key === "v"
              ? { type: "paste", text: clipboard.readText() }
              : null;
    if (action) {
      event.preventDefault();
      window.webContents.send("terminal:menu-action", action);
    }
  });
  window.on("closed", () => {
    terminateOwnedTerminals(webContentsId);
    taskWindows.delete(window);
    threadContexts.unbindWindow(webContentsId);
    windowThreadIds.delete(webContentsId);
    terminalFocusedWebContents.delete(webContentsId);
  });
  return window;
}

async function openTaskWindow(threadId = null, controlView = null) {
  const window = createWorkbenchWindow(threadId);
  await window.loadFile(path.join(__dirname, "index.html"));
  if (controlView) window.webContents.send("app:deep-link", { type: "control", view: controlView });
  window.show();
  window.focus();
  return { opened: true, threadId: threadId || null };
}

function handleOnPeopleUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    if (target.protocol !== "onpeople:") return;
    if (target.hostname === "task") return void openTaskWindow(target.pathname.split("/").filter(Boolean)[0] || null);
    if (target.hostname === "settings") return void openTaskWindow(null, target.pathname.split("/").filter(Boolean)[0] || "config");
    if (target.hostname === "new") return void openTaskWindow(null);
  } catch (error) { recordRuntimeEvent("warning", "无法打开 OnPeople 链接", error.message); }
}

function installApplicationMenu() {
  const sendPalette = (_item, window) => window?.webContents?.send("app:command-palette");
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu", submenu: [
      { role: "about" }, { type: "separator" },
      { label: "命令面板…", accelerator: "CmdOrCtrl+K", click: sendPalette },
      { label: "显示 / 收起宠物", click: () => togglePet() },
      { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" },
    ] },
    { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
}

async function createWindow() {
  computerUseStatus = await prepareComputerUse(cuaDriverBinary, cuaDriverApp);
  if (process.platform === "darwin" && app.dock && fs.existsSync(APP_ICON_PNG)) app.dock.setIcon(APP_ICON_PNG);
  petStateStore = new PetStateStore(path.join(app.getPath("userData"), "pet-settings.json"));
  scheduledTaskStore = new ScheduledTaskStore(path.join(app.getPath("userData"), "scheduled-tasks.json"));
  agentProfileStore = new AgentProfileStore(path.join(app.getPath("userData"), "agent-profiles.json"));
  localMemoryStore = new LocalMemoryStore(path.join(app.getPath("userData"), "local-memories.json"));
  usageLedger = new UsageLedger(path.join(app.getPath("userData"), "usage-ledger.json"));
  secretStore = new SecretStore(path.join(app.getPath("userData"), "secure-variables.json"), safeStorage);
  cloudAccount = new CloudAccountClient({
    filePath: path.join(app.getPath("userData"), "cloud-account.json"),
    safeStorage,
    defaultServiceUrl: DEFAULT_CLOUD_SERVICE_URL,
  });
  agentRuntime = new AgentRuntimeCoordinator({ stateFile: path.join(app.getPath("userData"), "runtime-sessions.json") });
  mainWindow = createWorkbenchWindow(null);

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
  browserSessionManager = new BrowserSessionManager(() => browserBridge?.target().session);
  browserCredentialVault = new BrowserCredentialVault({
    filePath: path.join(app.getPath("userData"), "browser-credentials.vault.json"),
    safeStorage,
  });
  const openSourceProfileImporter = new ChromiumProfileImporter({
    getTargetSession: () => browserBridge?.target().session,
    credentialVault: browserCredentialVault,
  });
  browserProfileImporter = new BrowserProfileImporter({
    fallbackBinding: openSourceProfileImporter,
    targetPartition: EMBEDDED_BROWSER_PARTITION,
  });
  modelGateway = new ModelGateway();
  await modelGateway.start();

  await mainWindow.loadFile(path.join(__dirname, "index.html"));
  if (petStateStore.snapshot().visible) showPet();

  try {
    await initializeAppServer();
    publishScheduler();
    clearInterval(schedulerTimer);
    schedulerTimer = setInterval(() => void schedulerTick(), 30_000);
    setTimeout(() => void schedulerTick(), 2_000);
    void maybeRunSmokePrompt();
  } catch (error) {
    sendToRenderer("agent:event", { type: "fatal", message: error.message });
    scheduleRuntimeRestart(error.message);
  }
}

ipcMain.handle("pet:state", async () => decoratedPetState());
ipcMain.handle("pet:toggle", async () => togglePet());
ipcMain.handle("pet:tray", async (_event, open) => {
  const window = createPetWindow();
  const trayOpen = Boolean(open);
  const oldBounds = window.getBounds();
  const width = trayOpen ? 340 : 220;
  const height = trayOpen ? 420 : 260;
  window.setBounds({
    x: oldBounds.x + oldBounds.width - width,
    y: oldBounds.y + oldBounds.height - height,
    width,
    height,
  }, true);
  petStateStore.saveSettings({ trayOpen });
  return publishPetState();
});
ipcMain.handle("pet:tuck", async () => hidePet());
ipcMain.handle("pet:update-task", async (_event, payload) => {
  const state = petStateStore.updateTask(payload);
  publishPetState();
  return state;
});
ipcMain.handle("pet:skin:select", async (_event, skinId) => {
  const id = String(skinId || "").trim();
  const skin = petSkinCatalog().find((item) => item.id === id);
  if (!skin) throw new Error("找不到这个宠物皮肤");
  petStateStore.saveSettings({ skinId: skin.id });
  return publishPetState();
});
ipcMain.handle("pet:skin:import", async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(owner, {
    title: "导入宠物皮肤",
    properties: ["openFile"],
    filters: [{ name: "宠物图片", extensions: ["png", "webp"] }],
  });
  if (result.canceled || !result.filePaths[0]) return decoratedPetState();
  const source = path.resolve(result.filePaths[0]);
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error("皮肤必须是 20 MiB 以内的 PNG 或 WebP");
  const image = nativeImage.createFromPath(source);
  const size = image.getSize();
  if (image.isEmpty() || size.width < 64 || size.height < 64 || size.width > 4096 || size.height > 4096) {
    throw new Error("无法读取皮肤，建议使用 64–4096 像素的透明 PNG/WebP");
  }
  const extension = path.extname(source).toLowerCase() === ".webp" ? ".webp" : ".png";
  const id = `custom-${crypto.randomUUID()}`;
  const skinDirectory = path.join(app.getPath("userData"), "pet-skins");
  const destination = path.join(skinDirectory, `${id}${extension}`);
  fs.mkdirSync(skinDirectory, { recursive: true });
  fs.copyFileSync(source, destination);
  const customSkins = [...petStateStore.snapshot().customSkins, {
    id,
    name: path.basename(source, path.extname(source)).slice(0, 60) || "自定义皮肤",
    path: destination,
  }].slice(-24);
  petStateStore.saveSettings({ customSkins, skinId: id });
  return publishPetState();
});
ipcMain.handle("pet:skin:delete", async (_event, skinId) => {
  const id = String(skinId || "").trim();
  const current = petStateStore.snapshot();
  const skin = current.customSkins.find((item) => item.id === id);
  if (!skin) throw new Error("内置皮肤不能删除");
  const skinDirectory = path.resolve(app.getPath("userData"), "pet-skins");
  const target = path.resolve(skin.path);
  if (target.startsWith(`${skinDirectory}${path.sep}`)) {
    try { fs.unlinkSync(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const customSkins = current.customSkins.filter((item) => item.id !== id);
  petStateStore.saveSettings({ customSkins, skinId: current.skinId === id ? "onpeople" : current.skinId });
  return publishPetState();
});
ipcMain.handle("pet:open-thread", async (_event, threadId = null) => {
  const id = String(threadId || "").trim();
  if (id) {
    for (const window of taskWindows) {
      if (!window.isDestroyed() && windowThreadIds.get(window.webContents.id) === id) {
        window.show();
        window.focus();
        return { opened: true, existing: true, threadId: id };
      }
    }
    return openTaskWindow(id);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  return { opened: true, threadId: null };
});

ipcMain.handle("browser:attach", async (_event, webContentsId) => {
  const target = webContents.fromId(webContentsId);
  browserBridge.attach(target);
  target.setWindowOpenHandler(({ url }) => {
    void loadWebContentsUrl(target, url);
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
ipcMain.handle("workspace:quick-suggestions", async (_event, cwd) => collectWorkspaceSuggestions(cwd, browserBridge.target().getURL()));
ipcMain.handle("workspace:files:list", async (_event, cwd, relative) => listProjectDirectory(cwd, relative));
ipcMain.handle("workspace:files:search", async (_event, cwd, query) => searchProjectFiles(cwd, query));
ipcMain.handle("workspace:project-actions", async (_event, cwd) => discoverProjectActions(cwd));
ipcMain.handle("workspace:project-action:authorize", async (_event, payload) => {
  const result = discoverProjectActions(payload?.cwd);
  const candidates = [...(result.setup ? [result.setup] : []), ...result.actions];
  const action = candidates.find((item) => item.id === payload?.id && item.fingerprint === payload?.fingerprint);
  if (!action) throw new Error("项目动作已经变化，请刷新后重新确认");
  appendAudit("project.action.authorized", { cwd: result.root, id: action.id, source: action.source, fingerprint: action.fingerprint });
  return action;
});
ipcMain.handle("browser:open-workspace-file", async (_event, payload) => {
  const result = await browserBridge.openWorkspaceFile(payload?.cwd, payload?.path);
  appendAudit("browser.workspace-file.opened", { path: result.path });
  return result;
});
ipcMain.handle("browser:back", async () => browserBridge.target().canGoBack() && browserBridge.target().goBack());
ipcMain.handle("browser:forward", async () => browserBridge.target().canGoForward() && browserBridge.target().goForward());
ipcMain.handle("browser:reload", async () => browserBridge.target().reload());
ipcMain.handle("browser:visual-snapshot", async () => browserBridge.visualSnapshot());
ipcMain.handle("browser:developer-inspect", async () => {
  const result = await browserBridge.developerInspect();
  appendAudit("browser.developer.inspect", { url: result.dom?.url, consoleEntries: result.console.length, networkEntries: result.network.length });
  return result;
});
ipcMain.handle("browser:annotation:begin", async () => browserBridge.beginAnnotationSelection());
ipcMain.handle("browser:annotation:cancel", async () => browserBridge.finishAnnotationSelection());
ipcMain.handle("browser:annotation:list", async (_event, options) => browserBridge.listAnnotations(options));
ipcMain.handle("browser:annotation:save", async (_event, draft) => {
  const result = await browserBridge.saveAnnotation(draft);
  appendAudit("browser.annotation.save", { id: result.id, url: result.url, selector: result.selector });
  return result;
});
ipcMain.handle("browser:annotation:delete", async (_event, annotationId) => browserBridge.deleteAnnotation(String(annotationId || "")));
ipcMain.handle("browser:session:status", async () => browserSessionManager.summary());
ipcMain.handle("browser:session:sign-in", async (_event, providerId) => {
  const target = browserSessionManager.signInTarget(providerId);
  appendAudit("browser.session.sign-in-opened", { provider: target.provider });
  await browserBridge.userNavigate(target.url);
  return target;
});
ipcMain.handle("browser:session:clear", async (_event, providerId) => {
  const result = await browserSessionManager.clearProvider(providerId);
  appendAudit("browser.session.cleared", { provider: providerId });
  await browserBridge.userNavigate("https://www.google.com/");
  return result;
});
ipcMain.handle("browser:session:clear-all", async () => {
  const result = await browserSessionManager.clearAll();
  appendAudit("browser.session.cleared", { provider: "all" });
  await loadWebContentsUrl(browserBridge.target(), "about:blank");
  return result;
});
ipcMain.handle("browser:credentials:fill", async () => {
  const target = browserBridge.target();
  const credential = browserCredentialVault.findForUrl(target.getURL());
  if (!credential) return { found: false, filled: false };
  const result = await browserBridge.fillSavedCredential(credential);
  let host = "";
  try { host = new URL(target.getURL()).hostname; } catch {}
  appendAudit("browser.credential.fill", { host, filled: result.filled === true });
  return { found: true, filled: result.filled === true, reason: result.reason || null };
});
ipcMain.handle("browser:profile-import:list", async () => browserProfileImporter.listProfiles());
ipcMain.handle("browser:profile-import:run", async (_event, payload = {}) => {
  const result = await browserProfileImporter.importProfile({
    profileId: typeof payload.profileId === "string" ? payload.profileId : "",
    importCookies: payload.importCookies === true,
    importPasswords: payload.importPasswords === true,
    allowElevatedChromeDecryption: false,
  });
  appendAudit("browser.profile-import.completed", {
    source: result.source,
    cookiesImported: result.cookies?.imported || 0,
    passwordsImported: result.passwords?.imported || result.passwords?.profile?.imported || 0,
  });
  return result;
});
ipcMain.handle("agent:status", async (event) => {
  const hasWindowThread = windowThreadIds.has(event.sender.id);
  const threadId = hasWindowThread ? windowThreadIds.get(event.sender.id) : null;
  const context = contextForThread(threadId);
  const providerSettings = providerContextForThread(threadId).settings;
  return {
    ready: Boolean(appServer?.ready),
    threadId: threadId || null,
    windowThreadId: hasWindowThread ? (threadId || null) : undefined,
    goal: threadId ? (goalsByThread.get(threadId) || context?.goal || null) : null,
    collaborationModes,
    defaultCwd: DEFAULT_CWD,
    computerUse: computerUseStatus,
    capabilities: {
      artifacts: { available: fs.existsSync(ARTIFACT_MCP_SCRIPT) },
      browser: { available: Boolean(browserBridge?.url) },
      computer: { available: Boolean(cuaDriverBinary && computerUseStatus.running), reason: computerUseStatus.message || null },
      imagegen: imageGenerationCapability(
        providerSettings.type,
        Boolean(providerSettings.apiKey),
      ),
      extensions: { available: Boolean(appServer?.ready) },
    },
    provider: publicProviderSettings(providerSettings),
    policy: readP0Settings().policy,
    context: contextState(threadId),
  };
});
ipcMain.handle("runtime:diagnostics", async () => {
  let version = null;
  try { version = (await execFileAsync(findCodexBinary(), ["--version"], { timeout: 5_000 })).stdout.trim(); }
  catch (error) { recordRuntimeEvent("warning", "无法读取运行时版本", error.message); }
  return { ...runtimeSnapshot(), version, appVersion: APP_VERSION, provider: publicProviderSettings(), sessions: agentRuntime?.snapshot() || null };
});
ipcMain.handle("runtime:snapshot", async (_event, threadId) => agentRuntime?.snapshot(threadId || null) || null);
ipcMain.handle("runtime:restart", async () => restartAppServer("manual"));
ipcMain.handle("workspace:open-editor", async (_event, payload) => openEditorLocation(payload));
ipcMain.handle("generated-image:read", async (event, imagePath, threadId = null) => {
  const ownerThreadId = String(threadId || windowThreadIds.get(event.sender.id) || "");
  return generatedImagePath(ownerThreadId, imagePath);
});
ipcMain.handle("generated-image:reveal", async (event, imagePath, threadId = null) => {
  const ownerThreadId = String(threadId || windowThreadIds.get(event.sender.id) || "");
  const image = generatedImagePath(ownerThreadId, imagePath);
  shell.showItemInFolder(image.path);
  return { revealed: true, path: image.path };
});
ipcMain.handle("generated-image:copy", async (event, imagePath, threadId = null) => {
  const ownerThreadId = String(threadId || windowThreadIds.get(event.sender.id) || "");
  const image = generatedImagePath(ownerThreadId, imagePath);
  const value = nativeImage.createFromPath(image.path);
  if (value.isEmpty()) throw new Error("无法读取生成图片");
  clipboard.writeImage(value);
  return { copied: true, path: image.path };
});
ipcMain.handle("git:review-comments", async (event, payload) => submitInlineReview({
  ...payload,
  threadId: payload?.threadId || windowThreadIds.get(event.sender.id) || null,
}));

ipcMain.handle("agent:send", async (event, payload) => {
  const threadId = String(payload?.threadId || "").trim();
  if (threadId && !runtimeLoadedThreadIds.has(threadId)) {
    const restorePromise = runtimeThreadLoadPromises.get(threadId)
      || ensureRuntimeThread(threadId, {
        cwd: payload?.cwd,
        model: payload?.model || contextForThread(threadId)?.model || null,
      });
    const clientMessageId = deferPromptUntilThreadReady(event.sender.id, payload, restorePromise);
    return {
      threadId,
      turnId: null,
      queued: true,
      delivery: "restoring",
      clientMessageId,
    };
  }
  const result = await dispatchAgentPrompt(payload);
  bindWindowThread(event.sender.id, result.threadId);
  return { ...result, clientMessageId: payload?.clientMessageId || null, delivery: "sent" };
});
ipcMain.handle("threads:list", async (_event, filters) => listThreads(filters));
ipcMain.handle("threads:resume", async (event, threadId) => {
  const id = String(threadId || "").trim();
  const previousThreadId = windowThreadIds.get(event.sender.id) || null;
  bindWindowThread(event.sender.id, id);
  try {
    return await resumeThread(id);
  } catch (error) {
    if (windowThreadIds.get(event.sender.id) === id) bindWindowThread(event.sender.id, previousThreadId);
    throw error;
  }
});
ipcMain.handle("threads:fork", async (event, threadId) => {
  const result = await forkThread(threadId);
  bindWindowThread(event.sender.id, result.thread.id);
  return result;
});
ipcMain.handle("threads:archive", async (event, threadId) => {
  const result = await archiveThread(threadId);
  if (windowThreadIds.get(event.sender.id) === threadId) bindWindowThread(event.sender.id, null);
  return result;
});
ipcMain.handle("threads:unarchive", async (_event, threadId) => unarchiveThread(threadId));
ipcMain.handle("threads:pin", async (_event, threadId, pinned) => setThreadPinned(threadId, Boolean(pinned)));
ipcMain.handle("threads:unread", async (_event, threadId, unread) => setThreadUnread(threadId, Boolean(unread)));
ipcMain.handle("threads:rename", async (_event, threadId, name) => renameThread(threadId, name));
ipcMain.handle("threads:reveal", async (_event, threadId) => revealThread(threadId));
ipcMain.handle("clipboard:write-text", async (_event, value) => {
  clipboard.writeText(String(value || ""));
  return { copied: true };
});
ipcMain.handle("clipboard:read-text", async () => clipboard.readText());
ipcMain.on("terminal:focus-changed", (event, focused, processId) => {
  if (focused && terminalProcesses.get(processId)?.ownerWebContentsId === event.sender.id) {
    terminalFocusedWebContents.set(event.sender.id, processId);
  } else {
    terminalFocusedWebContents.delete(event.sender.id);
  }
});
ipcMain.handle("terminal:context-menu", async (event, payload = {}) => {
  const selection = String(payload.selection || "");
  const window = BrowserWindow.fromWebContents(event.sender);
  const sendAction = (action) => {
    if (!event.sender.isDestroyed()) event.sender.send("terminal:menu-action", action);
  };
  const menu = Menu.buildFromTemplate([
    {
      label: "复制",
      accelerator: "CmdOrCtrl+C",
      enabled: Boolean(selection),
      click: () => {
        clipboard.writeText(selection);
        sendAction({ type: "copied", length: selection.length });
      },
    },
    {
      label: "粘贴",
      accelerator: "CmdOrCtrl+V",
      enabled: Boolean(clipboard.readText()),
      click: () => sendAction({ type: "paste", text: clipboard.readText() }),
    },
    { type: "separator" },
    { label: "全选", accelerator: "CmdOrCtrl+A", click: () => sendAction({ type: "select-all" }) },
    { label: "清除终端", accelerator: "Ctrl+L", click: () => sendAction({ type: "clear" }) },
  ]);
  menu.popup({ window: window || undefined });
  return { opened: true };
});
ipcMain.handle("window:task:open", async (_event, threadId) => openTaskWindow(typeof threadId === "string" && threadId ? threadId : null));
ipcMain.handle("projects:pick", async (_event, defaultPath) => pickProject(defaultPath));
ipcMain.handle("projects:update", async (_event, projectPath, action, value) => updateProjectState(projectPath, action, value));
ipcMain.handle("projects:reveal", async (_event, projectPath) => {
  const rawPath = String(projectPath || "").trim();
  if (!rawPath || !path.isAbsolute(rawPath)) throw new Error("项目路径无效");
  const selected = path.resolve(rawPath);
  if (!fs.existsSync(selected)) throw new Error("项目文件夹不存在或已移动");
  shell.showItemInFolder(selected);
  return { revealed: true, path: selected };
});
ipcMain.handle("projects:archive-tasks", async (_event, projectPath) => archiveProjectThreads(projectPath));
ipcMain.handle("terminal:start", async (_event, payload = {}) => {
  const processId = crypto.randomUUID();
  const ownerWebContentsId = _event.sender.id;
  const requestedCwd = path.resolve(String(payload.cwd || DEFAULT_CWD));
  const cwd = fs.existsSync(requestedCwd) && fs.statSync(requestedCwd).isDirectory() ? requestedCwd : DEFAULT_CWD;
  const shell = resolveTerminalShell();
  const terminalProcess = pty.spawn(shell.command, shell.args, {
    name: "xterm-256color",
    cols: Math.max(20, Number(payload.cols) || 100),
    rows: Math.max(5, Number(payload.rows) || 28),
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "OnPeople",
      TERM_PROGRAM_VERSION: APP_VERSION,
    },
  });
  const session = { process: terminalProcess, ownerWebContentsId, ready: false, pendingOutput: [] };
  terminalProcesses.set(processId, session);
  terminalProcess.onData((data) => {
    if (terminalProcesses.get(processId) !== session) return;
    if (!session.ready) {
      session.pendingOutput.push(data);
      return;
    }
    sendTerminalEvent(ownerWebContentsId, { type: "terminal-output", processId, stream: "stdout", data });
  });
  terminalProcess.onExit(({ exitCode, signal }) => {
    if (terminalProcesses.get(processId) !== session) return;
    terminalProcesses.delete(processId);
    sendTerminalEvent(ownerWebContentsId, { type: "terminal-exit", processId, exitCode, signal });
  });
  return { processId, pid: terminalProcess.pid, shell: shell.command, shellKind: shell.kind, cwd };
});
ipcMain.handle("terminal:ready", async (_event, processId) => {
  const session = terminalProcesses.get(processId);
  if (!session || session.ownerWebContentsId !== _event.sender.id) return { ready: false };
  session.ready = true;
  const data = session.pendingOutput.join("");
  session.pendingOutput.length = 0;
  if (data) sendTerminalEvent(session.ownerWebContentsId, { type: "terminal-output", processId, stream: "stdout", data });
  return { ready: true };
});
ipcMain.handle("terminal:write", async (_event, processId, data) => {
  const session = terminalProcesses.get(processId);
  if (!session || session.ownerWebContentsId !== _event.sender.id) return { written: false };
  session.process.write(String(data));
  return { written: true };
});
ipcMain.handle("terminal:resize", async (_event, processId, cols, rows) => {
  const session = terminalProcesses.get(processId);
  if (!session || session.ownerWebContentsId !== _event.sender.id) return { resized: false };
  session.process.resize(Math.max(20, Number(cols) || 80), Math.max(5, Number(rows) || 24));
  return { resized: true };
});
ipcMain.handle("terminal:terminate", async (_event, processId) => {
  const session = terminalProcesses.get(processId);
  if (!session || session.ownerWebContentsId !== _event.sender.id) return { terminated: false };
  terminalProcesses.delete(processId);
  try { session.process.kill(); } catch {}
  return { terminated: true };
});
ipcMain.handle("git:state", async (_event, cwd) => getGitState(cwd));
ipcMain.handle("git:init", async (_event, cwd) => initGitRepository(cwd));
ipcMain.handle("git:diff", async (_event, cwd, filePath) => getGitDiff(cwd, filePath));
ipcMain.handle("git:hunks", async (_event, cwd, filePath) => publicHunks(await gitHunks(cwd, filePath)));
ipcMain.handle("git:hunk:mutate", async (_event, payload) => mutateGitHunk(payload));
ipcMain.handle("git:mutate", async (_event, payload) => mutateGit(payload));
ipcMain.handle("git:commit", async (_event, cwd, message) => commitGit(cwd, message));
ipcMain.handle("git:push", async (_event, cwd, remote) => pushGit(cwd, remote));
ipcMain.handle("git:prepare-pr", async (_event, cwd, base) => preparePullRequest(cwd, base));
ipcMain.handle("git:review", async (event, payload) => startReview({
  ...payload,
  threadId: payload?.threadId || windowThreadIds.get(event.sender.id) || null,
}));
ipcMain.handle("extensions:list", async (event, cwd) => listExtensions(cwd, windowThreadIds.get(event.sender.id) || null));
ipcMain.handle("skills:set-enabled", async (_event, skillPath, enabled) => {
  await appServer.request("skills/config/write", { path: skillPath, enabled: Boolean(enabled) });
  invalidateSkillCatalog();
  return { updated: true, revision: skillCatalogRevision };
});
ipcMain.handle("plugins:install", async (_event, plugin) => {
  const params = { pluginName: plugin.name };
  if (plugin.marketplacePath) params.marketplacePath = plugin.marketplacePath;
  else if (plugin.marketplace) params.remoteMarketplaceName = plugin.marketplace;
  const result = await appServer.request("plugin/install", params);
  return { installed: true, ...result };
});
ipcMain.handle("plugins:uninstall", async (_event, pluginId) => {
  await appServer.request("plugin/uninstall", { pluginId });
  return { uninstalled: true };
});
ipcMain.handle("mcp:reload", async () => {
  await appServer.request("config/mcpServer/reload", {});
  return { reloaded: true };
});
ipcMain.handle("models:discover", async () => discoverModels());
ipcMain.handle("models:validate", async (_event, providerType, modelId) => detectModelVision(providerType, modelId));
ipcMain.handle("cloud:account:status", async () => cloudAccount.status());
ipcMain.handle("cloud:account:login", async (_event, payload) => {
  const result = await cloudAccount.login(payload || {});
  refreshOnPeopleRoutes();
  sendToRenderer("cloud:account:updated", result);
  return result;
});
ipcMain.handle("cloud:account:register-code", async (_event, payload) => cloudAccount.sendRegistrationCode(payload || {}));
ipcMain.handle("cloud:account:register", async (_event, payload) => {
  const result = await cloudAccount.register(payload || {});
  refreshOnPeopleRoutes();
  sendToRenderer("cloud:account:updated", result);
  return result;
});
ipcMain.handle("cloud:account:logout", async () => {
  const result = await cloudAccount.logout();
  refreshOnPeopleRoutes();
  sendToRenderer("cloud:account:updated", result);
  return result;
});
ipcMain.handle("cloud:account:redeem", async (_event, code) => {
  const result = await cloudAccount.redeem(code);
  sendToRenderer("cloud:account:updated", result.state);
  return result;
});
ipcMain.handle("cloud:account:open-console", async () => {
  await shell.openExternal(cloudAccount.serviceUrl());
  return { opened: true };
});
ipcMain.handle("agents:list", async () => ({ agents: [...managedAgents.values()].map(publicAgent), maxAgents: readP0Settings().policy.maxAgents }));
ipcMain.handle("agent-profiles:list", async () => ({ profiles: agentProfileStore.list() }));
ipcMain.handle("agent-profiles:save", async (_event, profile) => ({ profile: agentProfileStore.save(profile), profiles: agentProfileStore.list() }));
ipcMain.handle("agent-profiles:delete", async (_event, profileId) => ({ ...agentProfileStore.remove(profileId), profiles: agentProfileStore.list() }));
ipcMain.handle("agents:spawn", async (_event, payload) => spawnManagedAgent(payload));
ipcMain.handle("agents:message", async (_event, agentId, text) => sendManagedAgentMessage(agentId, text));
ipcMain.handle("agents:stop", async (_event, agentId) => stopManagedAgent(agentId));
ipcMain.handle("agents:read", async (_event, agentId) => readManagedAgent(agentId));
ipcMain.handle("worktrees:list", async (_event, cwd) => listWorktrees(cwd));
ipcMain.handle("worktrees:create", async (_event, payload) => createWorktree(payload));
ipcMain.handle("worktrees:handoff", async (event, worktreePath) => handoffWorktree(worktreePath, windowThreadIds.get(event.sender.id) || null));
ipcMain.handle("worktrees:snapshot", async (_event, worktreePath) => snapshotWorktree(worktreePath));
ipcMain.handle("worktrees:remove", async (_event, worktreePath) => removeWorktree(worktreePath));
ipcMain.handle("context:state", async (event) => contextState(windowThreadIds.get(event.sender.id) || null));
ipcMain.handle("context:compact", async (event) => compactThread(windowThreadIds.get(event.sender.id) || null));
ipcMain.handle("context:steer", async (event, text) => steerTurn(windowThreadIds.get(event.sender.id) || null, text));
ipcMain.handle("context:queue", async (event, text) => queueThreadMessage(windowThreadIds.get(event.sender.id) || null, text));
ipcMain.handle("policy:get", async () => ({ policy: readP0Settings().policy, audit: readAudit(100) }));
ipcMain.handle("policy:save", async (_event, threadId, policy) => ({ policy: await applyPolicy(policy, threadId), audit: readAudit(100) }));
ipcMain.handle("config:effective", async (_event, payload = {}) => inspectEffectiveConfig({
  cwd: payload.cwd || DEFAULT_CWD,
  provider: publicProviderSettings(),
  policy: readP0Settings().policy,
  thread: payload.threadId ? { id: payload.threadId, turnId: activeTurnIdsByThread.get(payload.threadId) || null } : null,
  model: payload.model || null,
  appHome: path.join(app.getPath("userData"), "codex-home"),
}));
ipcMain.handle("memories:list", async (_event, cwd) => localMemoryStore.list(cwd || DEFAULT_CWD));
ipcMain.handle("memories:save", async (_event, memory) => ({ entry: localMemoryStore.save(memory), state: localMemoryStore.list(memory?.projectPath || DEFAULT_CWD) }));
ipcMain.handle("memories:delete", async (_event, memoryId) => localMemoryStore.remove(memoryId));
ipcMain.handle("memories:settings", async (_event, settings) => localMemoryStore.settings(settings));
ipcMain.handle("usage:snapshot", async () => usageLedger.snapshot());
ipcMain.handle("usage:price", async (_event, key, price) => usageLedger.setPrice(key, price));
ipcMain.handle("secrets:list", async () => ({ secrets: secretStore.list() }));
ipcMain.handle("secrets:save", async (_event, secret) => ({ secret: secretStore.save(secret), secrets: secretStore.list() }));
ipcMain.handle("secrets:delete", async (_event, secretId) => ({ ...secretStore.remove(secretId), secrets: secretStore.list() }));
ipcMain.handle("hooks:list", async (_event, cwd) => listHooks(cwd));
ipcMain.handle("hooks:create", async (_event, payload) => createProjectHook(payload));
ipcMain.handle("scheduler:list", async () => publishScheduler());
ipcMain.handle("scheduler:create", async (_event, payload) => {
  const task = scheduledTaskStore.create(payload);
  appendAudit("scheduler.task.created", { taskId: task.id, name: task.name, schedule: task.schedule });
  return publishScheduler();
});
ipcMain.handle("scheduler:update", async (_event, taskId, patch) => {
  const task = scheduledTaskStore.update(taskId, patch);
  appendAudit("scheduler.task.updated", { taskId, enabled: task.enabled, schedule: task.schedule });
  return publishScheduler();
});
ipcMain.handle("scheduler:delete", async (_event, taskId) => {
  scheduledTaskStore.remove(taskId);
  appendAudit("scheduler.task.deleted", { taskId });
  return publishScheduler();
});
ipcMain.handle("scheduler:run-now", async (_event, taskId) => {
  const task = scheduledTaskStore.state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("计划任务不存在");
  await runScheduledTask(task);
  return publishScheduler();
});
ipcMain.handle("scheduler:mark-read", async (_event, runId) => scheduledTaskStore.markRead(runId || null));
ipcMain.handle("agent:image:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择要发送给模型的图片",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("agent:attachment:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择要提供给 OnPeople 的文件或文件夹",
    buttonLabel: "添加",
    properties: ["openFile", "openDirectory", "multiSelections"],
  });
  if (result.canceled) return [];
  return result.filePaths.slice(0, 20).map((selected) => {
    const resolved = path.resolve(selected);
    const stat = fs.statSync(resolved);
    return { path: resolved, name: path.basename(resolved) || resolved, kind: stat.isDirectory() ? "folder" : "file", size: stat.isFile() ? stat.size : null };
  });
});
ipcMain.handle("agent:image:paste", async () => {
  const image = clipboard.readImage();
  let imagePath = null;
  let preview = image;
  if (!image.isEmpty()) {
    const size = image.getSize();
    if (size.width > 16_384 || size.height > 16_384) throw new Error("剪贴板图片尺寸不能超过 16384×16384");
    const png = image.toPNG();
    if (!png.length || png.length > 25 * 1024 * 1024) throw new Error("剪贴板图片不能超过 25 MB");
    const directory = path.join(app.getPath("userData"), "pasted-images");
    fs.mkdirSync(directory, { recursive: true });
    imagePath = path.join(directory, `paste-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`);
    fs.writeFileSync(imagePath, png, { mode: 0o600 });
  } else if (process.platform === "darwin") {
    const fileUrl = clipboard.read("public.file-url");
    if (fileUrl) {
      try {
        const candidate = decodeURIComponent(new URL(fileUrl.trim()).pathname);
        const extension = path.extname(candidate).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) return null;
        const stat = fs.statSync(candidate);
        if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("剪贴板图片不能超过 25 MB");
        imagePath = candidate;
        preview = nativeImage.createFromPath(candidate);
      } catch (error) {
        if (error.message.includes("25 MB")) throw error;
        return null;
      }
    }
  }
  if (!imagePath) return null;
  const previewImage = preview.isEmpty() ? null : preview.resize({ width: 112, height: 80, quality: "good" });
  return {
    path: imagePath,
    name: path.basename(imagePath),
    previewDataUrl: previewImage?.toDataURL() || null,
  };
});
ipcMain.handle("agent:goal:set", async (event, payload) => {
  const result = await setGoal(payload);
  bindWindowThread(event.sender.id, result.threadId);
  return result;
});
ipcMain.handle("agent:goal:update", async (_event, threadId, action, value) => updateGoal(threadId, action, value));
ipcMain.handle("agent:provider:get", async (event, requestedType, requestedThreadId = null) => {
  const threadId = String(requestedThreadId || windowThreadIds.get(event.sender.id) || "").trim() || null;
  const settings = Object.hasOwn(PROVIDERS, requestedType)
    ? providerProfileForThread(threadId, requestedType)
    : providerContextForThread(threadId).settings;
  return publicProviderSettings(settings);
});
ipcMain.handle("agent:provider:save", async (event, input) => {
  if (runtimeStartPromise) throw new Error("Agent 运行时正在重连，请稍后再试");
  if (input?.type === "onpeople" && !cloudAccount?.apiKey()) {
    throw new Error("请先登录 Sub2API 账号，再选择 OnPeople 模型");
  }
  const threadId = String(input?.threadId || windowThreadIds.get(event.sender.id) || "").trim() || null;
  const before = providerContextForThread(threadId).settings;
  const normalized = normalizeProviderSettings(input, before);
  const changed = before.type !== normalized.type
    || before.model !== normalized.model
    || before.baseUrl !== normalized.baseUrl
    || before.apiKey !== normalized.apiKey;
  if (threadId) persistThreadProviderSettings(threadId, normalized);
  else persistProviderSettings(input);
  let pending = false;
  if (changed) {
    appendAudit("provider.changed", {
      from: { type: before.type, model: before.model, baseUrl: before.baseUrl },
      to: { type: normalized.type, model: normalized.model, baseUrl: normalized.baseUrl },
      threadId,
    });
    if (threadId && activeTurnIdsByThread.has(threadId)) {
      threadContexts.update(threadId, { pendingProvider: { ...normalized } });
      pending = true;
    } else if (threadId) {
      await applyThreadProvider(threadId, normalized);
    }
  }
  return {
    settings: publicProviderSettings(normalized),
    changed,
    pending,
    reconnected: false,
    threadId,
  };
});
ipcMain.handle("agent:new-task", async (event) => {
  bindWindowThread(event.sender.id, null);
  return { created: true };
});

ipcMain.handle("agent:interrupt", async (_event, threadId) => {
  const id = String(threadId || "").trim();
  const turnId = activeTurnIdsByThread.get(id);
  if (!id || !turnId) return { interrupted: false };
  const goal = goalsByThread.get(id);
  if (goal?.status === "active") await updateGoal(id, "pause");
  await appServer.request("turn/interrupt", { threadId: id, turnId });
  return { interrupted: true };
});

ipcMain.handle("agent:approval", async (_event, requestId, decision) => {
  const result = appServer.resolveServerRequest(requestId, decision);
  appendAudit("approval.resolve", { requestId, decision });
  return result;
});

app.on("open-url", (event, url) => { event.preventDefault(); handleOnPeopleUrl(url); });
app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("com.userinner.onpeople");
  app.setAsDefaultProtocolClient("onpeople");
  powerMonitor.on("resume", () => void schedulerTick());
  powerMonitor.on("time-changed", () => void schedulerTick());
  installApplicationMenu();
  await createWindow();
  const startupLink = process.argv.find((value) => value.startsWith("onpeople://"));
  if (startupLink) handleOnPeopleUrl(startupLink);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  for (const [, session] of terminalProcesses) {
    try { session.process.kill(); } catch {}
  }
  terminalProcesses.clear();
  cancelRuntimeRestart();
  clearInterval(schedulerTimer);
  if (activePowerBlockerId != null && powerSaveBlocker.isStarted(activePowerBlockerId)) {
    powerSaveBlocker.stop(activePowerBlockerId);
    activePowerBlockerId = null;
  }
  agentRuntime?.close();
  if (scheduledRunsByThread.size) failActiveScheduledRuns("OnPeople 在计划任务完成前退出", false);
  appServer?.stop();
  browserBridge?.stop();
  modelGateway?.stop();
});
