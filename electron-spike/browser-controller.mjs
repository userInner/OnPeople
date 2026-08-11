import crypto from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_IDLE_DESTROY_MS = 60_000;
const BROWSER_INSPECT_TIMEOUT_MS = 8_000;
const BROWSER_LOAD_TIMEOUT_MS = 8_000;
const BROWSER_ACTION_TIMEOUT_MS = 10_000;

export function isSafeBrowserUrl(value) {
  try {
    return ["https:", "http:", "about:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function clampBounds(payload) {
  return {
    x: Math.max(0, Math.round(Number(payload.x) || 0)),
    y: Math.max(0, Math.round(Number(payload.y) || 0)),
    width: Math.max(1, Math.round(Number(payload.width) || 1)),
    height: Math.max(1, Math.round(Number(payload.height) || 1)),
  };
}

function routeState(routeId, threadId, url) {
  return {
    routeId,
    threadId,
    url,
    title: url === "about:blank" ? "新标签页" : url,
    faviconUrl: null,
    loading: false,
    // Codex keeps browser lifecycle separate from the rendered surface.  A
    // missing frame therefore must not be interpreted as a disconnected
    // browser.  Keep an explicit phase so the renderer can distinguish a
    // suspended native view from a page that is actually unavailable.
    phase: "creating",
    lastError: null,
    canGoBack: false,
    canGoForward: false,
    crashed: false,
    view: null,
    bounds: null,
    visible: false,
    destroyTimer: null,
    generation: 0,
    console: [],
  };
}

function pushBounded(values, value, limit = 100) {
  values.push(value);
  if (values.length > limit) values.splice(0, values.length - limit);
}

async function withTimeout(promise, milliseconds, message, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout?.();
          } finally {
            reject(new Error(message));
          }
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mergeImportedTree(source, target, relative = "") {
  const entries = await readdir(path.join(source, relative), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const childRelative = path.join(relative, entry.name);
    if (
      [
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "GrShaderCache",
      ].includes(entry.name)
    )
      continue;
    const destination = path.join(target, childRelative);
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true });
      await mergeImportedTree(source, target, childRelative);
    } else if (entry.isFile()) {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(source, childRelative), destination);
    }
  }
}

