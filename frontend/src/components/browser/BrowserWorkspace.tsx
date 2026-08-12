import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  KeyRound,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  browserBridge,
  normalizeBrowserAddress,
} from "../../browser/browserBridge";
import type {
  BrowserDownload,
  BrowserTabState,
  BrowserWebviewElement,
} from "../../browser/types";
import { errorMessage } from "../../lib/errors";
import { IconButton } from "../IconButton";

const PARTITION = "persist:onpeople-browser";
const STORAGE_KEY = "onpeople.browser.tabs.v2";
const DEFAULT_TITLE = "新标签页";
const MAX_RESIDENT_TABS = 3;

type InspectorView = "dom" | "visual" | "session" | "downloads" | null;

function createTab(url = "about:blank"): BrowserTabState {
  return {
    id: crypto.randomUUID(),
    url,
    title: url === "about:blank" ? DEFAULT_TITLE : url,
    faviconUrl: null,
    loading: url !== "about:blank",
    canGoBack: false,
    canGoForward: false,
    crashed: false,
    lastActiveAt: Date.now(),
  };
}

function safeTabUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url || url === "about:blank") return "about:blank";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "about:blank";
  } catch {
    return normalizeBrowserAddress(url);
  }
}

function loadTabs(): BrowserTabState[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
      | BrowserTabState[]
      | null;
    if (!Array.isArray(value) || value.length === 0) return [createTab()];
    return value.slice(0, 12).map((tab) => ({
      ...createTab(safeTabUrl(tab.url)),
      id: tab.id || crypto.randomUUID(),
      title: tab.title || DEFAULT_TITLE,
      faviconUrl: tab.faviconUrl || null,
      loading: false,
      crashed: false,
      lastActiveAt: Number(tab.lastActiveAt) || Date.now(),
    }));
  } catch {
    return [createTab()];
  }
}

function persistTabs(tabs: BrowserTabState[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      tabs.map(({ id, url, title, faviconUrl, lastActiveAt }) => ({
        id,
        url,
        title,
        faviconUrl,
        lastActiveAt,
      })),
    ),
  );
}

function tabTitle(tab: BrowserTabState): string {
  if (tab.url === "about:blank") return DEFAULT_TITLE;
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).hostname || tab.url;
  } catch {
    return tab.url || DEFAULT_TITLE;
  }
}

