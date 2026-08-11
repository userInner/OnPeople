import { execFile } from "node:child_process";
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

import { RustBridge } from "./rust-bridge.mjs";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "..");
const processStartedAt = process.hrtime.bigint();
const execFileAsync = promisify(execFile);
let appReadyMs = null;
let rendererReadyMs = null;
let mainWindow = null;
let browserView = null;
let browserViewCrashCount = 0;
let browserRestartCount = 0;
let windowCrashCount = 0;
let stabilityCycles = 0;
let stabilityFailures = 0;
let stabilityPromise = Promise.resolve();

const browserState = {
  url: "about:blank",
  title: "新标签页",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  crash: null,
};

const isSafeWebUrl = (value) => {
  try {
    const protocol = new URL(value).protocol;
    return (
      protocol === "https:" || protocol === "http:" || protocol === "about:"
    );
  } catch {
    return false;
  }
};

const elapsedMs = () =>
  Number(process.hrtime.bigint() - processStartedAt) / 1_000_000;

const readinessWatchdog = setTimeout(() => {
  console.error("Electron app readiness timed out", { isReady: app.isReady() });
  app.exit(1);
}, 15_000);

const runtimeRoot = app.isPackaged
  ? path.join(process.resourcesPath, ".embedded-runtime")
  : path.join(repositoryRoot, ".embedded-runtime");
const hostBinary =
  process.env.ONPEOPLE_RUST_HOST ||
  (app.isPackaged
    ? path.join(runtimeRoot, "bin", "onpeople-desktop-host")
    : path.join(repositoryRoot, "target", "debug", "onpeople-desktop-host"));

