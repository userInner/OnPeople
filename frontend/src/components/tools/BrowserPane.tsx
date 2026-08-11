import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Camera,
  Code2,
  ExternalLink,
  Globe2,
  KeyRound,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { constrainedBrowserSurfaceBounds } from "../../lib/browserSurfaceBounds";
import { errorMessage } from "../../lib/errors";
import { useWorkbenchStore } from "../../store/workbenchStore";
import type {
  BrowserAnnotation,
  BrowserDeveloperState,
  BrowserFrame,
  StreamEnvelope,
} from "../../types";
import { IconButton } from "../IconButton";
import { LocalArtifactBrowserPreview } from "./LocalArtifactBrowserPreview";

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "about:blank";
  if (/^(?:https?|file|about):/i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/?:#]|$)/i.test(trimmed))
    return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function tabDisplayTitle(tab: { title: string; url: string }): string {
  if (tab.url === "about:blank") return "新标签页";
  return tab.title || tab.url;
}

export function BrowserPane() {
  return <DesktopBrowserPane />;
}

function DesktopBrowserPane() {
  const browser = useWorkbenchStore((state) => state.browser);
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const localArtifactPreview = useWorkbenchStore(
    (state) => state.localArtifactPreview,
  );
  const [address, setAddress] = useState("");
  const [addressRouteId, setAddressRouteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [visualSnapshot, setVisualSnapshot] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<
    "snapshot" | "developer" | "annotations" | "session" | null
  >(null);
  const [detailValue, setDetailValue] = useState<unknown>(null);
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([]);
  const [annotationText, setAnnotationText] = useState("");
  const [annotationSelector, setAnnotationSelector] = useState("");
  const [providerId, setProviderId] = useState("onpeople");
  const [detailBusy, setDetailBusy] = useState(false);
  const [surfaceFocused, setSurfaceFocused] = useState(false);
  const addressInput = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const pendingPointerMove = useRef<{
    x: number;
    y: number;
    modifiers: number;
  } | null>(null);
  const pointerMoveFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pointerMoveFrame.current !== null)
        window.cancelAnimationFrame(pointerMoveFrame.current);
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    const handleStream = (event: StreamEnvelope) => {
      if (!mounted || event.kind !== "browser-frame") return;
      const value = event.payload as unknown as Partial<BrowserFrame> & {
        kind?: string;
      };
      if (value.routeId && value.surfaceKind) {
        setFrame(value as BrowserFrame);
      }
    };
    void desktopClient.streamBrowser(handleStream).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const threadTabs = useMemo(() => {
    if (!browser) return [];
    return browser.tabs.filter(
      (tab) => tab.threadId === (selectedThreadId ?? "main"),
    );
  }, [browser, selectedThreadId]);

  const activeTab = useMemo(() => {
    if (!browser) return null;
    return (
      threadTabs.find((tab) => tab.routeId === browser.activeRouteId) ??
      threadTabs.at(0) ??
      null
    );
  }, [browser, threadTabs]);
  const hostStatus = browser?.hostStatus ?? "stopped";
  const browserStarting = hostStatus === "starting" || hostStatus === "backoff";
  const browserFailed = hostStatus === "failed" || hostStatus === "crashed";
  const browserReady = hostStatus === "ready" && browser?.hostReady === true;

  useEffect(() => {
    if (browserReady) setError(null);
  }, [browserReady]);

  const routeId =
    activeTab?.routeId ??
    `route-${(selectedThreadId ?? "main").replace(/[^a-zA-Z0-9_.-]/g, "")}`;
  const activeTabRouteId = activeTab?.routeId ?? null;
  const activeTabUrl = activeTab?.url ?? null;
  const showBrowserHome = !activeTab || activeTab.url === "about:blank";

  useEffect(() => {
    if (!activeTab || activeTab.routeId === browser?.activeRouteId) return;
    void desktopClient
      .activateBrowserTab(activeTab.threadId, activeTab.routeId)
      .catch((cause) => setError(errorMessage(cause)));
  }, [activeTab, browser?.activeRouteId]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        addressInput.current?.focus();
        addressInput.current?.select();
        return;
      }
      if (event.key.toLowerCase() === "r" && activeTab) {
        event.preventDefault();
        routeCommand("reload");
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  const displayedAddress =
    addressRouteId === routeId
      ? address
      : activeTab?.url === "about:blank"
        ? ""
        : (activeTab?.url ?? address);

  useEffect(() => {
    let cancelled = false;

    const captureInitialFallback = async () => {
      if (!activeTabRouteId) return;
      try {
        const value = await desktopClient.captureBrowserVisualSnapshot(routeId);
        const imageBase64 =
          typeof value.imageBase64 === "string" ? value.imageBase64 : null;
        if (!cancelled && imageBase64) {
          setVisualSnapshot(`data:image/png;base64,${imageBase64}`);
        }
      } catch {
        // The live browser is rendered by the native IOSurface compositor.
        // A failed one-shot fallback capture must never start a screenshot
        // polling loop: replacing an <img> repeatedly causes visible flashing.
      }
    };

    setVisualSnapshot(null);
    if (activeTabRouteId) void captureInitialFallback();
    return () => {
      cancelled = true;
    };
  }, [activeTabRouteId, activeTabUrl, routeId]);

  useEffect(() => {
    let active = true;
    void desktopClient
      .listBrowserAnnotations(routeId)
      .then((value) => {
        if (active) setAnnotations(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [routeId]);

  useEffect(() => {
    const element = surface.current;
    const paneElement = pane.current;
    const toolbarElement = toolbar.current;
    if (!element || !paneElement || !toolbarElement) return;
    let lastBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      scaleFactor: number;
      visible: boolean;
      interactive: boolean;
    } | null = null;
    let intersecting = true;
    let boundsFrame: number | null = null;
    let settledFrame: number | null = null;
    let settledTimer: number | null = null;
    const syncBounds = (force = false) => {
      const rect = element.getBoundingClientRect();
      const viewportBounds = constrainedBrowserSurfaceBounds(
        rect,
        paneElement.getBoundingClientRect(),
        toolbarElement.getBoundingClientRect(),
      );
      const occluded =
        document.querySelector(
          '[aria-modal="true"], [data-native-surface-occluder="true"], details.browser-overflow[open]',
        ) !== null;
      // A focused WebContentsView makes the React document report
      // `hasFocus() === false`. Visibility must follow the pane/route, not
      // focus ownership, otherwise the first click hides the native page.
      const nextBounds = {
        ...viewportBounds,
        scaleFactor: window.devicePixelRatio,
        visible:
          !occluded &&
          !showBrowserHome &&
          intersecting &&
          document.visibilityState === "visible" &&
          rect.width > 0 &&
          rect.height > 0,
        interactive:
          document.documentElement.classList.contains("is-column-resizing"),
      };
      if (
        !force &&
        lastBounds &&
        lastBounds.x === nextBounds.x &&
        lastBounds.y === nextBounds.y &&
        lastBounds.width === nextBounds.width &&
        lastBounds.height === nextBounds.height &&
        lastBounds.scaleFactor === nextBounds.scaleFactor &&
        lastBounds.visible === nextBounds.visible &&
        lastBounds.interactive === nextBounds.interactive
      ) {
        return;
      }
      lastBounds = nextBounds;
      void desktopClient
        .browserSurfaceBounds({
          routeId,
          ...lastBounds,
        })
        .catch(() => undefined);
    };
    const scheduleBounds = () => {
      if (boundsFrame !== null) return;
      boundsFrame = window.requestAnimationFrame(() => {
        boundsFrame = null;
        syncBounds();
      });
    };
    const scheduleSettledBounds = () => {
      scheduleBounds();
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
      if (settledTimer !== null) window.clearTimeout(settledTimer);
      settledFrame = window.requestAnimationFrame(() => {
        settledFrame = window.requestAnimationFrame(() => {
          settledFrame = null;
          syncBounds(true);
        });
      });
      settledTimer = window.setTimeout(() => {
        settledTimer = null;
        syncBounds(true);
      }, 140);
    };
    const resizeObserver = new ResizeObserver(() => {
      scheduleBounds();
    });
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      scheduleBounds();
    });
    const modalObserver = new MutationObserver(scheduleBounds);
    const handleVisibility = () => scheduleBounds();
    const handleResizeEnd = () => scheduleSettledBounds();
    resizeObserver.observe(element);
    resizeObserver.observe(paneElement);
    resizeObserver.observe(toolbarElement);
    intersectionObserver.observe(element);
    modalObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("resize", scheduleSettledBounds);
    window.addEventListener("onpeople:layout-resize-end", handleResizeEnd);
    scheduleSettledBounds();
    return () => {
      if (boundsFrame !== null) window.cancelAnimationFrame(boundsFrame);
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
      if (settledTimer !== null) window.clearTimeout(settledTimer);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      modalObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", scheduleSettledBounds);
      window.removeEventListener("onpeople:layout-resize-end", handleResizeEnd);
      if (lastBounds) {
        void desktopClient
          .browserSurfaceBounds({
            routeId,
            ...lastBounds,
            visible: false,
            interactive: false,
          })
          .catch(() => undefined);
      }
    };
  }, [localArtifactPreview?.id, routeId, showBrowserHome]);

  const createTab = async () => {
    setError(null);
    const nextRouteId = `route-${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      const element = surface.current;
      const paneElement = pane.current;
      const toolbarElement = toolbar.current;
      if (element && paneElement && toolbarElement) {
        await desktopClient.browserSurfaceBounds({
          routeId,
          ...constrainedBrowserSurfaceBounds(
            element.getBoundingClientRect(),
            paneElement.getBoundingClientRect(),
            toolbarElement.getBoundingClientRect(),
          ),
          scaleFactor: window.devicePixelRatio,
          visible: false,
          interactive: false,
        });
      }
      await desktopClient.browserCommand({
        command: "createRoute",
        payload: {
          routeId: nextRouteId,
          threadId: selectedThreadId ?? "main",
          url: "about:blank",
        },
      });
      setAddress("");
      setAddressRouteId(nextRouteId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const activateTab = async (tabRouteId: string, threadId: string) => {
    setError(null);
    try {
      await desktopClient.activateBrowserTab(threadId, tabRouteId);
      setAddressRouteId(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const closeTab = async (tabRouteId: string) => {
    setError(null);
    try {
      await desktopClient.browserCommand({
        command: "closeRoute",
        payload: { routeId: tabRouteId },
      });
      if (tabRouteId === routeId) setAddressRouteId(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const navigate = async () => {
    setError(null);
    const url = normalizeAddress(address);
    try {
      if (!activeTab) {
        await desktopClient.browserCommand({
          command: "createRoute",
          payload: { routeId, threadId: selectedThreadId ?? "main", url },
        });
      } else {
        await desktopClient.browserCommand({
          command: "navigate",
          payload: { routeId, url },
        });
      }
      const element = surface.current;
      const paneElement = pane.current;
      const toolbarElement = toolbar.current;
      if (element && paneElement && toolbarElement) {
        const viewportBounds = constrainedBrowserSurfaceBounds(
          element.getBoundingClientRect(),
          paneElement.getBoundingClientRect(),
          toolbarElement.getBoundingClientRect(),
        );
        await desktopClient.browserSurfaceBounds({
          routeId,
          ...viewportBounds,
          scaleFactor: window.devicePixelRatio,
          visible: true,
          interactive: false,
        });
      }
      setAddress(url);
      setAddressRouteId(routeId);
      window.dispatchEvent(new Event("onpeople:layout-resize-end"));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const routeCommand = (command: "back" | "forward" | "reload") => {
    void desktopClient
      .browserCommand({ command, payload: { routeId } })
      .catch((cause) => {
        setError(errorMessage(cause));
      });
  };

  const sendPointer = (
    kind: "move" | "down" | "up" | "wheel" | "leave",
    event:
      | React.PointerEvent<HTMLDivElement>
      | React.WheelEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void desktopClient
      .browserCommand({
        command: "pointer",
        payload: {
          routeId,
          kind,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          deltaX: "deltaX" in event ? -event.deltaX : 0,
          deltaY: "deltaY" in event ? -event.deltaY : 0,
          button: "button" in event ? event.button : 0,
          clickCount: "detail" in event ? Math.max(1, event.detail) : 1,
          modifiers: browserEventModifiers(event),
        },
      })
      .catch((cause) => setError(errorMessage(cause)));
  };

  const sendKey = (
    kind: "down" | "up",
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    void desktopClient
      .browserCommand({
        command: "key",
        payload: {
          routeId,
          kind,
          keyCode: event.keyCode,
          nativeKeyCode: event.keyCode,
          character: event.key.length === 1 ? event.key : "",
          modifiers: browserEventModifiers(event),
        },
      })
      .catch((cause) => setError(errorMessage(cause)));
  };

  const inspect = async (
    view: "snapshot" | "developer",
    command: "dom" | "visual" | "developer",
  ) => {
    setError(null);
    setDetailView(view);
    setDetailBusy(true);
    try {
      const value =
        command === "dom"
          ? await desktopClient.browserCommand({
              command: "domSnapshot",
              payload: { routeId },
            })
          : command === "visual"
            ? await desktopClient.captureBrowserVisualSnapshot(routeId)
            : await desktopClient.inspectBrowserDeveloperState(routeId);
      setDetailValue(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDetailBusy(false);
    }
  };

  const openAnnotations = async () => {
    setDetailView("annotations");
    setDetailBusy(true);
    setError(null);
    try {
      await desktopClient.beginBrowserAnnotation(routeId);
      setAnnotations(await desktopClient.listBrowserAnnotations(routeId));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDetailBusy(false);
    }
  };

  const saveAnnotation = async () => {
    if (!annotationText.trim()) return;
    setDetailBusy(true);
    setError(null);
    try {
      const annotation = await desktopClient.saveBrowserAnnotation({
        id: crypto.randomUUID(),
        routeId,
        url: activeTab?.url ?? displayedAddress,
        selector: annotationSelector.trim() || null,
        rect: null,
        text: annotationText.trim(),
        createdAt: new Date().toISOString(),
      });
      setAnnotations((current) => [annotation, ...current]);
      setAnnotationText("");
      setAnnotationSelector("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDetailBusy(false);
    }
  };

  const deleteAnnotation = async (id: string) => {
    setDetailBusy(true);
    try {
      await desktopClient.deleteBrowserAnnotation(id);
      setAnnotations((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDetailBusy(false);
    }
  };

  if (localArtifactPreview) {
    return <LocalArtifactBrowserPreview key={localArtifactPreview.id} />;
  }

  return (
    <div className="browser-pane" ref={pane}>
      <div className="browser-tab-strip">
        <div
          className="browser-tab-scroll"
          role="tablist"
          aria-label="浏览器标签页"
        >
          {threadTabs.map((tab) => (
            <div
              className={`browser-tab ${tab.routeId === routeId ? "is-active" : ""}`}
              key={tab.routeId}
            >
              <button
                className="browser-tab-main"
                type="button"
                role="tab"
                aria-selected={tab.routeId === routeId}
                onClick={() => void activateTab(tab.routeId, tab.threadId)}
              >
                {tab.loading ? (
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                ) : (
                  <Globe2 size={14} aria-hidden="true" />
                )}
                <span>{tabDisplayTitle(tab)}</span>
              </button>
              <button
                className="browser-tab-close"
                type="button"
                aria-label={`关闭 ${tabDisplayTitle(tab)}`}
                onClick={() => void closeTab(tab.routeId)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button
          className="browser-new-tab"
          type="button"
          aria-label="新建浏览器标签页"
          onClick={() => void createTab()}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <span
          className={`browser-control-state ${activeTab?.loading ? "is-busy" : surfaceFocused ? "is-user" : ""}`}
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {activeTab?.loading
            ? "页面加载中"
            : surfaceFocused
              ? "你在控制"
              : "共享浏览器"}
        </span>
      </div>
      <div className="browser-toolbar" ref={toolbar}>
        <IconButton
          icon={ArrowLeft}
          label="后退"
          disabled={browserStarting || !activeTab?.canGoBack}
          onClick={() => routeCommand("back")}
        />
        <IconButton
          icon={ArrowRight}
          label="前进"
          disabled={browserStarting || !activeTab?.canGoForward}
          onClick={() => routeCommand("forward")}
        />
        <IconButton
          icon={RefreshCw}
          label="重新加载"
          disabled={browserStarting || !activeTab}
          onClick={() => routeCommand("reload")}
        />
        <form
          className="browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate();
          }}
        >
          {address.startsWith("https://") ? (
            <ShieldCheck size={13} aria-hidden="true" />
          ) : (
            <Globe2 size={13} aria-hidden="true" />
          )}
          <input
            ref={addressInput}
            value={displayedAddress}
            onChange={(event) => {
              setAddress(event.target.value);
              setAddressRouteId(routeId);
            }}
            aria-label="浏览器地址"
            placeholder="搜索或输入网址"
          />
        </form>
        <IconButton
          icon={MessageSquarePlus}
          label="标注当前页面"
          disabled={!browserReady}
          onClick={() => void openAnnotations()}
        />
        <IconButton
          icon={ExternalLink}
          label="在系统浏览器中打开"
          disabled={browserStarting || !activeTab}
          onClick={() => {
            if (activeTab?.url)
              void desktopClient.openExternalUrl(activeTab.url);
          }}
        />
        <details className="browser-overflow">
          <summary aria-label="更多浏览器工具">
            <MoreHorizontal size={17} aria-hidden="true" />
          </summary>
          <div className="browser-overflow-menu">
            <button
              type="button"
              disabled={!browserReady}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void inspect("snapshot", "dom");
              }}
            >
              <Code2 size={14} />
              DOM 快照
            </button>
            <button
              type="button"
              disabled={!browserReady}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void inspect("snapshot", "visual");
              }}
            >
              <Camera size={14} />
              视觉快照
            </button>
            <button
              type="button"
              disabled={!browserReady}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void inspect("developer", "developer");
              }}
            >
              <Bug size={14} />
              开发检查
            </button>
            <button
              type="button"
              disabled={!browserReady}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                setDetailView("session");
              }}
            >
              <KeyRound size={14} />
              登录与浏览器数据
            </button>
            <span className="browser-overflow-status">
              {frame
                ? frame.routeId === routeId
                  ? `${frame.width} × ${frame.height}`
                  : "正在连接当前标签页"
                : visualSnapshot
                  ? "浏览器画面已连接"
                  : "等待浏览器画面"}
            </span>
          </div>
        </details>
      </div>
      {activeTab && detailView ? (
        <BrowserDetailPanel
          view={detailView}
          busy={detailBusy}
          value={detailValue}
          developerState={developerState(detailValue)}
          annotations={annotations}
          annotationText={annotationText}
          annotationSelector={annotationSelector}
          providerId={providerId}
          onAnnotationText={setAnnotationText}
          onAnnotationSelector={setAnnotationSelector}
          onProviderId={setProviderId}
          onSaveAnnotation={() => void saveAnnotation()}
          onDeleteAnnotation={(id) => void deleteAnnotation(id)}
          onFillCredential={() =>
            void desktopClient
              .fillSavedBrowserCredential(routeId)
              .catch((cause) => setError(errorMessage(cause)))
          }
          onSignIn={() =>
            void desktopClient
              .openBrowserSignIn(providerId, routeId)
              .catch((cause) => setError(errorMessage(cause)))
          }
          onClearSession={() => {
            if (
              !window.confirm(`清除 ${providerId} 在当前隔离浏览器中的会话？`)
            ) {
              return;
            }
            void desktopClient
              .clearBrowserSession(providerId, routeId)
              .catch((cause) => setError(errorMessage(cause)));
          }}
          onClearAll={() => {
            if (
              !window.confirm("清除隔离浏览器的全部 Cookie、存储和站点权限？")
            ) {
              return;
            }
            void desktopClient
              .clearAllBrowserData(routeId)
              .catch((cause) => setError(errorMessage(cause)));
          }}
          onClose={() => {
            if (detailView === "annotations") {
              void desktopClient
                .cancelBrowserAnnotation(routeId)
                .catch(() => undefined);
            }
            setDetailView(null);
          }}
        />
      ) : null}
      <div className="browser-surface" ref={surface} data-route-id={routeId}>
        {browserStarting ? (
          <div className="browser-host-status" role="status">
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
            <span>正在启动浏览器</span>
          </div>
        ) : null}
        {browserFailed ? (
          <div
            className="browser-host-status browser-host-status-error"
            role="alert"
          >
            <strong>
              {browser?.hostErrorKind === "host-exit" ||
              hostStatus === "crashed"
                ? "浏览器宿主已退出"
                : browser?.hostErrorKind === "protocol-mismatch"
                  ? "浏览器协议不匹配"
                  : browser?.hostErrorKind === "cef-init-failed"
                    ? "CEF 初始化失败"
                    : "浏览器启动失败"}
            </strong>
            <span>{browser?.hostError ?? error ?? "CEF 浏览器宿主不可用"}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                void desktopClient
                  .restartBrowserHost()
                  .then((value) =>
                    useWorkbenchStore.setState({ browser: value }),
                  )
                  .catch((cause) => setError(errorMessage(cause)));
              }}
            >
              {browser?.hostErrorKind === "keychain-authorization"
                ? "重新授权"
                : "重新启动浏览器"}
            </button>
          </div>
        ) : null}
        {error && !browserStarting && !browserFailed ? (
          <div className="tool-error">{error}</div>
        ) : null}
        {showBrowserHome ? (
          <div className="browser-home">
            <div className="browser-home-mark">OP</div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void navigate();
              }}
            >
              <input
                value={displayedAddress}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setAddressRouteId(routeId);
                }}
                placeholder="搜索或输入网址"
                aria-label="搜索或输入网址"
              />
            </form>
          </div>
        ) : (
          <div
            className="native-surface-anchor"
            aria-label={activeTab.title || activeTab.url}
            role="application"
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              sendPointer("down", event);
            }}
            onPointerUp={(event) => {
              sendPointer("up", event);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              pendingPointerMove.current = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                modifiers: browserEventModifiers(event),
              };
              if (pointerMoveFrame.current !== null) return;
              pointerMoveFrame.current = window.requestAnimationFrame(() => {
                pointerMoveFrame.current = null;
                const move = pendingPointerMove.current;
                if (!move) return;
                pendingPointerMove.current = null;
                void desktopClient
                  .browserCommand({
                    command: "pointer",
                    payload: {
                      routeId,
                      kind: "move",
                      ...move,
                      deltaX: 0,
                      deltaY: 0,
                      button: 0,
                      clickCount: 1,
                    },
                  })
                  .catch(() => undefined);
              });
            }}
            onPointerLeave={(event) => sendPointer("leave", event)}
            onWheel={(event) => {
              event.preventDefault();
              sendPointer("wheel", event);
            }}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (!event.repeat) sendKey("down", event);
            }}
            onKeyUp={(event) => sendKey("up", event)}
            onFocus={() => setSurfaceFocused(true)}
            onBlur={() => setSurfaceFocused(false)}
          >
            {visualSnapshot ? (
              <img
                className="browser-visual-fallback"
                src={visualSnapshot}
                alt=""
                draggable={false}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function browserEventModifiers(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  buttons?: number;
}): number {
  let flags = 0;
  if (event.shiftKey) flags |= 1 << 1;
  if (event.ctrlKey) flags |= 1 << 2;
  if (event.altKey) flags |= 1 << 3;
  if (event.metaKey) flags |= 1 << 7;
  if ((event.buttons ?? 0) & 1) flags |= 1 << 4;
  if ((event.buttons ?? 0) & 4) flags |= 1 << 5;
  if ((event.buttons ?? 0) & 2) flags |= 1 << 6;
  return flags;
}

function BrowserDetailPanel({
  view,
  busy,
  value,
  developerState: developer,
  annotations,
  annotationText,
  annotationSelector,
  providerId,
  onAnnotationText,
  onAnnotationSelector,
  onProviderId,
  onSaveAnnotation,
  onDeleteAnnotation,
  onFillCredential,
  onSignIn,
  onClearSession,
  onClearAll,
  onClose,
}: {
  view: "snapshot" | "developer" | "annotations" | "session";
  busy: boolean;
  value: unknown;
  developerState: BrowserDeveloperState | null;
  annotations: BrowserAnnotation[];
  annotationText: string;
  annotationSelector: string;
  providerId: string;
  onAnnotationText: (value: string) => void;
  onAnnotationSelector: (value: string) => void;
  onProviderId: (value: string) => void;
  onSaveAnnotation: () => void;
  onDeleteAnnotation: (id: string) => void;
  onFillCredential: () => void;
  onSignIn: () => void;
  onClearSession: () => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const title = {
    snapshot: "页面快照",
    developer: "开发检查",
    annotations: "页面标注",
    session: "登录与浏览器数据",
  }[view];
  return (
    <section className="browser-detail-panel" aria-label={title}>
      <header>
        <strong>{title}</strong>
        {busy ? <LoaderCircle className="spin" size={13} /> : null}
        <span />
        <IconButton icon={X} label={`关闭${title}`} onClick={onClose} />
      </header>
      {view === "snapshot" ? <VisualSnapshotValue value={value} /> : null}
      {view === "developer" ? (
        <div className="browser-developer-grid">
          <BrowserDeveloperList
            title="控制台"
            values={developer?.console ?? []}
          />
          <BrowserDeveloperList
            title="网络"
            values={developer?.network ?? []}
          />
        </div>
      ) : null}
      {view === "annotations" ? (
        <div className="browser-annotations">
          <div className="browser-annotation-form">
            <input
              value={annotationSelector}
              onChange={(event) => onAnnotationSelector(event.target.value)}
              placeholder="CSS 选择器（可选）"
              aria-label="标注选择器"
            />
            <textarea
              value={annotationText}
              onChange={(event) => onAnnotationText(event.target.value)}
              placeholder="记录页面问题或反馈"
              aria-label="标注内容"
            />
            <button
              type="button"
              disabled={busy || !annotationText.trim()}
              onClick={onSaveAnnotation}
            >
              保存标注
            </button>
          </div>
          <div className="browser-annotation-list">
            {annotations.length === 0 ? <p>当前页面还没有标注。</p> : null}
            {annotations.map((annotation) => (
              <article key={annotation.id}>
                <span>
                  <strong>{annotation.text}</strong>
                  <small>{annotation.selector || annotation.url}</small>
                </span>
                <IconButton
                  icon={Trash2}
                  label="删除标注"
                  onClick={() => onDeleteAnnotation(annotation.id)}
                />
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {view === "session" ? (
        <div className="browser-session-tools">
          <label>
            <span>Provider ID</span>
            <input
              value={providerId}
              onChange={(event) => onProviderId(event.target.value)}
            />
          </label>
          <div>
            <button type="button" onClick={onSignIn}>
              打开登录页
            </button>
            <button type="button" onClick={onFillCredential}>
              填充已保存凭据
            </button>
            <button type="button" onClick={onClearSession}>
              清除当前会话
            </button>
            <button className="is-danger" type="button" onClick={onClearAll}>
              清除全部浏览器数据
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function VisualSnapshotValue({ value }: { value: unknown }) {
  const imageBase64 =
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).imageBase64 === "string"
      ? (value as Record<string, string>).imageBase64
      : null;
  if (!imageBase64) return <pre>{formatDeveloperValue(value)}</pre>;
  return (
    <div className="browser-visual-detail">
      <img
        src={`data:image/png;base64,${imageBase64}`}
        alt="页面视觉快照"
        draggable={false}
      />
    </div>
  );
}

function BrowserDeveloperList({
  title,
  values,
}: {
  title: string;
  values: BrowserDeveloperState["console"];
}) {
  return (
    <section>
      <strong>{title}</strong>
      {values.length === 0 ? <p>暂无记录</p> : null}
      {values.map((value, index) => (
        <pre key={`${title}-${index}`}>{formatDeveloperValue(value)}</pre>
      ))}
    </section>
  );
}

function developerState(value: unknown): BrowserDeveloperState | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  return {
    url: typeof source.url === "string" ? source.url : "",
    console: Array.isArray(source.console)
      ? (source.console as BrowserDeveloperState["console"])
      : [],
    network: Array.isArray(source.network)
      ? (source.network as BrowserDeveloperState["network"])
      : [],
  };
}

function formatDeveloperValue(value: unknown): string {
  if (value === null || value === undefined) return "暂无数据";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(
      value,
      (_key, child) => (typeof child === "bigint" ? child.toString() : child),
      2,
    );
  } catch {
    return String(value);
  }
}
