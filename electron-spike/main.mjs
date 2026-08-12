import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  WebContentsView,
} from "electron";

import {
  browserProfilePath,
  ElectronBrowserController,
  normalizeBrowserAddress,
} from "./browser-controller.mjs";
import { BrowserAgentBridge } from "./browser-agent-bridge.mjs";
import { RustBridge } from "./rust-bridge.mjs";
import { ElectronShellAdapter } from "./shell-adapter.mjs";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "..");
const processStartedAt = process.hrtime.bigint();
const execFileAsync = promisify(execFile);
const startupMethods = new Set([
  "runtime.status",
  "preferences.get",
  "thread.list",
  "runtime.snapshot",
  "scheduler.get",
]);
const STARTUP_REQUEST_TIMEOUT_MS = 12_000;

let appReadyMs = null;
let rendererReadyMs = null;
let mainWindow = null;
let browserController = null;
let windowCrashCount = 0;
let browserAgentRendererReady = false;
const pendingBrowserAgentCommands = [];

const elapsedMs = () =>
  Number(process.hrtime.bigint() - processStartedAt) / 1_000_000;

const runtimeRoot = app.isPackaged
  ? path.join(process.resourcesPath, ".embedded-runtime")
  : path.join(repositoryRoot, ".embedded-runtime");
const hostBinary =
  process.env.ONPEOPLE_RUST_HOST ||
  (app.isPackaged
    ? path.join(runtimeRoot, "bin", "onpeople-desktop-host")
    : path.join(repositoryRoot, "target", "debug", "onpeople-desktop-host"));

function responseSuccess(request, result = null) {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    result: result ?? null,
  };
}