async function bootstrap() {
  clearTimeout(readinessWatchdog);
  appReadyMs = elapsedMs();

  const dataRoot = path.join(app.getPath("userData"), "rust-spike");
  await mkdir(dataRoot, { recursive: true });
  const transport =
    process.env.ONPEOPLE_DESKTOP_TRANSPORT === "socket" ? "socket" : "stdio";
  const rustBridge = new RustBridge({
    binary: hostBinary,
    dataRoot,
    runtimeRoot,
    transport,
    socketPath: path.join(app.getPath("userData"), "desktop-api.sock"),
  });
  await rustBridge.start();
  rustBridge.onEvent((event) => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow.webContents.send("onpeople:event:desktop:event", event);
    }
  });

  const browserSession = session.fromPartition(
    "persist:onpeople-electron-webcontentsview",
  );
  browserSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  function emitBrowserState() {
    if (browserView && !browserView.webContents.isDestroyed()) {
      browserState.canGoBack =
        browserView.webContents.navigationHistory.canGoBack();
      browserState.canGoForward =
        browserView.webContents.navigationHistory.canGoForward();
    }
    const snapshot = {
      ...browserState,
      restartCount: browserRestartCount,
    };
    if (!mainWindow?.isDestroyed()) {
      mainWindow.webContents.send("onpeople:event:electron-browser", snapshot);
    }
    return snapshot;
  }

  function ensureBrowserView() {
    if (browserView && !browserView.webContents.isDestroyed())
      return browserView;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("主窗口尚未就绪");
    }
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:onpeople-electron-webcontentsview",
      },
    });
    browserView = view;
    mainWindow.contentView.addChildView(view);
    view.setBackgroundColor("#f7f7f5");
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeWebUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isSafeWebUrl(url)) event.preventDefault();
    });
    contents.on("did-start-loading", () => {
      browserState.loading = true;
      browserState.crash = null;
      emitBrowserState();
    });
    contents.on("did-stop-loading", () => {
      browserState.loading = false;
      browserState.url = contents.getURL() || "about:blank";
      browserState.title = contents.getTitle() || "新标签页";
      emitBrowserState();
    });
    contents.on("did-navigate", (_event, url) => {
      browserState.url = url;
      emitBrowserState();
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      browserState.url = url;
      emitBrowserState();
    });
    contents.on("page-title-updated", (_event, title) => {
      browserState.title = title || "新标签页";
      emitBrowserState();
    });
    contents.on("render-process-gone", (_event, details) => {
      browserViewCrashCount += 1;
      browserRestartCount += 1;
      browserState.loading = false;
      browserState.crash = `页面进程已退出：${details.reason}`;
      emitBrowserState();
      setTimeout(() => {
        if (!contents.isDestroyed()) contents.reload();
      }, 400);
    });
    void contents.loadURL(browserState.url);
    return view;
  }

  function closeBrowserView() {
    const view = browserView;
    browserView = null;
    if (!view) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.contentView.removeChildView(view);
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  function setBrowserBounds(payload) {
    const view = ensureBrowserView();
    const bounds = {
      x: Math.max(0, Math.round(Number(payload.x) || 0)),
      y: Math.max(0, Math.round(Number(payload.y) || 0)),
      width: Math.max(1, Math.round(Number(payload.width) || 1)),
      height: Math.max(1, Math.round(Number(payload.height) || 1)),
    };
    view.setBounds(bounds);
    view.setVisible(payload.visible !== false);
    return emitBrowserState();
  }

  async function handleBrowserCommand(command, payload = {}) {
    if (command === "close") {
      closeBrowserView();
      return { closed: true };
    }
    const view = ensureBrowserView();
    const contents = view.webContents;
    switch (command) {
      case "create":
      case "bounds":
        return setBrowserBounds(payload);
      case "navigate": {
        const url = String(payload.url ?? "about:blank");
        if (!isSafeWebUrl(url))
          throw new Error("只允许 HTTP、HTTPS 或 about URL");
        await contents.loadURL(url);
        return emitBrowserState();
      }
      case "back":
        if (contents.navigationHistory.canGoBack())
          contents.navigationHistory.goBack();
        return emitBrowserState();
      case "forward":
        if (contents.navigationHistory.canGoForward())
          contents.navigationHistory.goForward();
        return emitBrowserState();
      case "reload":
        contents.reload();
        return emitBrowserState();
      case "state":
        return emitBrowserState();
      default:
        throw new Error(`未知 WebContentsView 命令: ${command}`);
    }
  }

  function legacyBrowserState() {
    return {
      hostReady: true,
      hostStatus: "ready",
      hostError: null,
      hostErrorKind: null,
      activeRouteId: null,
      tabs: [],
      profilePath: path.join(
        app.getPath("userData"),
        "Partitions",
        "onpeople-electron-webcontentsview",
      ),
    };
  }

  async function metrics() {
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
      browserViewCrashCount,
      windowCrashCount,
      stabilityCycles,
      stabilityFailures,
      processes,
    };
  }

  async function persistMetrics() {
    const output = process.env.ONPEOPLE_SPIKE_METRICS_FILE;
    if (!output) return;
    await writeFile(output, `${JSON.stringify(await metrics(), null, 2)}\n`);
  }

  ipcMain.handle("onpeople:metrics", () => metrics());
  ipcMain.handle("onpeople:browser", (_event, command, payload = {}) =>
    handleBrowserCommand(command, payload),
  );
  ipcMain.handle("onpeople:invoke", async (_event, command, args = {}) => {
    switch (command) {
      case "desktop_request":
        return rustBridge.request(args.request);
      case "frontend_ready":
        rendererReadyMs ??= elapsedMs();
        await persistMetrics();
        return null;
      case "activate_deep_links":
        return [];
      case "get_browser_state":
      case "restart_browser_host":
        return legacyBrowserState();
      case "get_cloud_account":
        return {
          signedIn: false,
          serviceUrl: "",
          account: null,
          group: null,
          models: [],
        };
      case "get_app_update_state":
        return {
          supported: false,
          status: "idle",
          currentVersion: app.getVersion(),
          availableVersion: null,
          progress: null,
          message: null,
        };
      case "open_external_url": {
        const url = args?.request?.url;
        if (!isSafeWebUrl(url))
          throw new Error("只允许打开 HTTP 或 HTTPS 链接");
        await shell.openExternal(url);
        return { opened: true };
      }
      default:
        throw new Error(`Electron spike 暂不支持旧命令: ${command}`);
    }
  });

  function createWindow() {
    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 980,
      minHeight: 680,
      show: false,
      backgroundColor: "#f7f7f5",
      title: "OnPeople Electron WebContentsView Spike",
      webPreferences: {
        preload: path.join(moduleRoot, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeWebUrl(url)) void shell.openExternal(url);
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
      if (isSafeWebUrl(url)) void shell.openExternal(url);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      windowCrashCount += 1;
      if (details.reason !== "clean-exit") window.webContents.reload();
    });
    window.webContents.once("did-finish-load", () => {
      if (process.env.ONPEOPLE_SPIKE_STABILITY === "1") {
        stabilityPromise = runStabilityProbe(window, ensureBrowserView);
      }
    });
    window.once("ready-to-show", () => window.show());
    window.on("closed", closeBrowserView);

    if (process.env.ONPEOPLE_VITE_URL) {
      const url = new URL(process.env.ONPEOPLE_VITE_URL);
      url.searchParams.set("electronSpikeBrowser", "1");
      void window.loadURL(url.toString());
    } else {
      void window.loadFile(path.join(repositoryRoot, "dist", "index.html"), {
        query: { electronSpikeBrowser: "1" },
      });
    }
    return window;
  }

  async function runStabilityProbe(window, getBrowserView) {
    try {
      for (let index = 0; index < 20; index += 1) {
        window.setSize(1180 + (index % 4) * 45, 760 + (index % 3) * 35);
        await new Promise((resolve) => setTimeout(resolve, 30));
        stabilityCycles += 1;
      }
      const deadline = Date.now() + 10_000;
      while (!browserView && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const view = getBrowserView();
      for (let index = 0; index < 5; index += 1) {
        try {
          await waitForLoad(view.webContents, () =>
            view.webContents.loadURL(
              `https://example.com/?onpeople-webcontentsview=${index}`,
            ),
          );
          stabilityCycles += 1;
          await waitForLoad(view.webContents, () => view.webContents.reload());
          stabilityCycles += 1;
        } catch {
          stabilityFailures += 1;
        }
      }
    } catch {
      stabilityFailures += 1;
    }
  }

  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
  app.on("before-quit", () => {
    closeBrowserView();
    rustBridge.stop();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  if (process.env.ONPEOPLE_SPIKE_AUTO_QUIT_MS) {
    const delay = Number(process.env.ONPEOPLE_SPIKE_AUTO_QUIT_MS);
    setTimeout(
      async () => {
        await stabilityPromise;
        await persistMetrics();
        app.quit();
      },
      Number.isFinite(delay) ? delay : 8_000,
    );
  }
}

function waitForLoad(contents, trigger) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("load timeout")), 8_000);
    contents.once("did-stop-loading", () => {
      clearTimeout(timer);
      resolve();
    });
    Promise.resolve()
      .then(trigger)
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    console.error("Electron spike failed to start", error);
    app.exit(1);
  });
