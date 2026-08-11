import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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
  isSafeBrowserUrl,
} from "./browser-controller.mjs";
import { RustBridge } from "./rust-bridge.mjs";
import { ElectronShellAdapter, fileExists } from "./shell-adapter.mjs";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "..");
const processStartedAt = process.hrtime.bigint();
const execFileAsync = promisify(execFile);
const browserMethods = new Set([
  "browser.state",
  "browser.restart",
  "browser.command",
  "browser.surface.bounds",
  "browser.annotation.list",
  "browser.annotation.save",
  "browser.annotation.delete",
  "browser.action",
]);
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
let acceptancePromise = Promise.resolve();
let acceptance = emptyAcceptance();
let memorySnapshots = {};
let fixtureServer = null;

const elapsedMs = () =>
  Number(process.hrtime.bigint() - processStartedAt) / 1_000_000;
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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

function emptyAcceptance() {
  return {
    lifecycleCycles: 0,
    lifecycleFailures: 0,
    loginPersistence: false,
    download: false,
    upload: false,
    popup: false,
    crashRecovery: false,
    unrecoveredCrashes: 0,
    desktopMethodCount: 0,
    uniqueDesktopMethodCount: 0,
    featureErrors: [],
  };
}

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

async function bootstrap() {
  clearTimeout(readinessWatchdog);
  appReadyMs = elapsedMs();

  const dataRoot = path.join(
    app.getPath("appData"),
    app.isPackaged ? "internal-agent-workbench" : "internal-agent-workbench-dev",
  );
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

  const emit = (event, payload) => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow.webContents.send(`onpeople:event:${event}`, payload);
    }
  };
  rustBridge.onEvent((event) => emit("desktop:event", event));

  const partition = "persist:onpeople-browser";
  const browserSession = session.fromPartition(partition);
  browserSession.setPermissionRequestHandler(
    (_webContents, permission, callback) =>
      callback(permission === "clipboard-sanitized-write"),
  );
  browserSession.on("will-download", (_event, item) => {
    const testRoot = process.env.ONPEOPLE_ELECTRON_DOWNLOAD_ROOT;
    if (testRoot) item.setSavePath(path.join(testRoot, item.getFilename()));
    const payload = {
      url: item.getURL(),
      filename: item.getFilename(),
      state: item.getState(),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
    };
    emit("browser:event", { kind: "download-started", ...payload });
    item.on("updated", () =>
      emit("browser:event", {
        kind: "download-progress",
        ...payload,
        state: item.getState(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      }),
    );
    item.once("done", (_doneEvent, state) => {
      const result = {
        kind: "download-finished",
        ...payload,
        state,
        path: item.getSavePath(),
      };
      emit("browser:event", result);
      if (nextDownloadResolver) {
        nextDownloadResolver(result);
        nextDownloadResolver = null;
      }
    });
  });

  function createWindow() {
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
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeBrowserUrl(url)) void shell.openExternal(url);
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
      if (isSafeBrowserUrl(url)) void shell.openExternal(url);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      windowCrashCount += 1;
      if (details.reason !== "clean-exit") window.webContents.reload();
    });
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => browserController?.close());
    if (process.env.ONPEOPLE_VITE_URL) {
      void window.loadURL(process.env.ONPEOPLE_VITE_URL);
    } else {
      void window.loadFile(path.join(repositoryRoot, "dist", "index.html"));
    }
    return window;
  }

  let shellAdapter = null;

  function attachDesktopWindow() {
    mainWindow = createWindow();
    browserController = new ElectronBrowserController({
      window: mainWindow,
      WebContentsView,
      partition,
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
    mainWindow.webContents.once("did-finish-load", async () => {
      await sleep(1_000);
      memorySnapshots.idle = await metrics(rustBridge, false);
      if (process.env.ONPEOPLE_ELECTRON_ACCEPTANCE === "1") {
        acceptancePromise = runAcceptanceProbe({
          controller: browserController,
          browserSession,
          rustBridge,
        });
        if (process.env.ONPEOPLE_ELECTRON_AUTO_QUIT_MS) {
          void acceptancePromise.then(async () => {
            await persistMetrics(rustBridge);
            app.quit();
          });
        }
      }
    });
  }

  attachDesktopWindow();

  async function desktopRequest(request) {
    try {
      if (!request || request.protocolVersion !== 1) {
        throw new Error("Electron Desktop API 仅支持协议版本 1");
      }
      if (browserMethods.has(request.method)) {
        return responseSuccess(
          request,
          await browserController.handle(request.method, request.params ?? {}),
        );
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
  }

  ipcMain.handle("onpeople:metrics", () => metrics(rustBridge));
  ipcMain.handle("onpeople:browser", async (_event, command, payload = {}) => {
    if (command === "state") return browserController.state();
    if (command === "close") {
      const routeId = browserController.state().activeRouteId;
      return routeId
        ? browserController.handle("browser.command", {
            command: { command: "closeRoute", payload: { routeId } },
          })
        : { closed: false };
    }
    throw new Error("旧 Electron 浏览器桥仅保留诊断用途");
  });
  ipcMain.handle("onpeople:invoke", async (_event, command, args = {}) => {
    if (command === "desktop_request") return desktopRequest(args.request);
    throw new Error(`Electron 只接受 Desktop API transport: ${command}`);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) attachDesktopWindow();
  });
  app.on("before-quit", () => {
    browserController?.close();
    rustBridge.stop();
    fixtureServer?.close();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  if (process.env.ONPEOPLE_ELECTRON_AUTO_QUIT_MS) {
    const delay = Number(process.env.ONPEOPLE_ELECTRON_AUTO_QUIT_MS);
    setTimeout(
      async () => {
        await acceptancePromise;
        await persistMetrics(rustBridge);
        app.quit();
      },
      Number.isFinite(delay) ? delay : 180_000,
    );
  }
}

async function metrics(rustBridge, includeHistory = true) {
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
    browser: browserController?.diagnostics ?? null,
    acceptance,
    ...(includeHistory ? { memorySnapshots } : {}),
    processes,
  };
}

async function persistMetrics(rustBridge) {
  const output = process.env.ONPEOPLE_ELECTRON_METRICS_FILE;
  if (!output) return;
  await writeFile(output, `${JSON.stringify(await metrics(rustBridge), null, 2)}\n`);
}

let nextDownloadResolver = null;

async function runAcceptanceProbe({ controller, browserSession, rustBridge }) {
  const fixture = await startFixtureServer();
  fixtureServer = fixture.server;
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "onpeople-electron-acceptance-"),
  );
  const uploadPath = path.join(temporaryRoot, "upload.txt");
  await writeFile(uploadPath, "onpeople upload fixture\n");
  process.env.ONPEOPLE_ELECTRON_DOWNLOAD_ROOT = temporaryRoot;
  const routeId = "acceptance-main";
  try {
    const capabilitiesResponse = await rustBridge.request({
      protocolVersion: 1,
      requestId: "electron-acceptance-capabilities",
      method: "system.capabilities",
      params: {},
    });
    const methods = capabilitiesResponse.ok
      ? capabilitiesResponse.result?.methods ?? []
      : [];
    acceptance.desktopMethodCount = methods.length;
    acceptance.uniqueDesktopMethodCount = new Set(methods).size;
    await controller.handle("browser.command", {
      command: {
        command: "createRoute",
        payload: { routeId, threadId: "acceptance", url: fixture.url },
      },
    });
    await controller.handle("browser.surface.bounds", {
      routeId,
      x: 120,
      y: 180,
      width: 900,
      height: 620,
      scaleFactor: 1,
      visible: true,
      interactive: false,
    });
    await sleep(500);
    memorySnapshots.browserOpen = await metrics(rustBridge, false);

    await browserSession.cookies.set({
      url: fixture.url,
      name: "onpeople_session",
      value: "persisted",
    });
    await controller.forceDestroy(routeId, true);
    await controller.handle("browser.surface.bounds", {
      routeId,
      x: 120,
      y: 180,
      width: 900,
      height: 620,
      scaleFactor: 1,
      visible: true,
      interactive: false,
    });
    acceptance.loginPersistence =
      (await browserSession.cookies.get({
        url: fixture.url,
        name: "onpeople_session",
      })).at(0)?.value === "persisted";

    const contents = controller.webContents(routeId);
    if (!contents) throw new Error("acceptance WebContentsView 未创建");
    await setUploadFile(contents, uploadPath);
    acceptance.upload = await waitUntil(async () =>
      contents.executeJavaScript(
        `document.querySelector("#upload-status")?.textContent === "upload.txt"`,
      ),
    );

    const downloadPromise = new Promise((resolve) => {
      nextDownloadResolver = resolve;
    });
    await contents.executeJavaScript(`document.querySelector("#download").click()`);
    const download = await Promise.race([
      downloadPromise,
      sleep(8_000).then(() => null),
    ]);
    acceptance.download = Boolean(
      download?.state === "completed" && (await fileExists(download.path)),
    );

    const popupRouteCount = controller.diagnostics.routeCount;
    await contents.executeJavaScript(`window.open("/popup", "onpeople-popup")`);
    acceptance.popup = await waitUntil(
      () => controller.diagnostics.routeCount > popupRouteCount,
    );
    for (const tab of controller.state().tabs) {
      if (tab.routeId === routeId) continue;
      await controller.handle("browser.command", {
        command: { command: "closeRoute", payload: { routeId: tab.routeId } },
      });
    }
    await controller.handle("browser.action", {
      action: "activateTab",
      payload: { routeId, threadId: "acceptance" },
    });
    await controller.handle("browser.surface.bounds", {
      routeId,
      x: 120,
      y: 180,
      width: 900,
      height: 620,
      scaleFactor: 1,
      visible: true,
      interactive: false,
    });

    const crashesBefore = controller.diagnostics.crashCount;
    const recoveriesBefore = controller.diagnostics.recoveryCount;
    controller.webContents(routeId)?.forcefullyCrashRenderer();
    acceptance.crashRecovery = await waitUntil(
      () =>
        controller.diagnostics.crashCount > crashesBefore &&
        controller.diagnostics.recoveryCount > recoveriesBefore &&
        Boolean(controller.webContents(routeId)),
      12_000,
    );
    acceptance.unrecoveredCrashes = acceptance.crashRecovery ? 0 : 1;

    await controller.handle("browser.surface.bounds", {
      routeId,
      x: 120,
      y: 180,
      width: 900,
      height: 620,
      scaleFactor: 1,
      visible: false,
      interactive: false,
    });
    await sleep(500);
    memorySnapshots.browserSuspended = await metrics(rustBridge, false);
    await controller.forceDestroy(routeId, true);
    await sleep(1_500);
    memorySnapshots.browserDestroyed = await metrics(rustBridge, false);

    for (let index = 0; index < 30; index += 1) {
      const cycleRoute = `acceptance-cycle-${index}`;
      try {
        await controller.handle("browser.command", {
          command: {
            command: "createRoute",
            payload: {
              routeId: cycleRoute,
              threadId: "acceptance",
              url: `${fixture.url}?cycle=${index}`,
            },
          },
        });
        await controller.handle("browser.surface.bounds", {
          routeId: cycleRoute,
          x: 120,
          y: 180,
          width: 900,
          height: 620,
          scaleFactor: 1,
          visible: true,
          interactive: false,
        });
        await controller.handle("browser.surface.bounds", {
          routeId: cycleRoute,
          x: 120,
          y: 180,
          width: 900,
          height: 620,
          scaleFactor: 1,
          visible: false,
          interactive: false,
        });
        await controller.forceDestroy(cycleRoute, false);
        acceptance.lifecycleCycles += 1;
      } catch (error) {
        acceptance.lifecycleFailures += 1;
        acceptance.featureErrors.push(
          `cycle ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    acceptance.featureErrors.push(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
  } finally {
    await controller.forceDestroy(routeId, false);
    await rm(temporaryRoot, { recursive: true, force: true });
    await new Promise((resolve) => fixture.server.close(resolve));
    fixtureServer = null;
    await persistMetrics(rustBridge);
  }
}

async function setUploadFile(contents, filePath) {
  contents.debugger.attach("1.3");
  try {
    const document = await contents.debugger.sendCommand("DOM.getDocument");
    const query = await contents.debugger.sendCommand("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: "#upload",
    });
    await contents.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: query.nodeId,
      files: [filePath],
    });
  } finally {
    contents.debugger.detach();
  }
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return true;
    } catch {
      // The renderer may be temporarily unavailable during crash recovery.
    }
    await sleep(50);
  }
  return false;
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    if (request.url === "/download") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="onpeople-download.txt"',
      });
      response.end("onpeople download fixture\n");
      return;
    }
    if (request.url === "/popup") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>OnPeople Popup</title><p>popup ready</p>");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <meta charset="utf-8"><title>OnPeople Browser Acceptance</title>
      <input id="upload" type="file">
      <span id="upload-status"></span>
      <a id="download" href="/download">download</a>
      <button id="popup" onclick="window.open('/popup', 'onpeople-popup')">popup</button>
      <script>
        document.querySelector('#upload').addEventListener('change', (event) => {
          document.querySelector('#upload-status').textContent = event.target.files[0]?.name ?? '';
        });
      </script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    console.error("Electron failed to start", error);
    app.exit(1);
  });