function responseFailure(request, error) {
  return {
    protocolVersion: 1,
    requestId: request?.requestId ?? "electron-malformed-request",
    ok: false,
    error: {
      code: "INTERNAL",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
  };
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function bootstrap() {
  appReadyMs = elapsedMs();
  const dataRoot =
    process.env.ONPEOPLE_DATA_ROOT ||
    path.join(
      app.getPath("appData"),
      app.isPackaged
        ? "internal-agent-workbench"
        : "internal-agent-workbench-dev",
    );
  await mkdir(dataRoot, { recursive: true });
  const emit = (event, payload) => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow.webContents.send(`onpeople:event:${event}`, payload);
    }
  };
  const deliverBrowserAgentCommand = (command) => {
    if (!browserAgentRendererReady || !mainWindow || mainWindow.isDestroyed()) {
      pendingBrowserAgentCommands.push(command);
      if (pendingBrowserAgentCommands.length > 16) {
        pendingBrowserAgentCommands.shift();
      }
      return;
    }
    emit("browser:agent-command", command);
  };
  const browserAgentBridge = new BrowserAgentBridge({
    handler: async (request) => {
      if (!browserController) throw new Error("内嵌浏览器尚未就绪");
      const command = String(request?.command ?? "");
      const payload = request?.payload ?? {};
      if (command === "open") {
        const url = normalizeBrowserAddress(payload.urlOrQuery ?? payload.url);
        const routeId = `browser-${randomUUID()}`;
        await browserController.handle("browser.command", {
          command: {
            command: "createRoute",
            payload: { routeId, threadId: "agent", url },
          },
        });
        const browserCommand = {
          id: `browser-open-${randomUUID()}`,
          kind: "open",
          routeId,
          url,
        };
        deliverBrowserAgentCommand(browserCommand);
        return browserController.handle("browser.command", {
          command: { command: "domSnapshot", payload: { routeId } },
        });
      }
      const state = browserController.state();
      const routeId = String(
        payload.routeId ?? payload.tabId ?? state.activeRouteId ?? "",
      );
      if (!routeId) throw new Error("请先打开一个内嵌浏览器页面");
      const mapped = {
        dom_snapshot: { command: "domSnapshot", payload: { routeId } },
        click: {
          command: "click",
          payload: { routeId, selector: payload.selector },
        },
        type: {
          command: "fill",
          payload: { routeId, selector: payload.selector, value: payload.text },
        },
        back: { command: "back", payload: { routeId } },
        reload: { command: "reload", payload: { routeId } },
      }[command];
      if (command === "state") return state;
      if (!mapped) throw new Error(`不支持的 Agent 浏览器操作: ${command}`);
      return browserController.handle("browser.command", { command: mapped });
    },
  });
  process.env.ONPEOPLE_BROWSER_AGENT_BRIDGE = await browserAgentBridge.start();
  process.env.ONPEOPLE_BROWSER_AGENT_TOKEN = browserAgentBridge.token;

  const rustBridge = new RustBridge({
    binary: hostBinary,
    dataRoot,
    runtimeRoot,
    transport:
      process.env.ONPEOPLE_DESKTOP_TRANSPORT === "socket" ? "socket" : "stdio",
    socketPath: path.join(app.getPath("userData"), "desktop-api.sock"),
  });
  await rustBridge.start();
  rustBridge.onEvent((event) => emit("desktop:event", event));

  const browserPartition = "persist:onpeople-browser";
  const browserSession = session.fromPartition(browserPartition);
  browserSession.setPermissionRequestHandler(
    (_contents, permission, callback) =>
      callback(permission === "clipboard-sanitized-write"),
  );
  const browserDownloads = new Map();
  browserSession.on("will-download", (_event, item, contents) => {
    const id = randomUUID();
    const downloadDirectory =
      process.env.ONPEOPLE_BROWSER_DOWNLOAD_DIR || app.getPath("downloads");
    item.setSavePath(path.join(downloadDirectory, item.getFilename()));
    const startedAt = Date.now();
    const snapshot = (state = item.getState()) => ({
      id,
      tabId:
        browserController
          ?.state()
          .tabs.find(
            (tab) => browserController.webContents(tab.routeId) === contents,
          )?.routeId ?? null,
      filename: item.getFilename(),
      url: item.getURL(),
      path: item.getSavePath() || null,
      state,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      startedAt,
      updatedAt: Date.now(),
    });
    browserDownloads.set(id, snapshot());
    emit("browser:event", { kind: "download-started", download: snapshot() });
    item.on("updated", () => {
      const download = snapshot();
      browserDownloads.set(id, download);
      emit("browser:event", { kind: "download-progress", download });
    });
    item.once("done", (_doneEvent, state) => {
      const download = { ...snapshot(state), path: item.getSavePath() || null };
      browserDownloads.set(id, download);
      emit("browser:event", { kind: "download-finished", download });
    });
  });

  let shellAdapter = null;
  const createWindow = () => {
    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 980,
      minHeight: 680,
      show: false,
      backgroundColor: "#f7f7f5",
      title: "OnPeople",
      webPreferences: {
        preload: path.join(moduleRoot, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (safeExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      const developmentUrl = process.env.ONPEOPLE_VITE_URL;
      if (
        (developmentUrl && url.startsWith(developmentUrl)) ||
        (!developmentUrl && url.startsWith("file:"))
      ) {
        return;
      }
      event.preventDefault();
      if (safeExternalUrl(url)) void shell.openExternal(url);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      windowCrashCount += 1;
      if (details.reason !== "clean-exit") window.webContents.reload();
    });
    window.webContents.on("did-start-loading", () => {
      if (mainWindow === window) browserAgentRendererReady = false;
    });
    window.once("ready-to-show", () => window.show());
    if (process.env.ONPEOPLE_VITE_URL) {
      void window.loadURL(process.env.ONPEOPLE_VITE_URL);
    } else {
      void window.loadFile(path.join(repositoryRoot, "dist", "index.html"));
    }
    return window;
  };

  const attachDesktopWindow = () => {
    browserAgentRendererReady = false;
    mainWindow = createWindow();
    browserController?.close();
    browserController = new ElectronBrowserController({
      window: mainWindow,
      WebContentsView,
      partition: browserPartition,
      profilePath: browserProfilePath(app.getPath("userData")),
      emit,
      idleDestroyMs:
        Number(process.env.ONPEOPLE_BROWSER_IDLE_DESTROY_MS) || 60_000,
    });
    shellAdapter = new ElectronShellAdapter({
      window: mainWindow,
      requestRust: (request) => rustBridge.request(request),
      emit,
      rendererReady: () => {
        rendererReadyMs ??= elapsedMs();
      },
    });
  };
  attachDesktopWindow();

  const desktopRequest = async (request) => {
    try {
      if (!request || request.protocolVersion !== 1) {
        throw new Error("Electron Desktop API 仅支持协议版本 1");
      }
      if (String(request.method).startsWith("shell.")) {
        return responseSuccess(
          request,
          await shellAdapter?.handle(request.method, request.params ?? {}),
        );
      }
      if (String(request.method).startsWith("browser.")) {
        return responseSuccess(
          request,
          await handleBrowserDesktopRequest(
            request.method,
            request.params ?? {},
          ),
        );
      }
      return await rustBridge.request(
        request,
        startupMethods.has(request.method)
          ? STARTUP_REQUEST_TIMEOUT_MS
          : undefined,
      );
    } catch (error) {
      return responseFailure(request, error);
    }
  };
  const handleBrowserDesktopRequest = async (method, params) => {
    if (!browserController) throw new Error("浏览器服务尚未就绪");
    if (method === "browser.action") {
      const action = String(params.action ?? "");
      if (action === "openExternal") {
        const result = await browserController.handle(method, params);
        if (safeExternalUrl(result.url)) await shell.openExternal(result.url);
        return { ...result, opened: true };
      }
      if (action === "downloads") return [...browserDownloads.values()];
      if (action === "showDownload") {
        const download = browserDownloads.get(String(params.payload?.id ?? ""));
        if (download?.path) shell.showItemInFolder(download.path);
        return { shown: Boolean(download?.path) };
      }
      if (action === "inspectDeveloperState") {
        const result = await browserController.handle(method, params);
        const routeId = String(params.payload?.routeId ?? "");
        browserController
          .webContents(routeId)
          ?.openDevTools({ mode: "detach" });
        return result;
      }
    }
    return browserController.handle(method, params);
  };

  ipcMain.handle("onpeople:metrics", () => metrics(rustBridge));
  ipcMain.on("onpeople:browser-agent-ready", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    browserAgentRendererReady = true;
    for (const command of pendingBrowserAgentCommands.splice(0)) {
      emit("browser:agent-command", command);
    }
  });
  ipcMain.handle("onpeople:browser", async (_event, command, payload = {}) => {
    if (!browserController) throw new Error("浏览器服务尚未就绪");
    if (command === "state") return browserController.state();
    const routeId = String(
      payload.routeId ??
        payload.tabId ??
        browserController.state().activeRouteId ??
        "",
    );
    const commandMap = {
      "dom-snapshot": "domSnapshot",
      "visual-snapshot": "visualSnapshot",
      "developer-tools": "developerInspect",
      back: "back",
      forward: "forward",
      reload: "reload",
      stop: "stop",
      unregister: "closeRoute",
    };
    if (commandMap[command]) {
      return browserController.handle("browser.command", {
        command: { command: commandMap[command], payload: { routeId } },
      });
    }
    const actionMap = {
      "session-status": "sessionStatus",
      "clear-site-data": "clearSession",
      "clear-all-data": "clearAllData",
      downloads: "downloads",
      "show-download": "showDownload",
      "open-external": "openExternal",
      zoom: "zoom",
      recover: "recover",
      activate: "activateTab",
      focus: "focus",
    };
    if (actionMap[command]) {
      return handleBrowserDesktopRequest("browser.action", {
        action: actionMap[command],
        payload: { ...payload, routeId },
      });
    }
    throw new Error(`旧浏览器 IPC 不支持操作: ${command}`);
  });
  ipcMain.handle("onpeople:invoke", async (_event, command, args = {}) => {
    if (command === "desktop_request") return desktopRequest(args.request);
    throw new Error(`Electron 只接受 Desktop API transport: ${command}`);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) attachDesktopWindow();
  });
  let servicesStopped = false;
  const stopServices = () => {
    if (servicesStopped) return;
    servicesStopped = true;
    browserController?.close();
    browserAgentBridge.close();
    rustBridge.stop();
  };
  app.on("before-quit", stopServices);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  if (process.env.ONPEOPLE_ELECTRON_AUTO_QUIT_MS) {
    const delay = Number(process.env.ONPEOPLE_ELECTRON_AUTO_QUIT_MS);
    setTimeout(
      async () => {
        await persistMetrics(rustBridge);
        stopServices();
        app.exit(0);
      },
      Number.isFinite(delay) ? delay : 30_000,
    );
  }
}