export function BrowserWorkspace({
  visible = true,
  onBack,
}: {
  visible?: boolean;
  onBack: () => void;
}) {
  const [tabs, setTabs] = useState<BrowserTabState[]>(loadTabs);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]!.id);
  const [address, setAddress] = useState("");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [inspector, setInspector] = useState<InspectorView>(null);
  const [inspectorValue, setInspectorValue] = useState<unknown>(null);
  const [inspectorBusy, setInspectorBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const addressInput = useRef<HTMLInputElement>(null);
  const overflow = useRef<HTMLDivElement>(null);
  const processedAgentCommands = useRef(new Set<string>());

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!,
    [activeTabId, tabs],
  );
  const residentTabs = useMemo(() => {
    const residentIds = new Set(
      [...tabs]
        .filter((tab) => tab.id !== activeTab.id)
        .sort((left, right) => right.lastActiveAt - left.lastActiveAt)
        .slice(0, MAX_RESIDENT_TABS - 1)
        .map((tab) => tab.id),
    );
    residentIds.add(activeTab.id);
    return tabs.filter((tab) => residentIds.has(tab.id));
  }, [activeTab, tabs]);

  const updateTab = useCallback(
    (tabId: string, patch: Partial<BrowserTabState>) => {
      setTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
      );
    },
    [],
  );

  const addTab = useCallback((url = "about:blank") => {
    const tab = createTab(url);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setInspector(null);
    setError(null);
    return tab;
  }, []);

  useEffect(
    () =>
      browserBridge.onAgentCommand((command) => {
        if (command.id && processedAgentCommands.current.has(command.id))
          return;
        if (command.id) processedAgentCommands.current.add(command.id);
        const url = normalizeBrowserAddress(command.url);
        setInspector(null);
        setError(null);
        if (activeTab.url === "about:blank") {
          updateTab(activeTab.id, {
            url,
            title: url,
            loading: true,
            crashed: false,
            lastActiveAt: Date.now(),
          });
          setActiveTabId(activeTab.id);
          return;
        }
        addTab(url);
      }),
    [activeTab.id, activeTab.url, addTab, updateTab],
  );

  useEffect(() => persistTabs(tabs), [tabs]);

  useEffect(() => {
    setAddress(activeTab.url === "about:blank" ? "" : activeTab.url);
    setZoomFactor(1);
    void browserBridge
      .invoke("activate", { tabId: activeTab.id })
      .catch(() => undefined);
  }, [activeTab.id, activeTab.url]);

  useEffect(() => {
    const unsubscribe = browserBridge.onEvent((event) => {
      if (event.kind.startsWith("download-") && event.download) {
        setDownloads((current) => {
          const rest = current.filter((item) => item.id !== event.download!.id);
          return [event.download!, ...rest].slice(0, 100);
        });
        return;
      }
      if (event.kind === "new-tab" && event.requestedUrl) {
        addTab(event.requestedUrl);
        return;
      }
      if (!event.tabId) return;
      const patch: Partial<BrowserTabState> = {};
      if (typeof event.url === "string" && event.url) patch.url = event.url;
      if (typeof event.title === "string" && event.title)
        patch.title = event.title;
      if (typeof event.loading === "boolean") patch.loading = event.loading;
      if (typeof event.canGoBack === "boolean")
        patch.canGoBack = event.canGoBack;
      if (typeof event.canGoForward === "boolean")
        patch.canGoForward = event.canGoForward;
      if (event.kind === "favicon") patch.faviconUrl = event.faviconUrl ?? null;
      if (event.kind === "crashed") {
        patch.crashed = true;
        patch.loading = false;
      }
      if (event.kind === "ready" || event.kind === "responsive")
        patch.crashed = false;
      updateTab(event.tabId, patch);
    });
    return unsubscribe;
  }, [addTab, updateTab]);

  useEffect(() => {
    if (!overflowOpen) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !overflow.current?.contains(event.target)
      ) {
        setOverflowOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [overflowOpen]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        addressInput.current?.focus();
        addressInput.current?.select();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        addTab();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void invoke("reload");
      } else if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        closeTab(activeTab.id);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  const invoke = useCallback(
    async <T,>(
      command: string,
      payload: Record<string, unknown> = {},
      timeoutMs?: number,
    ) => {
      setError(null);
      try {
        return await browserBridge.invoke<T>(
          command,
          {
            tabId: activeTab.id,
            ...payload,
          },
          timeoutMs,
        );
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [activeTab.id],
  );

  const navigate = useCallback(
    async (value: string) => {
      const url = normalizeBrowserAddress(value);
      if (url === "about:blank") {
        updateTab(activeTab.id, {
          url,
          title: DEFAULT_TITLE,
          loading: false,
          crashed: false,
        });
        return;
      }
      updateTab(activeTab.id, { url, loading: true, crashed: false });
    },
    [activeTab.id, updateTab],
  );

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    void navigate(address).catch((cause) => setError(errorMessage(cause)));
  };

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.id === tabId);
        const next = current.filter((tab) => tab.id !== tabId);
        if (next.length === 0) {
          const replacement = createTab();
          setActiveTabId(replacement.id);
          return [replacement];
        }
        if (tabId === activeTabId) {
          setActiveTabId(next[Math.min(index, next.length - 1)]!.id);
        }
        return next;
      });
      void browserBridge.invoke("unregister", { tabId }).catch(() => undefined);
    },
    [activeTabId],
  );

  const runInspector = async (view: Exclude<InspectorView, null>) => {
    setOverflowOpen(false);
    setInspector(view);
    setInspectorBusy(true);
    setInspectorValue(null);
    try {
      if (view === "dom") {
        setInspectorValue(await invoke("dom-snapshot"));
      } else if (view === "visual") {
        setInspectorValue(await invoke("visual-snapshot", {}, 15_000));
      } else if (view === "session") {
        setInspectorValue(await invoke("session-status"));
      } else {
        const value = await invoke<BrowserDownload[]>("downloads");
        setDownloads(value);
        setInspectorValue(value);
      }
    } catch {
      setInspectorValue(null);
    } finally {
      setInspectorBusy(false);
    }
  };

  const adjustZoom = async (delta: number) => {
    const next = Math.min(3, Math.max(0.5, zoomFactor + delta));
    setZoomFactor(next);
    await invoke("zoom", { factor: next });
  };

  return (
    <section
      className={`browser-workspace ${visible ? "is-visible" : "is-runtime-hidden"}`}
      aria-label="内置浏览器"
      aria-hidden={!visible}
    >
      <header className="browser-tabs-bar">
        <IconButton icon={PanelLeft} label="返回工作区" onClick={onBack} />
        <div className="browser-tabs" role="tablist" aria-label="浏览器标签页">
          {tabs.map((tab) => (
            <div
              className={`browser-tab ${tab.id === activeTab.id ? "is-active" : ""}`}
              key={tab.id}
            >
              <button
                className="browser-tab-select"
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab.id}
                onClick={() => {
                  setActiveTabId(tab.id);
                  setInspector(null);
                  updateTab(tab.id, { lastActiveAt: Date.now() });
                }}
              >
                <TabIcon tab={tab} />
                <span>{tabTitle(tab)}</span>
              </button>
              <button
                className="browser-tab-close"
                type="button"
                aria-label={`关闭 ${tabTitle(tab)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <IconButton icon={Plus} label="新建标签页" onClick={() => addTab()} />
        <span className="browser-shared-pill">
          <span />
          共享浏览器
        </span>
      </header>

      <div className="browser-navigation-bar">
        <IconButton
          icon={ArrowLeft}
          label="后退"
          disabled={!activeTab.canGoBack}
          onClick={() => void invoke("back")}
        />
        <IconButton
          icon={ArrowRight}
          label="前进"
          disabled={!activeTab.canGoForward}
          onClick={() => void invoke("forward")}
        />
        <IconButton
          icon={activeTab.loading ? X : RefreshCw}
          label={activeTab.loading ? "停止加载" : "重新加载"}
          onClick={() => void invoke(activeTab.loading ? "stop" : "reload")}
        />
        <form className="browser-address" onSubmit={submitAddress}>
          <ShieldCheck size={14} aria-hidden="true" />
          <input
            ref={addressInput}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="搜索或输入网址"
            aria-label="地址和搜索"
            spellCheck={false}
          />
          {activeTab.loading ? (
            <LoaderCircle className="browser-spin" size={14} />
          ) : null}
        </form>
        <IconButton
          icon={ExternalLink}
          label="在默认浏览器中打开"
          disabled={activeTab.url === "about:blank"}
          onClick={() => void invoke("open-external")}
        />
        <div className="browser-overflow-host" ref={overflow}>
          <IconButton
            icon={MoreHorizontal}
            label="浏览器工具"
            active={overflowOpen}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((open) => !open)}
          />
          {overflowOpen ? (
            <BrowserOverflowMenu
              zoomFactor={zoomFactor}
              onInspect={runInspector}
              onDeveloper={() => {
                setOverflowOpen(false);
                void invoke("developer-tools");
              }}
              onZoom={adjustZoom}
            />
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="browser-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      ) : null}

      <div className={`browser-stage ${inspector ? "has-inspector" : ""}`}>
        <div className="browser-guest-stack">
          {residentTabs
            .filter((tab) => tab.url !== "about:blank")
            .map((tab) => (
              <BrowserGuest
                active={tab.id === activeTab.id}
                key={tab.id}
                tab={tab}
                onState={updateTab}
              />
            ))}
          {activeTab.url === "about:blank" ? (
            <BrowserHome onNavigate={navigate} />
          ) : null}
          {activeTab.crashed ? (
            <BrowserCrash
              reason="页面进程已经退出"
              onRecover={() => void invoke("recover")}
            />
          ) : null}
        </div>
        {inspector ? (
          <BrowserInspector
            view={inspector}
            value={inspectorValue}
            busy={inspectorBusy}
            downloads={downloads}
            onClose={() => setInspector(null)}
            onClearSite={() =>
              void invoke("clear-site-data").then(() => runInspector("session"))
            }
            onClearAll={() =>
              void invoke("clear-all-data").then(() => runInspector("session"))
            }
            onCopySnapshot={() => void invoke("copy-visual-snapshot")}
            onShowDownload={(id) => void invoke("show-download", { id })}
          />
        ) : null}
      </div>
    </section>
  );
}

function BrowserGuest({
  tab,
  active,
  onState,
}: {
  tab: BrowserTabState;
  active: boolean;
  onState: (tabId: string, patch: Partial<BrowserTabState>) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const guestRef = useRef<BrowserWebviewElement | null>(null);
  const guestReadyRef = useRef(false);
  const targetUrlRef = useRef(tab.url);
  const initialUrl = useRef(tab.url);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    targetUrlRef.current = tab.url;
    const guest = guestRef.current;
    if (!guest || !guestReadyRef.current) return;
    loadGuestUrl(guest, tab.url, (message) =>
      onState(tab.id, { loading: false, title: message }),
    );
  }, [onState, tab.id, tab.url]);

  useLayoutEffect(() => {
    const container = host.current;
    if (!container) return;
    const guest = document.createElement("webview") as BrowserWebviewElement;
    guestRef.current = guest;
    guest.className = "browser-webview";
    guest.setAttribute("partition", PARTITION);
    guest.setAttribute("src", initialUrl.current);
    guest.setAttribute(
      "webpreferences",
      "contextIsolation=yes,sandbox=yes,nodeIntegration=no",
    );

    const didAttach = () => {
      void browserBridge
        .invoke("register", {
          tabId: tab.id,
          webContentsId: guest.getWebContentsId(),
        })
        .then((value) => onState(tab.id, value as Partial<BrowserTabState>))
        .then(() =>
          activeRef.current
            ? browserBridge.invoke("activate", { tabId: tab.id })
            : undefined,
        )
        .catch((cause) =>
          onState(tab.id, {
            loading: false,
            crashed: true,
            title: errorMessage(cause),
          }),
        );
    };
    const domReady = () => {
      guestReadyRef.current = true;
      loadGuestUrl(guest, targetUrlRef.current, (message) =>
        onState(tab.id, { loading: false, title: message }),
      );
    };
    const start = () => onState(tab.id, { loading: true, crashed: false });
    const stop = () => onState(tab.id, { loading: false });
    const navigate = (event: Event) => {
      const value = event as Event & { url?: string };
      onState(tab.id, {
        url: value.url || guest.getURL(),
      });
    };
    const title = (event: Event) => {
      const value = event as Event & { title?: string };
      onState(tab.id, { title: value.title || guest.getTitle() });
    };
    const favicon = (event: Event) => {
      const value = event as Event & { favicons?: string[] };
      onState(tab.id, { faviconUrl: value.favicons?.[0] ?? null });
    };
    const crashed = () => onState(tab.id, { crashed: true, loading: false });

    guest.addEventListener("did-attach", didAttach);
    guest.addEventListener("dom-ready", domReady);
    guest.addEventListener("did-start-loading", start);
    guest.addEventListener("did-stop-loading", stop);
    guest.addEventListener("did-navigate", navigate);
    guest.addEventListener("did-navigate-in-page", navigate);
    guest.addEventListener("page-title-updated", title);
    guest.addEventListener("page-favicon-updated", favicon);
    guest.addEventListener("render-process-gone", crashed);
    container.append(guest);

    return () => {
      guestRef.current = null;
      guestReadyRef.current = false;
      guest.remove();
      void browserBridge
        .invoke("unregister", { tabId: tab.id })
        .catch(() => undefined);
    };
  }, [onState, tab.id]);

  return (
    <div
      ref={host}
      className={`browser-guest ${active ? "is-active" : ""}`}
      aria-hidden={!active}
    />
  );
}

function loadGuestUrl(
  guest: BrowserWebviewElement,
  url: string,
  onError: (message: string) => void,
) {
  try {
    if (guest.getURL() === url) return;
    void guest.loadURL(url).catch((cause) => onError(errorMessage(cause)));
  } catch (cause) {
    onError(errorMessage(cause));
  }
}

function BrowserHome({
  onNavigate,
}: {
  onNavigate: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="browser-home">
      <div className="browser-home-mark">OP</div>
      <h1>从这里开始</h1>
      <p>搜索、打开站点，或让任务接管这个标签页。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onNavigate(value);
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="搜索或输入网址"
          aria-label="搜索或输入网址"
        />
        <button type="submit">打开</button>
      </form>
    </div>
  );
}

function TabIcon({ tab }: { tab: BrowserTabState }) {
  if (tab.loading) return <LoaderCircle className="browser-spin" size={13} />;
  if (tab.faviconUrl) return <img src={tab.faviconUrl} alt="" />;
  return <Globe2 size={13} aria-hidden="true" />;
}

function BrowserOverflowMenu({
  zoomFactor,
  onInspect,
  onDeveloper,
  onZoom,
}: {
  zoomFactor: number;
  onInspect: (view: Exclude<InspectorView, null>) => void;
  onDeveloper: () => void;
  onZoom: (delta: number) => Promise<void>;
}) {
  return (
    <div className="browser-overflow-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => onInspect("dom")}>
        <Code2 size={15} />
        <span>DOM 快照</span>
      </button>
      <button type="button" role="menuitem" onClick={() => onInspect("visual")}>
        <Camera size={15} />
        <span>视觉快照</span>
      </button>
      <button type="button" role="menuitem" onClick={onDeveloper}>
        <ZoomIn size={15} />
        <span>开发检查</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onInspect("session")}
      >
        <KeyRound size={15} />
        <span>登录与站点数据</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onInspect("downloads")}
      >
        <Download size={15} />
        <span>下载内容</span>
      </button>
      <div className="browser-menu-separator" />
      <div className="browser-zoom-row">
        <span>页面缩放</span>
        <button
          type="button"
          aria-label="缩小"
          onClick={() => void onZoom(-0.1)}
        >
          <Minus size={14} />
        </button>
        <output>{Math.round(zoomFactor * 100)}%</output>
        <button
          type="button"
          aria-label="放大"
          onClick={() => void onZoom(0.1)}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function BrowserInspector({
  view,
  value,
  busy,
  downloads,
  onClose,
  onClearSite,
  onClearAll,
  onCopySnapshot,
  onShowDownload,
}: {
  view: Exclude<InspectorView, null>;
  value: unknown;
  busy: boolean;
  downloads: BrowserDownload[];
  onClose: () => void;
  onClearSite: () => void;
  onClearAll: () => void;
  onCopySnapshot: () => void;
  onShowDownload: (id: string) => void;
}) {
  const title = {
    dom: "DOM 快照",
    visual: "视觉快照",
    session: "登录与站点数据",
    downloads: "下载内容",
  }[view];
  return (
    <aside className="browser-inspector" aria-label={title}>
      <header>
        <div>
          <strong>{title}</strong>
          <span>{inspectorDescription(view)}</span>
        </div>
        <IconButton icon={X} label={`关闭${title}`} onClick={onClose} />
      </header>
      {busy ? (
        <div className="browser-inspector-loading">
          <LoaderCircle className="browser-spin" />
          正在读取页面
        </div>
      ) : null}
      {!busy && view === "dom" ? (
        <pre>{JSON.stringify(value, null, 2)}</pre>
      ) : null}
      {!busy && view === "visual" ? (
        <div className="browser-visual-result">
          {isVisualSnapshot(value) ? (
            <img src={value.dataUrl} alt="当前页面视觉快照" />
          ) : (
            <EmptyInspector />
          )}
          <button type="button" onClick={onCopySnapshot}>
            <Copy size={14} />
            复制到剪贴板
          </button>
        </div>
      ) : null}
      {!busy && view === "session" ? (
        <SessionInspector
          value={value}
          onClearSite={onClearSite}
          onClearAll={onClearAll}
        />
      ) : null}
      {!busy && view === "downloads" ? (
        <DownloadsInspector downloads={downloads} onShow={onShowDownload} />
      ) : null}
    </aside>
  );
}

function SessionInspector({
  value,
  onClearSite,
  onClearAll,
}: {
  value: unknown;
  onClearSite: () => void;
  onClearAll: () => void;
}) {
  const [clearConfirmation, setClearConfirmation] = useState<
    "site" | "all" | null
  >(null);
  const session = value as {
    persistent?: boolean;
    partition?: string;
    url?: string;
    cookies?: Array<{
      name: string;
      domain: string;
      secure: boolean;
      httpOnly: boolean;
    }>;
  } | null;
  return (
    <div className="browser-session-inspector">
      <div className="browser-session-status">
        <span>
          <Check size={14} />
        </span>
        <div>
          <strong>持久化浏览器会话</strong>
          <small>
            {session?.cookies?.length ?? 0} 个 Cookie ·{" "}
            {session?.partition ?? PARTITION}
          </small>
        </div>
      </div>
      <div className="browser-cookie-list">
        {(session?.cookies ?? []).map((cookie) => (
          <div key={`${cookie.domain}-${cookie.name}`}>
            <span>{cookie.name}</span>
            <small>{cookie.domain}</small>
            {cookie.secure ? (
              <ShieldCheck size={12} aria-label="安全 Cookie" />
            ) : null}
          </div>
        ))}
        {(session?.cookies?.length ?? 0) === 0 ? (
          <p>当前站点还没有保存登录数据。</p>
        ) : null}
      </div>
      <div className="browser-inspector-actions">
        <button
          type="button"
          onClick={() => {
            if (clearConfirmation === "site") {
              setClearConfirmation(null);
              onClearSite();
            } else {
              setClearConfirmation("site");
            }
          }}
        >
          <Trash2 size={14} />
          {clearConfirmation === "site" ? "再次点击确认" : "清除此站点"}
        </button>
        <button
          className="is-danger"
          type="button"
          onClick={() => {
            if (clearConfirmation === "all") {
              setClearConfirmation(null);
              onClearAll();
            } else {
              setClearConfirmation("all");
            }
          }}
        >
          <Trash2 size={14} />
          {clearConfirmation === "all" ? "再次点击确认" : "清除全部数据"}
        </button>
      </div>
    </div>
  );
}

function DownloadsInspector({
  downloads,
  onShow,
}: {
  downloads: BrowserDownload[];
  onShow: (id: string) => void;
}) {
  if (downloads.length === 0)
    return <EmptyInspector text="下载的文件会显示在这里。" />;
  return (
    <div className="browser-download-list">
      {downloads.map((download) => (
        <button
          type="button"
          key={download.id}
          onClick={() => onShow(download.id)}
        >
          <Download size={15} />
          <span>
            <strong>{download.filename}</strong>
            <small>{downloadState(download)}</small>
          </span>
          {download.state === "completed" ? (
            <Check size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>
      ))}
    </div>
  );
}

function BrowserCrash({
  reason,
  onRecover,
}: {
  reason: string;
  onRecover: () => void;
}) {
  return (
    <div className="browser-crash" role="alert">
      <Globe2 size={24} />
      <strong>页面没有正常响应</strong>
      <span>{reason}</span>
      <button type="button" onClick={onRecover}>
        重新加载页面
      </button>
    </div>
  );
}

function EmptyInspector({ text = "没有可显示的内容。" }: { text?: string }) {
  return <div className="browser-inspector-empty">{text}</div>;
}

function inspectorDescription(view: Exclude<InspectorView, null>): string {
  return {
    dom: "页面中可见且可交互的元素",
    visual: "当前标签页的完整画面",
    session: "登录状态、Cookie 与本地存储",
    downloads: "由内置浏览器保存的文件",
  }[view];
}

function isVisualSnapshot(value: unknown): value is { dataUrl: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "dataUrl" in value &&
    typeof value.dataUrl === "string",
  );
}

function downloadState(download: BrowserDownload): string {
  if (download.state === "completed") return "已完成";
  if (download.state === "cancelled") return "已取消";
  if (download.state === "interrupted") return "下载中断";
  if (download.totalBytes > 0) {
    return `${Math.round((download.receivedBytes / download.totalBytes) * 100)}%`;
  }
  return "正在下载";
}