export async function applyPendingBrowserImports(profilePath) {
  const importRoot = path.join(
    path.dirname(profilePath),
    "onpeople-browser-imports",
  );
  let entries;
  try {
    entries = await readdir(importRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  let applied = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const source = path.join(importRoot, entry.name);
    try {
      await mergeImportedTree(source, profilePath);
      await rm(source, { recursive: true, force: true });
      applied += 1;
    } catch (error) {
      console.error("Failed to apply pending browser import", {
        source,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return applied;
}

export class ElectronBrowserController {
  #window;
  #WebContentsView;
  #partition;
  #profilePath;
  #idleDestroyMs;
  #emit;
  #routes = new Map();
  #annotations = new Map();
  #activeRouteId = null;
  #closed = false;
  #crashCount = 0;
  #recoveryCount = 0;
  #destroyCount = 0;
  #routeQueues = new Map();

  constructor({
    window,
    WebContentsView,
    partition,
    profilePath,
    emit,
    idleDestroyMs = DEFAULT_IDLE_DESTROY_MS,
  }) {
    this.#window = window;
    this.#WebContentsView = WebContentsView;
    this.#partition = partition;
    this.#profilePath = profilePath;
    this.#emit = emit;
    this.#idleDestroyMs = idleDestroyMs;
  }

  get diagnostics() {
    return {
      routeCount: this.#routes.size,
      liveViewCount: [...this.#routes.values()].filter((route) => route.view)
        .length,
      crashCount: this.#crashCount,
      recoveryCount: this.#recoveryCount,
      destroyCount: this.#destroyCount,
    };
  }

  state() {
    return {
      hostReady: true,
      hostStatus: "ready",
      hostError: null,
      hostErrorKind: null,
      activeRouteId: this.#activeRouteId,
      tabs: [...this.#routes.values()].map((route) => this.#publicRoute(route)),
      profilePath: this.#profilePath,
    };
  }

  close() {
    this.#closed = true;
    for (const route of this.#routes.values()) this.#destroyView(route);
    this.#routes.clear();
    this.#activeRouteId = null;
  }

  async restart() {
    const visibleRoutes = [...this.#routes.values()].filter(
      (route) => route.visible,
    );
    for (const route of this.#routes.values()) this.#destroyView(route);
    for (const route of visibleRoutes) await this.#ensureView(route);
    this.#publishState();
    return this.state();
  }

  async handle(method, params = {}, requestId = null) {
    const operation = this.#handle(method, params, requestId);
    // Every browser request has a deadline at the browser host boundary. It
    // is deliberately independent from the Rust Desktop API timeout so a
    // renderer cannot leave the Electron main process waiting forever.
    return withTimeout(
      operation,
      this.#timeoutFor(method),
      `浏览器操作超时: ${method}`,
    );
  }

  async #handle(method, params = {}, requestId = null) {
    switch (method) {
      case "browser.state":
        return this.state();
      case "browser.restart":
        return this.restart();
      case "browser.command":
        return this.#command(params.command, requestId);
      case "browser.surface.bounds":
        return this.#surfaceBounds(params);
      case "browser.annotation.list":
        return [...this.#annotations.values()].filter(
          (annotation) => annotation.routeId === params.routeId,
        );
      case "browser.annotation.save":
        this.#annotations.set(params.id, structuredClone(params));
        return params;
      case "browser.annotation.delete":
        return this.#annotations.delete(params.id);
      case "browser.action":
        return this.#action(params.action, params.payload ?? {});
      default:
        throw new Error(`Electron 浏览器不支持 Desktop 方法: ${method}`);
    }
  }

  webContents(routeId = this.#activeRouteId) {
    return routeId
      ? (this.#routes.get(routeId)?.view?.webContents ?? null)
      : null;
  }

  async forceDestroy(routeId, keepRoute = true) {
    const route = this.#routes.get(routeId);
    if (!route) return false;
    this.#destroyView(route);
    if (!keepRoute) this.#routes.delete(routeId);
    this.#publishState();
    return true;
  }

  #timeoutFor(method) {
    if (method === "browser.state" || method === "browser.surface.bounds") {
      return 2_000;
    }
    if (method === "browser.command") {
      return BROWSER_ACTION_TIMEOUT_MS;
    }
    if (method === "browser.action") return BROWSER_ACTION_TIMEOUT_MS;
    return BROWSER_INSPECT_TIMEOUT_MS;
  }

  async #command(command, requestId = null) {
    if (!command || typeof command !== "object") {
      throw new Error("browser.command 缺少命令");
    }
    const routeId = command.payload?.routeId;
    if (typeof routeId === "string" && routeId) {
      return this.#enqueueRoute(routeId, () =>
        this.#executeCommand(command, requestId),
      );
    }
    return this.#executeCommand(command, requestId);
  }

  #enqueueRoute(routeId, task) {
    const previous = this.#routeQueues.get(routeId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    settled.then(() => {
      if (this.#routeQueues.get(routeId) === settled) {
        this.#routeQueues.delete(routeId);
      }
    });
    this.#routeQueues.set(routeId, settled);
    return current;
  }

  async #executeCommand(command, requestId = null) {
    const payload = command.payload ?? {};
    switch (command.command) {
      case "createRoute": {
        const url = this.#validateUrl(payload.url);
        const route = this.#upsertRoute(payload.routeId, payload.threadId, url);
        this.#activate(route);
        if (url !== "about:blank") await this.#navigate(route, url);
        this.#publishState();
        return this.#publicRoute(route);
      }
      case "navigate": {
        const route = this.#requireRoute(payload.routeId);
        await this.#navigate(route, this.#validateUrl(payload.url));
        return this.#publicRoute(route);
      }
      case "back":
      case "forward":
      case "reload": {
        const route = this.#requireRoute(payload.routeId);
        const contents = (await this.#ensureView(route)).webContents;
        const stopped = this.#waitForStop(contents);
        if (
          command.command === "back" &&
          contents.navigationHistory.canGoBack()
        ) {
          await contents.navigationHistory.goBack();
        } else if (
          command.command === "forward" &&
          contents.navigationHistory.canGoForward()
        ) {
          await contents.navigationHistory.goForward();
        } else if (command.command === "reload") {
          contents.reload();
        }
        await stopped;
        return this.#publicRoute(route);
      }
      case "resize":
        return this.#surfaceBounds({ ...payload, x: 0, y: 0 });
      case "click":
        return this.#queryAction(payload.routeId, payload.selector, "click");
      case "fill":
        return this.#fill(payload.routeId, payload.selector, payload.value);
      case "select":
        return this.#select(payload.routeId, payload.selector, payload.value);
      case "press": {
        const contents = (
          await this.#ensureView(this.#requireRoute(payload.routeId))
        ).webContents;
        contents.sendInputEvent({ type: "keyDown", keyCode: payload.key });
        contents.sendInputEvent({ type: "keyUp", keyCode: payload.key });
        return { pressed: true };
      }
      case "scroll": {
        const contents = (
          await this.#ensureView(this.#requireRoute(payload.routeId))
        ).webContents;
        contents.sendInputEvent({
          type: "mouseWheel",
          x: 1,
          y: 1,
          deltaX: payload.x,
          deltaY: payload.y,
        });
        return { scrolled: true };
      }
      case "hover":
        return this.#queryAction(payload.routeId, payload.selector, "hover");
      case "evaluate":
        return this.#evaluate(payload.routeId, payload.expression);
      case "domSnapshot":
        return this.#domSnapshot(payload.routeId, requestId);
      case "visualSnapshot":
        return this.#visualSnapshot(payload.routeId);
      case "developerInspect":
        return this.#developerState(payload.routeId);
      case "pointer":
        return this.#pointer(payload);
      case "key":
        return this.#key(payload);
      case "closeRoute":
        return this.#closeRoute(payload.routeId);
      default:
        throw new Error(`未知浏览器命令: ${command.command}`);
    }
  }

  async #action(action, payload) {
    const routeId = payload.routeId ?? this.#activeRouteId;
    switch (action) {
      case "navigate":
        return this.#command({ command: "navigate", payload });
      case "back":
      case "forward":
      case "reload":
        return this.#command({ command: action, payload });
      case "captureVisualSnapshot":
        return this.#visualSnapshot(routeId);
      case "inspectDeveloperState":
        return this.#developerState(routeId);
      case "beginAnnotation":
        return { active: true, routeId };
      case "cancelAnnotation":
        return { active: false, routeId };
      case "sessionStatus": {
        const contents = (await this.#ensureView(this.#requireRoute(routeId)))
          .webContents;
        const cookies = await contents.session.cookies.get({});
        return {
          routeId,
          persistent: true,
          cookieCount: cookies.length,
          partition: this.#partition,
        };
      }
      case "openSignIn": {
        const provider = String(payload.providerId ?? "").toLowerCase();
        const urls = {
          google: "https://accounts.google.com/",
          github: "https://github.com/login",
          microsoft: "https://login.microsoftonline.com/",
        };
        const url = urls[provider] ?? "https://accounts.google.com/";
        const route = this.#requireRoute(routeId);
        await this.#navigate(route, url);
        return { opened: true, providerId: provider || "google", routeId, url };
      }
      case "clearSession":
      case "clearAllData":
      case "clearSettingsData": {
        const contents = routeId
          ? (await this.#ensureView(this.#requireRoute(routeId))).webContents
          : this.webContents();
        await contents?.session.clearStorageData();
        return { cleared: true, routeId: routeId ?? null };
      }
      case "fillSavedCredential":
        return { filled: false, routeId, reason: "credential-store-empty" };
      case "listImportProfiles":
        return { profiles: await this.#listImportProfiles() };
      case "importProfile":
        return this.#importProfile(payload);
      case "attach":
        return { attached: false, routeId, reason: "native-view-owned" };
      case "activateTab": {
        const route = this.#requireRoute(routeId);
        route.threadId = payload.threadId ?? route.threadId;
        this.#activate(route);
        if (route.visible) await this.#ensureView(route);
        this.#publishState();
        return this.#publicRoute(route);
      }
      case "detachTab": {
        const route = this.#requireRoute(routeId);
        this.#suspend(route);
        return { detached: true, routeId };
      }
      default:
        throw new Error(`未知浏览器动作: ${action}`);
    }
  }

  async #listImportProfiles() {
    const roots = this.#browserProfileRoots();
    const profiles = [];
    for (const root of roots) {
      let entries;
      try {
        entries = await readdir(root.path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !this.#isProfileDirectory(entry.name)) {
          continue;
        }
        const profilePath = path.join(root.path, entry.name);
        let lastUsedAt = null;
        try {
          lastUsedAt = (await stat(profilePath)).mtime.toISOString();
        } catch {
          // A profile can disappear while Chrome is closing; omit its optional
          // timestamp but keep the profile selectable.
        }
        profiles.push({
          id: crypto.createHash("sha256").update(profilePath).digest("hex"),
          name: entry.name,
          browser: root.browser,
          path: profilePath,
          lastUsedAt,
        });
      }
    }
    return profiles.sort((left, right) =>
      `${left.browser}/${left.name}`.localeCompare(
        `${right.browser}/${right.name}`,
      ),
    );
  }

  async #importProfile(payload) {
    const profiles = await this.#listImportProfiles();
    const requestedId =
      typeof payload.profileId === "string" ? payload.profileId : "";
    const requestedPath = typeof payload.path === "string" ? payload.path : "";
    const profile = profiles.find(
      (candidate) =>
        (requestedId && candidate.id === requestedId) ||
        (requestedPath && candidate.path === requestedPath),
    );
    if (!profile) {
      throw new Error("找不到可导入的浏览器 Profile；请刷新列表后重试");
    }
    const target = path.join(
      path.dirname(this.#profilePath),
      "onpeople-browser-imports",
      profile.id,
    );
    try {
      await stat(target);
      throw new Error("这个浏览器 Profile 已经导入过了");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(target, { recursive: true });
    const report = { cookies: 0, storageFiles: 0, credentials: 0, skipped: 0 };
    try {
      await this.#copyProfileTree(
        profile.path,
        target,
        {
          includePasswords: payload.includePasswords === true,
          includeCookies: payload.includeCookies !== false,
          includeHistory: payload.includeHistory !== false,
        },
        report,
      );
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return {
      imported: true,
      profileId: profile.id,
      browser: profile.browser,
      source: profile.path,
      target,
      ...report,
      // Electron keeps the current partition open. The imported files are
      // staged safely and are merged before the next browser host starts.
      requiresRestart: true,
    };
  }

  #browserProfileRoots() {
    const home = os.homedir();
    if (process.platform === "darwin") {
      const base = path.join(home, "Library", "Application Support");
      return [
        { browser: "Google Chrome", path: path.join(base, "Google", "Chrome") },
        { browser: "Chromium", path: path.join(base, "Chromium") },
        { browser: "Microsoft Edge", path: path.join(base, "Microsoft Edge") },
      ];
    }
    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA;
      if (!local) return [];
      return [
        {
          browser: "Google Chrome",
          path: path.join(local, "Google", "Chrome", "User Data"),
        },
        {
          browser: "Microsoft Edge",
          path: path.join(local, "Microsoft", "Edge", "User Data"),
        },
      ];
    }
    const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return [
      { browser: "Google Chrome", path: path.join(config, "google-chrome") },
      { browser: "Chromium", path: path.join(config, "chromium") },
      { browser: "Microsoft Edge", path: path.join(config, "microsoft-edge") },
    ];
  }

  #isProfileDirectory(name) {
    return name === "Default" || /^Profile \\d+$/.test(name);
  }

  async #copyProfileTree(source, target, options, report, relative = "") {
    const entries = await readdir(path.join(source, relative), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        report.skipped += 1;
        continue;
      }
      const childRelative = path.join(relative, entry.name);
      const basename = entry.name;
      if (
        [
          "Cache",
          "Code Cache",
          "GPUCache",
          "DawnGraphiteCache",
          "DawnWebGPUCache",
          "GrShaderCache",
        ].includes(basename)
      ) {
        report.skipped += 1;
        continue;
      }
      if (
        !options.includePasswords &&
        ["Login Data", "Login Data For Account", "Web Data"].includes(basename)
      ) {
        report.skipped += 1;
        continue;
      }
      if (
        !options.includeCookies &&
        ["Cookies", "Network"].includes(basename)
      ) {
        report.skipped += 1;
        continue;
      }
      if (
        !options.includeHistory &&
        ["History", "Visited Links"].includes(basename)
      ) {
        report.skipped += 1;
        continue;
      }
      const destination = path.join(target, childRelative);
      if (entry.isDirectory()) {
        await mkdir(destination, { recursive: true });
        await this.#copyProfileTree(
          source,
          target,
          options,
          report,
          childRelative,
        );
      } else if (entry.isFile()) {
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(path.join(source, childRelative), destination);
        report.storageFiles += 1;
        if (basename === "Cookies") report.cookies += 1;
        if (
          options.includePasswords &&
          ["Login Data", "Login Data For Account", "Web Data"].includes(
            basename,
          )
        )
          report.credentials += 1;
      }
    }
  }

  async #surfaceBounds(payload) {
    const route = this.#routes.get(payload.routeId);
    if (!route) return { updated: false, routeId: payload.routeId };
    route.bounds = clampBounds(payload);
    route.visible = payload.visible === true;
    if (route.visible && route.routeId === this.#activeRouteId) {
      const view = await this.#ensureView(route);
      view.setBounds(route.bounds);
      view.setVisible(true);
      view.webContents.setAudioMuted(false);
      if (
        !route.crashed &&
        !route.loading &&
        (route.phase === "creating" || route.phase === "loading")
      ) {
        route.phase = "ready";
      }
      this.#cancelDestroy(route);
    } else {
      this.#suspend(route);
    }
    return {
      updated: true,
      routeId: route.routeId,
      visible: route.visible,
      live: Boolean(route.view),
    };
  }

  #upsertRoute(routeId, threadId = "main", url = "about:blank") {
    if (!routeId) throw new Error("routeId 不能为空");
    let route = this.#routes.get(routeId);
    if (!route) {
      route = routeState(routeId, threadId || "main", url);
      this.#routes.set(routeId, route);
    } else {
      route.threadId = threadId || route.threadId;
      route.url = url || route.url;
    }
    return route;
  }

  #requireRoute(routeId) {
    const route = this.#routes.get(routeId);
    if (!route) throw new Error(`浏览器标签页不存在: ${routeId}`);
    return route;
  }

  #activate(route) {
    for (const candidate of this.#routes.values()) {
      if (candidate.routeId !== route.routeId) this.#suspend(candidate);
    }
    this.#activeRouteId = route.routeId;
  }

  async #navigate(route, url) {
    this.#activate(route);
    route.url = url;
    route.crashed = false;
    route.phase = "loading";
    route.lastError = null;
    route.loading = true;
    const contents = (await this.#ensureView(route)).webContents;
    if (contents.getURL() !== url) {
      await withTimeout(
        contents.loadURL(url),
        BROWSER_LOAD_TIMEOUT_MS,
        "浏览器页面加载超时，请重新加载页面后重试",
        () => {
          contents.stop();
          route.loading = false;
          route.phase = "unknown";
          route.lastError = "页面加载超时";
          this.#publishState();
        },
      );
    }
    this.#syncRoute(route);
    this.#publishState();
  }

  async #ensureView(route) {
    this.#cancelDestroy(route);
    if (route.view && !route.view.webContents.isDestroyed()) return route.view;
    if (this.#closed || this.#window.isDestroyed()) {
      throw new Error("浏览器窗口已关闭");
    }
    const view = new this.#WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: this.#partition,
      },
    });
    route.view = view;
    route.phase = route.url === "about:blank" ? "ready" : "loading";
    route.lastError = null;
    route.generation += 1;
    this.#window.contentView.addChildView(view);
    view.setBackgroundColor("#ffffff");
    if (route.bounds) view.setBounds(route.bounds);
    view.setVisible(route.visible && route.routeId === this.#activeRouteId);
    const contents = view.webContents;
    contents.setBackgroundThrottling(true);
    contents.setWindowOpenHandler(({ url }) => {
      if (!isSafeBrowserUrl(url)) return { action: "deny" };
      const popupRoute = this.#upsertRoute(
        `route-${crypto.randomUUID().replaceAll("-", "")}`,
        route.threadId,
        url,
      );
      this.#activate(popupRoute);
      void this.#navigate(popupRoute, url).catch((error) => {
        if (!this.#closed && this.#routes.has(popupRoute.routeId)) {
          this.#emit("browser:event", {
            kind: "popup-load-failed",
            routeId: popupRoute.routeId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
      this.#emit("browser:new-tab-requested", {
        routeId: popupRoute.routeId,
        threadId: popupRoute.threadId,
        url,
      });
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isSafeBrowserUrl(url)) event.preventDefault();
    });
    contents.on("did-start-loading", () => {
      route.loading = true;
      route.phase = "loading";
      route.lastError = null;
      route.crashed = false;
      this.#publishState();
    });
    contents.on("did-stop-loading", () => {
      this.#syncRoute(route);
      if (!route.crashed) route.phase = "ready";
      this.#publishState();
    });
    contents.on("did-navigate", (_event, url) => {
      route.url = url;
      this.#publishState();
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      route.url = url;
      this.#publishState();
    });
    contents.on("page-title-updated", (_event, title) => {
      route.title = title || "新标签页";
      this.#publishState();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      route.faviconUrl = favicons.find(isSafeBrowserUrl) ?? null;
      this.#publishState();
    });
    contents.on("console-message", (_event, level, message, line, sourceId) => {
      pushBounded(route.console, {
        level: Number(level),
        message: String(message),
        line: Number(line) || 0,
        source: typeof sourceId === "string" ? sourceId : "",
      });
    });
    contents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit" || this.#closed) return;
      this.#crashCount += 1;
      route.crashed = true;
      route.loading = false;
      route.phase = "crashed";
      route.lastError = `渲染进程退出: ${details.reason ?? "unknown"}`;
      const recoveryUrl = route.url;
      const bounds = route.bounds;
      const visible = route.visible;
      this.#destroyView(route);
      route.bounds = bounds;
      route.visible = visible;
      this.#publishState();
      setTimeout(async () => {
        if (this.#closed || !this.#routes.has(route.routeId)) return;
        try {
          const recovered = await this.#ensureView(route);
          if (recoveryUrl !== "about:blank") {
            await withTimeout(
              recovered.webContents.loadURL(recoveryUrl),
              BROWSER_LOAD_TIMEOUT_MS,
              "浏览器页面恢复超时，请重新加载页面后重试",
              () => recovered.webContents.stop(),
            );
          }
          route.crashed = false;
          route.phase = "ready";
          route.lastError = null;
          this.#recoveryCount += 1;
          this.#publishState();
        } catch (error) {
          route.crashed = true;
          route.phase = "crashed";
          route.lastError =
            error instanceof Error ? error.message : String(error);
          this.#emit("browser:event", {
            kind: "recovery-failed",
            routeId: route.routeId,
            message: error instanceof Error ? error.message : String(error),
          });
          this.#publishState();
        }
      }, 250);
    });
    if (route.url !== "about:blank") {
      await withTimeout(
        contents.loadURL(route.url),
        BROWSER_LOAD_TIMEOUT_MS,
        "浏览器页面加载超时，请重新加载页面后重试",
        () => {
          contents.stop();
          route.loading = false;
          route.phase = "unknown";
          route.lastError = "页面加载超时";
          this.#publishState();
        },
      );
    }
    return view;
  }

  #syncRoute(route) {
    const contents = route.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    route.loading = contents.isLoading();
    route.url = contents.getURL() || route.url || "about:blank";
    route.title = contents.getTitle() || "新标签页";
    route.canGoBack = contents.navigationHistory.canGoBack();
    route.canGoForward = contents.navigationHistory.canGoForward();
    if (route.crashed) route.phase = "crashed";
    else if (route.loading) route.phase = "loading";
    else if (route.phase === "loading" || route.phase === "creating") {
      route.phase = "ready";
    }
  }

  #waitForStop(contents) {
    if (!contents.isLoading()) return Promise.resolve();
    return withTimeout(
      new Promise((resolve) => {
        contents.once("did-stop-loading", resolve);
      }),
      BROWSER_LOAD_TIMEOUT_MS,
      "浏览器页面重新加载超时，请重试",
      () => contents.stop(),
    );
  }

  #suspend(route) {
    route.visible = false;
    if (!route.crashed) route.phase = "suspended";
    if (route.view && !route.view.webContents.isDestroyed()) {
      route.view.setVisible(false);
      route.view.webContents.setAudioMuted(true);
    }
    this.#scheduleDestroy(route);
  }

  #scheduleDestroy(route) {
    this.#cancelDestroy(route);
    route.destroyTimer = setTimeout(() => {
      route.destroyTimer = null;
      if (!route.visible) {
        this.#destroyView(route);
        this.#publishState();
      }
    }, this.#idleDestroyMs);
  }

  #cancelDestroy(route) {
    if (route.destroyTimer) clearTimeout(route.destroyTimer);
    route.destroyTimer = null;
  }

  #destroyView(route) {
    this.#cancelDestroy(route);
    const view = route.view;
    route.view = null;
    if (!route.crashed) route.phase = route.visible ? "unknown" : "suspended";
    if (!view) return;
    if (!this.#window.isDestroyed()) {
      try {
        this.#window.contentView.removeChildView(view);
      } catch {
        // The view may already have been removed with the parent window.
      }
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.#destroyCount += 1;
  }

  #closeRoute(routeId) {
    const route = this.#requireRoute(routeId);
    this.#destroyView(route);
    this.#routes.delete(routeId);
    if (this.#activeRouteId === routeId) {
      this.#activeRouteId = [...this.#routes.keys()].at(-1) ?? null;
    }
    this.#publishState();
    return { closed: true, routeId };
  }

  #publicRoute(route) {
    this.#syncRoute(route);
    return {
      routeId: route.routeId,
      threadId: route.threadId,
      url: route.url,
      title: route.title,
      faviconUrl: route.faviconUrl,
      loading: route.loading,
      canGoBack: route.canGoBack,
      canGoForward: route.canGoForward,
      crashed: route.crashed,
      phase: route.phase,
      lastError: route.lastError,
    };
  }

  #publishState() {
    this.#emit("browser:state", this.state());
  }

  #validateUrl(url) {
    const value = String(url ?? "about:blank");
    if (!isSafeBrowserUrl(value)) {
      throw new Error("只允许 HTTP、HTTPS 或 about URL");
    }
    return value;
  }

  async #evaluate(routeId, expression) {
    const contents = (await this.#ensureView(this.#requireRoute(routeId)))
      .webContents;
    return withTimeout(
      contents.executeJavaScript(String(expression), true),
      BROWSER_INSPECT_TIMEOUT_MS,
      "浏览器页面响应超时，请重新加载页面后重试",
    );
  }

  async #queryAction(routeId, selector, action) {
    const script =
      action === "click"
        ? `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`
        : `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return true; })()`;
    return {
      [action === "click" ? "clicked" : "hovered"]: await this.#evaluate(
        routeId,
        script,
      ),
    };
  }

  async #fill(routeId, selector, value) {
    const filled = await this.#evaluate(
      routeId,
      `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.focus(); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
    );
    return { filled };
  }

  async #select(routeId, selector, value) {
    const selected = await this.#evaluate(
      routeId,
      `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
    );
    return { selected };
  }

  async #domSnapshot(routeId, requestId = null) {
    const visibleDom = await this.#evaluate(
      routeId,
      `(() => {
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const name = (node) => String(node.getAttribute("aria-label") || node.getAttribute("alt") || node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);
        const result = [];
        let index = 0;
        for (const node of document.querySelectorAll("body *")) {
          if (!visible(node)) continue;
          const rect = node.getBoundingClientRect();
          const role = node.getAttribute("role") || node.tagName.toLowerCase();
          const text = name(node);
          if (!text && !["input", "textarea", "select", "button", "a"].includes(node.tagName.toLowerCase())) continue;
          result.push({ nodeId: "n" + (++index), tag: node.tagName.toLowerCase(), role, name: text, value: node.value ?? null, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } });
          if (result.length >= 500) break;
        }
        return { url: location.href, title: document.title, nodes: result };
      })()`,
    );
    return {
      routeId,
      requestId,
      // Keep html for existing callers, while nodes is the authoritative
      // interaction-oriented snapshot (the same split Codex exposes through
      // DOM/Playwright and DOM-CUA surfaces).
      html: await this.#evaluate(routeId, "document.documentElement.outerHTML"),
      visibleDom,
    };
  }

  async #visualSnapshot(routeId) {
    const contents = (await this.#ensureView(this.#requireRoute(routeId)))
      .webContents;
    const image = await withTimeout(
      contents.capturePage(),
      BROWSER_INSPECT_TIMEOUT_MS,
      "浏览器视觉快照超时，请重新加载页面后重试",
    );
    const size = image.getSize();
    return {
      routeId,
      imageBase64: image.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
    };
  }

  async #developerState(routeId) {
    const route = this.#requireRoute(routeId);
    const contents = (await this.#ensureView(route)).webContents;
    let network = [];
    try {
      network = await withTimeout(
        contents.executeJavaScript(
          `performance.getEntriesByType("resource").slice(-100).map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          duration: Math.round(entry.duration * 100) / 100,
          transferSize: entry.transferSize || 0,
          encodedBodySize: entry.encodedBodySize || 0,
          decodedBodySize: entry.decodedBodySize || 0
          }))`,
          true,
        ),
        BROWSER_INSPECT_TIMEOUT_MS,
        "开发检查超时，请重新加载页面后重试",
      );
      if (!Array.isArray(network)) network = [];
    } catch {
      network = [];
    }
    return {
      routeId,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      processId: contents.getOSProcessId(),
      generation: route.generation,
      partition: this.#partition,
      console: route.console,
      network,
    };
  }

  async #pointer(payload) {
    const contents = (
      await this.#ensureView(this.#requireRoute(payload.routeId))
    ).webContents;
    const kind = String(payload.kind ?? "move");
    const type = kind.includes("wheel")
      ? "mouseWheel"
      : kind.includes("down")
        ? "mouseDown"
        : kind.includes("up")
          ? "mouseUp"
          : "mouseMove";
    contents.sendInputEvent({
      type,
      x: Math.round(payload.x ?? 0),
      y: Math.round(payload.y ?? 0),
      deltaX: payload.deltaX ?? 0,
      deltaY: payload.deltaY ?? 0,
      button: ["left", "middle", "right"][payload.button] ?? "left",
      clickCount: Math.max(1, payload.clickCount ?? 1),
    });
    return { sent: true };
  }

  async #key(payload) {
    const contents = (
      await this.#ensureView(this.#requireRoute(payload.routeId))
    ).webContents;
    const type = String(payload.kind).includes("up") ? "keyUp" : "keyDown";
    contents.sendInputEvent({
      type,
      keyCode: payload.character || String(payload.keyCode ?? ""),
    });
    return { sent: true };
  }
}

export function browserProfilePath(userDataPath) {
  return path.join(userDataPath, "Partitions", "onpeople-browser");
}
