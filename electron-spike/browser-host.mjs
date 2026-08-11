import crypto from "node:crypto";
import path from "node:path";

import {
  app,
  clipboard,
  nativeImage,
  session,
  shell,
  webContents as electronWebContents,
} from "electron";

export const BROWSER_PARTITION = "persist:onpeople-browser";

const SAFE_PROTOCOLS = new Set(["http:", "https:", "about:"]);
const MAX_DOWNLOAD_HISTORY = 100;
const MAX_DOM_NODES = 2_000;

export function isSafeGuestUrl(value) {
  try {
    const url = new URL(String(value));
    if (!SAFE_PROTOCOLS.has(url.protocol)) return false;
    return url.protocol !== "about:" || url.href === "about:blank";
  } catch {
    return false;
  }
}

export function normalizeBrowserAddress(value) {
  const input = String(value ?? "").trim();
  if (!input) return "about:blank";
  if (/^(?:https?:\/\/|about:blank$)/i.test(input)) return input;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(input)) {
    return `https://${input}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function publicDownload(download) {
  return {
    id: download.id,
    tabId: download.tabId,
    filename: download.filename,
    url: download.url,
    path: download.path,
    state: download.state,
    receivedBytes: download.receivedBytes,
    totalBytes: download.totalBytes,
    startedAt: download.startedAt,
    updatedAt: download.updatedAt,
  };
}

function uniqueDownloadPath(directory, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension) || "download";
  return path.join(
    directory,
    `${stem}-${crypto.randomUUID().slice(0, 8)}${extension}`,
  );
}

function navigationState(guest) {
  const history = guest.navigationHistory;
  return {
    canGoBack: history?.canGoBack?.() ?? guest.canGoBack(),
    canGoForward: history?.canGoForward?.() ?? guest.canGoForward(),
  };
}

const DOM_SNAPSHOT_SCRIPT = `(() => {
  const limit = ${MAX_DOM_NODES};
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const selector = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current !== document.body && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };
  const nodes = [];
  const candidates = document.querySelectorAll("a,button,input,textarea,select,[role],[contenteditable=true],h1,h2,h3,p,li,img");
  for (const element of candidates) {
    if (nodes.length >= limit || !visible(element)) continue;
    const rect = element.getBoundingClientRect();
    const text = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("alt") || "")
      .replace(/\\s+/g, " ").trim().slice(0, 500);
    nodes.push({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: element.getAttribute("aria-label") || text,
      text,
      selector: selector(element),
      href: element instanceof HTMLAnchorElement ? element.href : null,
      disabled: "disabled" in element ? Boolean(element.disabled) : false,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }
  return {
    url: location.href,
    title: document.title,
    language: document.documentElement.lang || null,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    selection: getSelection()?.toString().slice(0, 2000) || "",
    nodes,
  };
})()`;

export class ElectronBrowserHost {
  #window;
  #emit;
  #preloadPath;
  #session;
  #tabByWebContents = new Map();
  #webContentsByTab = new Map();
  #downloads = [];
  #crashCount = 0;
  #recoveryCount = 0;
  #activeTabId = null;
  #disposers = [];
  #started = false;

  constructor({ window, emit, preloadPath }) {
    this.#window = window;
    this.#emit = emit;
    this.#preloadPath = preloadPath;
    this.#session = session.fromPartition(BROWSER_PARTITION, { cache: true });
  }

  start() {
    if (this.#started) return;
    this.#started = true;
    this.#configureSession();

    const willAttach = (event, webPreferences, params) => {
      if (
        params.partition !== BROWSER_PARTITION ||
        !isSafeGuestUrl(params.src || "about:blank")
      ) {
        event.preventDefault();
        return;
      }
      Object.assign(webPreferences, {
        preload: this.#preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        plugins: false,
      });
    };
    const didAttach = (_event, guest) => this.#attachGuest(guest);
    this.#window.webContents.on("will-attach-webview", willAttach);
    this.#window.webContents.on("did-attach-webview", didAttach);
    this.#disposers.push(() => {
      this.#window.webContents.removeListener(
        "will-attach-webview",
        willAttach,
      );
      this.#window.webContents.removeListener("did-attach-webview", didAttach);
    });
  }

  close() {
    for (const dispose of this.#disposers.splice(0)) dispose();
    this.#tabByWebContents.clear();
    this.#webContentsByTab.clear();
    this.#started = false;
  }

  state() {
    return {
      ready: this.#started,
      partition: BROWSER_PARTITION,
      attachedTabs: [...this.#webContentsByTab.keys()],
      attachedPages: [...this.#webContentsByTab].map(
        ([tabId, webContentsId]) => ({
          tabId,
          webContentsId,
          url:
            electronWebContents.fromId(webContentsId)?.getURL() ??
            "about:blank",
        }),
      ),
      activeTabId: this.#activeTabId,
      downloads: this.#downloads.map(publicDownload),
      crashCount: this.#crashCount,
      recoveryCount: this.#recoveryCount,
    };
  }

  pageEvent(webContentsId, payload) {
    const tabId = this.#tabByWebContents.get(webContentsId) ?? null;
    this.#emit("browser:event", {
      kind: "page-event",
      tabId,
      webContentsId,
      payload,
    });
  }

  async handle(command, payload = {}) {
    switch (command) {
      case "state":
        return this.state();
      case "register":
        return this.#register(payload);
      case "unregister":
        return this.#unregister(payload.tabId);
      case "activate":
        return this.#activate(payload.tabId);
      case "navigate":
        return this.#navigate(payload.tabId, payload.url);
      case "back":
        return this.#go(payload.tabId, "back");
      case "forward":
        return this.#go(payload.tabId, "forward");
      case "reload":
        return this.#reload(payload.tabId);
      case "stop":
        return this.#stop(payload.tabId);
      case "dom-snapshot":
        return this.#domSnapshot(payload.tabId);
      case "visual-snapshot":
        return this.#visualSnapshot(payload.tabId);
      case "copy-visual-snapshot":
        return this.#copyVisualSnapshot(payload.tabId);
      case "developer-tools":
        return this.#developerTools(payload.tabId);
      case "session-status":
        return this.#sessionStatus(payload.tabId);
      case "clear-site-data":
        return this.#clearSiteData(payload.tabId);
      case "clear-all-data":
        return this.#clearAllData();
      case "downloads":
        return this.#downloads.map(publicDownload);
      case "show-download":
        return this.#showDownload(payload.id);
      case "open-external":
        return this.#openExternal(payload.tabId);
      case "zoom":
        return this.#zoom(payload.tabId, payload.factor);
      case "recover":
        return this.#recover(payload.tabId);
      default:
        throw new Error(`不支持的浏览器操作: ${command}`);
    }
  }

  #configureSession() {
    this.#session.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        callback(
          permission === "clipboard-sanitized-write" ||
            permission === "fullscreen",
        );
      },
    );
    const willDownload = (_event, item, webContents) => {
      const now = Date.now();
      const tabId = this.#tabByWebContents.get(webContents.id) ?? null;
      const download = {
        id: crypto.randomUUID(),
        tabId,
        filename: item.getFilename(),
        url: item.getURL(),
        path: uniqueDownloadPath(
          process.env.ONPEOPLE_BROWSER_DOWNLOAD_DIR || app.getPath("downloads"),
          item.getFilename(),
        ),
        state: "progressing",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        startedAt: now,
        updatedAt: now,
      };
      item.setSavePath(download.path);
      this.#downloads.unshift(download);
      if (this.#downloads.length > MAX_DOWNLOAD_HISTORY) this.#downloads.pop();
      this.#publishDownload("started", download);
      item.on("updated", (_event, state) => {
        download.state = state;
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        download.updatedAt = Date.now();
        this.#publishDownload("updated", download);
      });
      item.once("done", (_event, state) => {
        download.state = state;
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        download.updatedAt = Date.now();
        this.#publishDownload("done", download);
      });
    };
    this.#session.on("will-download", willDownload);
    this.#disposers.push(() =>
      this.#session.removeListener("will-download", willDownload),
    );
  }

  #attachGuest(guest) {
    const sendState = (kind, extra = {}) => {
      const tabId = this.#tabByWebContents.get(guest.id) ?? null;
      this.#emit("browser:event", {
        kind,
        tabId,
        webContentsId: guest.id,
        url: guest.isDestroyed() ? "" : guest.getURL(),
        title: guest.isDestroyed() ? "" : guest.getTitle(),
        loading: guest.isDestroyed() ? false : guest.isLoading(),
        ...(guest.isDestroyed()
          ? { canGoBack: false, canGoForward: false }
          : navigationState(guest)),
        ...extra,
      });
    };

    guest.setWindowOpenHandler(({ url, disposition }) => {
      if (isSafeGuestUrl(url)) {
        sendState("new-tab", { requestedUrl: url, disposition });
      }
      return { action: "deny" };
    });
    guest.on("will-navigate", (event, url) => {
      if (!isSafeGuestUrl(url)) event.preventDefault();
    });
    guest.on("will-redirect", (event, url) => {
      if (!isSafeGuestUrl(url)) event.preventDefault();
    });
    guest.on("did-start-loading", () => sendState("loading"));
    guest.on("did-stop-loading", () => sendState("ready"));
    guest.on("did-navigate", (_event, url) => sendState("navigation", { url }));
    guest.on("did-navigate-in-page", (_event, url) =>
      sendState("navigation", { url }),
    );
    guest.on("page-title-updated", (_event, title) =>
      sendState("title", { title }),
    );
    guest.on("page-favicon-updated", (_event, favicons) =>
      sendState("favicon", { faviconUrl: favicons[0] ?? null }),
    );
    guest.on("unresponsive", () => sendState("unresponsive"));
    guest.on("responsive", () => sendState("responsive"));
    guest.on("render-process-gone", (_event, details) => {
      this.#crashCount += 1;
      sendState("crashed", {
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });
    guest.once("destroyed", () => {
      const tabId = this.#tabByWebContents.get(guest.id);
      this.#tabByWebContents.delete(guest.id);
      if (tabId) this.#webContentsByTab.delete(tabId);
      sendState("destroyed", { tabId: tabId ?? null });
    });
  }

  #register(payload) {
    const tabId = String(payload.tabId ?? "").trim();
    const webContentsId = Number(payload.webContentsId);
    if (!tabId || !Number.isInteger(webContentsId)) {
      throw new Error("浏览器标签注册信息不完整");
    }
    const guest = electronWebContents.fromId(webContentsId);
    if (!guest || guest.isDestroyed() || guest.session !== this.#session) {
      throw new Error("浏览器页面尚未附加");
    }
    const previous = this.#webContentsByTab.get(tabId);
    if (previous && previous !== webContentsId)
      this.#tabByWebContents.delete(previous);
    this.#webContentsByTab.set(tabId, webContentsId);
    this.#tabByWebContents.set(webContentsId, tabId);
    return this.#snapshot(tabId, guest);
  }

  #unregister(tabId) {
    const id = this.#webContentsByTab.get(String(tabId));
    if (id == null) return { removed: false };
    this.#webContentsByTab.delete(String(tabId));
    this.#tabByWebContents.delete(id);
    return { removed: true };
  }

  #activate(tabId) {
    const activeTabId = String(tabId ?? "");
    this.#activeTabId = activeTabId || null;
    for (const [residentTabId, webContentsId] of this.#webContentsByTab) {
      const guest = electronWebContents.fromId(webContentsId);
      if (!guest || guest.isDestroyed()) continue;
      const active = residentTabId === activeTabId;
      guest.setAudioMuted(!active);
      guest.setBackgroundThrottling(!active);
    }
    return { activeTabId };
  }

  #guest(tabId) {
    const id = this.#webContentsByTab.get(String(tabId));
    const guest = id == null ? null : electronWebContents.fromId(id);
    if (!guest || guest.isDestroyed()) throw new Error("浏览器页面暂不可用");
    return guest;
  }

  #snapshot(tabId, guest = this.#guest(tabId)) {
    return {
      tabId: String(tabId),
      webContentsId: guest.id,
      url: guest.getURL(),
      title: guest.getTitle(),
      loading: guest.isLoading(),
      ...navigationState(guest),
      crashed: false,
      zoomFactor: guest.getZoomFactor(),
    };
  }

  async #navigate(tabId, value) {
    const guest = this.#guest(tabId);
    const url = normalizeBrowserAddress(value);
    if (!isSafeGuestUrl(url)) throw new Error("只允许访问 HTTP、HTTPS 页面");
    await guest.loadURL(url);
    return this.#snapshot(tabId, guest);
  }

  async #go(tabId, direction) {
    const guest = this.#guest(tabId);
    const history = guest.navigationHistory;
    if (direction === "back" && history.canGoBack()) history.goBack();
    if (direction === "forward" && history.canGoForward()) history.goForward();
    return this.#snapshot(tabId, guest);
  }

  #reload(tabId) {
    const guest = this.#guest(tabId);
    guest.reload();
    return this.#snapshot(tabId, guest);
  }

  #stop(tabId) {
    const guest = this.#guest(tabId);
    guest.stop();
    return this.#snapshot(tabId, guest);
  }

  async #domSnapshot(tabId) {
    const guest = this.#guest(tabId);
    try {
      const response = await this.#sendDebuggerCommand(
        guest,
        "Runtime.evaluate",
        {
          expression: DOM_SNAPSHOT_SCRIPT,
          returnByValue: true,
          awaitPromise: true,
        },
      );
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.text || "页面快照执行失败");
      }
      return response.result?.value ?? null;
    } catch {
      return guest.executeJavaScript(DOM_SNAPSHOT_SCRIPT, true);
    }
  }

  async #visualSnapshot(tabId) {
    const guest = this.#guest(tabId);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.#sendDebuggerCommand(
          guest,
          "Page.captureScreenshot",
          {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: false,
          },
        );
        if (!response.data) throw new Error("页面截图为空");
        const image = nativeImage.createFromBuffer(
          Buffer.from(response.data, "base64"),
        );
        if (image.isEmpty()) throw new Error("页面截图为空");
        return {
          tabId: String(tabId),
          width: image.getSize().width,
          height: image.getSize().height,
          dataUrl: `data:image/png;base64,${response.data}`,
        };
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
    }
    try {
      const image = await guest.capturePage();
      if (image.isEmpty()) throw new Error("页面截图为空");
      return {
        tabId: String(tabId),
        width: image.getSize().width,
        height: image.getSize().height,
        dataUrl: image.toDataURL(),
      };
    } catch (error) {
      throw new Error(
        `无法读取当前页面画面: ${error instanceof Error ? error.message : String(lastError)}`,
      );
    }
  }

  async #copyVisualSnapshot(tabId) {
    const snapshot = await this.#visualSnapshot(tabId);
    const image = nativeImage.createFromDataURL(snapshot.dataUrl);
    clipboard.writeImage(image);
    return { copied: !image.isEmpty() };
  }

  #developerTools(tabId) {
    const guest = this.#guest(tabId);
    guest.openDevTools({ mode: "detach", activate: true });
    return { opened: true };
  }

  async #sessionStatus(tabId) {
    const guest = this.#guest(tabId);
    const url = guest.getURL();
    const cookies = isSafeGuestUrl(url)
      ? await this.#session.cookies.get({ url })
      : [];
    return {
      partition: BROWSER_PARTITION,
      persistent: true,
      url,
      cookies: cookies.map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
      })),
    };
  }

  async #clearSiteData(tabId) {
    const guest = this.#guest(tabId);
    const url = new URL(guest.getURL());
    if (!isSafeGuestUrl(url.href) || url.protocol === "about:") {
      throw new Error("当前页面没有可清理的站点数据");
    }
    await this.#session.clearStorageData({ origin: url.origin });
    guest.reload();
    return { cleared: true, origin: url.origin };
  }

  async #clearAllData() {
    await Promise.all([
      this.#session.clearCache(),
      this.#session.clearStorageData(),
      this.#session.clearAuthCache(),
    ]);
    return { cleared: true };
  }

  #showDownload(id) {
    const download = this.#downloads.find((item) => item.id === id);
    if (!download?.path) return { opened: false };
    shell.showItemInFolder(download.path);
    return { opened: true, path: download.path };
  }

  async #openExternal(tabId) {
    const url = this.#guest(tabId).getURL();
    if (!isSafeGuestUrl(url) || url === "about:blank") {
      throw new Error("当前页面不能在外部浏览器打开");
    }
    await shell.openExternal(url);
    return { opened: true, url };
  }

  #zoom(tabId, value) {
    const guest = this.#guest(tabId);
    const factor = Math.min(3, Math.max(0.5, Number(value) || 1));
    guest.setZoomFactor(factor);
    return { zoomFactor: factor };
  }

  #recover(tabId) {
    const guest = this.#guest(tabId);
    this.#recoveryCount += 1;
    guest.reload();
    return this.#snapshot(tabId, guest);
  }

  async #sendDebuggerCommand(guest, method, params = {}) {
    if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
    return guest.debugger.sendCommand(method, params);
  }

  #publishDownload(kind, download) {
    this.#emit("browser:event", {
      kind: `download-${kind}`,
      download: publicDownload(download),
    });
  }
}

export function browserSnapshotToNativeImage(snapshot) {
  return nativeImage.createFromDataURL(snapshot.dataUrl);
}