async function metrics(rustBridge) {
  const memory = await process.getProcessMemoryInfo();
  const processes = app.getAppMetrics().map((entry) => ({
    pid: entry.pid,
    type: entry.type,
    serviceName: entry.serviceName,
    cpuPercent: entry.cpu.percentCPUUsage,
    workingSetKb: entry.memory.workingSetSize,
    peakWorkingSetKb: entry.memory.peakWorkingSetSize,
  }));
  let rustHostRssKb = null;
  if (rustBridge.pid && process.platform !== "win32") {
    try {
      const { stdout } = await execFileAsync("/bin/ps", [
        "-o",
        "rss=",
        "-p",
        String(rustBridge.pid),
      ]);
      rustHostRssKb = Number.parseInt(stdout.trim(), 10) || null;
    } catch {
      // A concurrent sidecar exit is represented by restartCount.
    }
  }
  const electronWorkingSetKb = processes.reduce(
    (total, entry) => total + entry.workingSetKb,
    0,
  );
  return {
    appReadyMs,
    rendererReadyMs,
    elapsedMs: elapsedMs(),
    mainMemoryKb: memory.residentSet ?? memory.private,
    electronWorkingSetKb,
    rustHostPid: rustBridge.pid,
    rustHostRssKb,
    totalWorkingSetKb:
      rustHostRssKb === null
        ? electronWorkingSetKb
        : electronWorkingSetKb + rustHostRssKb,
    rustTransport: rustBridge.transport,
    rustHostRestartCount: rustBridge.restartCount,
    windowCrashCount,
    browser: browserController?.state() ?? null,
    processes,
  };
}

async function persistMetrics(rustBridge) {
  const output = process.env.ONPEOPLE_ELECTRON_METRICS_FILE;
  if (!output) return;
  await writeFile(
    output,
    `${JSON.stringify(await metrics(rustBridge), null, 2)}\n`,
  );
}

app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
