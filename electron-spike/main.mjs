import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { app, BrowserWindow, ipcMain, shell } from "electron";

import {
  ElectronBrowserHost,
  normalizeBrowserAddress,
} from "./browser-host.mjs";
import {
  BrowserAgentBridge,
  waitForBrowserPage,
} from "./browser-agent-bridge.mjs";
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
let browserHost = null;
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
      if (!browserHost) throw new Error("内嵌浏览器尚未就绪");
      const command = String(request?.command ?? "");
      const payload = request?.payload ?? {};
      if (command === "open") {
        const url = normalizeBrowserAddress(payload.urlOrQuery ?? payload.url);
        deliverBrowserAgentCommand({ kind: "open", url });
        const page = await waitForBrowserPage(browserHost, url);
        return browserHost.handle("dom-snapshot", { tabId: page.tabId });
      }
      const state = browserHost.state();
      const tabId = String(payload.tabId ?? state.activeTabId ?? "");
      if (!tabId) throw new Error("请先打开一个内嵌浏览器页面");
      const mapped = {
        state: "state",
        dom_snapshot: "dom-snapshot",
        click: "agent-click",
        type: "agent-type",
        back: "back",
        reload: "reload",
      }[command];
      if (!mapped) throw new Error(`不支持的 Agent 浏览器操作: ${command}`);
      return browserHost.handle(mapped, { tabId, ...payload });
    },
  });
  process.env.ONPEOPLE_BROWSER_AGENT_BRIDGE =
    await browserAgentBridge.start();
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
        webviewTag: true,
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
    browserHost?.close();
    browserHost = new ElectronBrowserHost({
      window: mainWindow,
      emit,
      preloadPath: path.join(moduleRoot, "browser-page-preload.cjs"),
    });
    browserHost.start();
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

  ipcMain.handle("onpeople:metrics", () => metrics(rustBridge));
  ipcMain.on("onpeople:browser-agent-ready", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    browserAgentRendererReady = true;
    for (const command of pendingBrowserAgentCommands.splice(0)) {
      emit("browser:agent-command", command);
    }
  });
  ipcMain.handle("onpeople:browser", async (_event, command, payload = {}) => {
    if (!browserHost) throw new Error("浏览器服务尚未就绪");
    return browserHost.handle(command, payload);
  });
  ipcMain.on("onpeople:browser-page-event", (event, payload) => {
    browserHost?.pageEvent(event.sender.id, payload);
  });
  ipcMain.handle("onpeople:invoke", async (_event, command, args = {}) => {
    if (command === "desktop_request") return desktopRequest(args.request);
    throw new Error(`Electron 只接受 Desktop API transport: ${command}`);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) attachDesktopWindow();
  });
  app.on("before-quit", () => {
    browserHost?.close();
    browserAgentBridge.close();
    rustBridge.stop();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  if (process.env.ONPEOPLE_ELECTRON_AUTO_QUIT_MS) {
    const delay = Number(process.env.ONPEOPLE_ELECTRON_AUTO_QUIT_MS);
    setTimeout(
      async () => {
        await persistMetrics(rustBridge);
        app.quit();
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
    browser: browserHost?.state() ?? null,
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
