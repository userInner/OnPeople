import crypto from "node:crypto";
import path from "node:path";

const DEFAULT_IDLE_DESTROY_MS = 60_000;
const BROWSER_INSPECT_TIMEOUT_MS = 8_000;

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

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

  async handle(method, params = {}) {
    switch (method) {
      case "browser.state":
        return this.state();
      case "browser.restart":
        return this.restart();
      case "browser.command":
        return this.#command(params.command);
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

  async #command(command) {
    if (!command || typeof command !== "object") {
      throw new Error("browser.command 缺少命令");
    }
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
        if (
          command.command === "back" &&
          contents.navigationHistory.canGoBack()
        ) {
          contents.navigationHistory.goBack();
        } else if (
          command.command === "forward" &&
          contents.navigationHistory.canGoForward()
        ) {
          contents.navigationHistory.goForward();
        } else if (command.command === "reload") {
          contents.reload();
        }
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
        return this.#domSnapshot(payload.routeId);
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
        return { profiles: [] };
      case "importProfile":
        return { imported: false, routeId, reason: "profile-not-selected" };
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
    const contents = (await this.#ensureView(route)).webContents;
    if (contents.getURL() !== url) await contents.loadURL(url);
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
      route.crashed = false;
      this.#publishState();
    });
    contents.on("did-stop-loading", () => {
      this.#syncRoute(route);
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
            await recovered.webContents.loadURL(recoveryUrl);
          }
          route.crashed = false;
          this.#recoveryCount += 1;
          this.#publishState();
        } catch (error) {
          route.crashed = true;
          this.#emit("browser:event", {
            kind: "recovery-failed",
            routeId: route.routeId,
            message: error instanceof Error ? error.message : String(error),
          });
          this.#publishState();
        }
      }, 250);
    });
    if (route.url !== "about:blank") await contents.loadURL(route.url);
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
  }

  #suspend(route) {
    route.visible = false;
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

  async #domSnapshot(routeId) {
    return {
      routeId,
      html: await this.#evaluate(routeId, "document.documentElement.outerHTML"),
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
