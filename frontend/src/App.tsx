import {
  ArrowLeft,
  ArrowRight,
  Archive,
  Bell,
  ChevronDown,
  Command,
  FolderOpen,
  GitFork,
  ListFilter,
  LogIn,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pin,
  ShieldCheck,
  WifiOff,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Composer } from "./components/Composer";
import { IconButton } from "./components/IconButton";
import { PrimaryViewPage } from "./components/PrimaryViewPage";
import { SettingsCenter } from "./components/SettingsCenter";
import { Sidebar } from "./components/Sidebar";
import { SubagentPanel } from "./components/SubagentPanel";
import { Timeline } from "./components/Timeline";
import { TerminalPane } from "./components/tools/TerminalPane";
import { UtilityPane } from "./components/UtilityPane";
import { parseDeepLinkActions } from "./lib/deepLinks";
import { desktopClient } from "./lib/desktopClient";
import { runtimeIssuePresentation } from "./lib/runtimeIssue";
import {
  clamp,
  DEFAULT_SIDEBAR_WIDTH,
  maximumSidebarWidth,
  maximumUtilityWidth,
  MINIMUM_SIDEBAR_WIDTH,
  MINIMUM_UTILITY_WIDTH,
} from "./lib/layoutResize";
import { useWorkbenchStore } from "./store/workbenchStore";
import type { PrimaryView, ThreadSummary } from "./types";

export function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelMounted, setBottomPanelMounted] = useState(false);
  const [utilityExpanded, setUtilityExpanded] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState<string | null>(null);
  const preferences = useWorkbenchStore((state) => state.preferences);
  const savePreferences = useWorkbenchStore((state) => state.savePreferences);
  const [sidebarWidthOverride, setSidebarWidth] = useState<number | null>(null);
  const [utilityWidthOverride, setUtilityWidth] = useState<number | null>(null);
  const [terminalHeightOverride, setTerminalHeight] = useState<number | null>(
    null,
  );
  const utilityWidth = utilityWidthOverride ?? preferences.utilityWidth;
  const layoutUtilityWidth =
    utilityWidthOverride ??
    (preferences.utilityWidth === 560 ? null : preferences.utilityWidth);
  const terminalHeight = terminalHeightOverride ?? preferences.terminalHeight;
  const initialized = useWorkbenchStore((state) => state.initialized);
  const loading = useWorkbenchStore((state) => state.loading);
  const error = useWorkbenchStore((state) => state.error);
  const runtimeRetrying = useWorkbenchStore((state) => state.runtimeRetrying);
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const threads = useWorkbenchStore((state) => state.threadList.threads);
  const primaryView = useWorkbenchStore((state) => state.primaryView);
  const utilityOpen = useWorkbenchStore((state) => state.utilityOpen);
  const toolView = useWorkbenchStore((state) => state.toolView);
  const setPrimaryView = useWorkbenchStore((state) => state.setPrimaryView);
  const setToolView = useWorkbenchStore((state) => state.setToolView);
  const setSettingsOpen = useWorkbenchStore((state) => state.setSettingsOpen);
  const initialize = useWorkbenchStore((state) => state.initialize);
  const reconnectRuntime = useWorkbenchStore((state) => state.reconnectRuntime);
  const selectThread = useWorkbenchStore((state) => state.selectThread);
  const refreshThreads = useWorkbenchStore((state) => state.refreshThreads);
  const newTask = useWorkbenchStore((state) => state.newTask);
  const runtimeIssue = error ? runtimeIssuePresentation(error) : null;
  const sidebarMaximum = maximumSidebarWidth(
    window.innerWidth,
    utilityOpen,
    toolView,
    utilityWidth,
  );
  const sidebarWidth = clamp(
    sidebarWidthOverride ?? preferences.sidebarWidth,
    MINIMUM_SIDEBAR_WIDTH,
    sidebarMaximum,
  );

  const showBottomPanel = useCallback(() => {
    setBottomPanelMounted(true);
    setBottomPanelOpen(true);
  }, []);
  const toggleBottomPanel = useCallback(() => {
    setBottomPanelOpen((open) => {
      const next = !open;
      if (next) setBottomPanelMounted(true);
      return next;
    });
  }, []);
  const applyDeepLink = useCallback((payload: unknown) => {
    const store = useWorkbenchStore.getState();
    for (const action of parseDeepLinkActions(payload)) {
      switch (action.kind) {
        case "task":
          store.setPrimaryView("tasks");
          void store.selectThread(action.threadId);
          break;
        case "new-task":
          store.newTask(action.cwd);
          break;
        case "settings":
          store.setSettingsOpen(true, action.route);
          break;
        case "plugins":
          store.setPrimaryView("plugins");
          store.setUtilityOpen(false);
          break;
        case "connector-oauth":
          store.setPrimaryView("plugins");
          store.setUtilityOpen(false);
          void desktopClient
            .completeConnectorOauth({
              state: action.state,
              code: action.code ?? null,
              error: action.error ?? null,
            })
            .then(() => {
              window.dispatchEvent(new Event("onpeople:extensions-refresh"));
            })
            .catch((error) => {
              console.error("Connector OAuth callback failed", error);
              window.dispatchEvent(
                new CustomEvent("onpeople:connector-oauth-error", {
                  detail: error,
                }),
              );
            });
          break;
      }
    }
  }, []);

  const beginSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const separator = event.currentTarget;
    const pointerId = event.pointerId;
    let nextWidth = sidebarWidth;
    let latestX = event.clientX;
    let frame: number | null = null;
    const render = () => {
      frame = null;
      nextWidth = Math.round(
        clamp(
          latestX,
          MINIMUM_SIDEBAR_WIDTH,
          maximumSidebarWidth(
            window.innerWidth,
            utilityOpen,
            toolView,
            utilityWidth,
          ),
        ),
      );
      shellRef.current?.style.setProperty("--sidebar-width", `${nextWidth}px`);
      separator.setAttribute("aria-valuenow", String(nextWidth));
    };
    const move = (pointer: PointerEvent) => {
      latestX = pointer.clientX;
      if (frame === null) frame = window.requestAnimationFrame(render);
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.type === "pointerup") latestX = pointer.clientX;
      if (frame !== null) window.cancelAnimationFrame(frame);
      render();
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      if (separator.hasPointerCapture(pointerId)) {
        separator.releasePointerCapture(pointerId);
      }
      document.documentElement.classList.remove(
        "is-panel-resizing",
        "is-column-resizing",
        "is-sidebar-resizing",
      );
      window.dispatchEvent(new Event("onpeople:layout-resize-end"));
      setSidebarWidth(nextWidth);
      void savePreferences({ ...preferences, sidebarWidth: nextWidth }).then(
        () => setSidebarWidth(nextWidth),
      );
    };
    separator.setPointerCapture(pointerId);
    document.documentElement.classList.add(
      "is-panel-resizing",
      "is-column-resizing",
      "is-sidebar-resizing",
    );
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, { capture: true, once: true });
    window.addEventListener("pointercancel", finish, {
      capture: true,
      once: true,
    });
  };

  const beginUtilityResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const separator = event.currentTarget;
    const pointerId = event.pointerId;
    let nextWidth = utilityWidth;
    let latestX = event.clientX;
    let frame: number | null = null;
    const render = () => {
      frame = null;
      const maximum = maximumUtilityWidth(
        window.innerWidth,
        sidebarOpen,
        sidebarWidth,
      );
      nextWidth = Math.round(
        clamp(window.innerWidth - latestX, MINIMUM_UTILITY_WIDTH, maximum),
      );
      shellRef.current?.style.setProperty("--utility-width", `${nextWidth}px`);
      separator.setAttribute("aria-valuenow", String(nextWidth));
    };
    const move = (pointer: PointerEvent) => {
      latestX = pointer.clientX;
      if (frame === null) frame = window.requestAnimationFrame(render);
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.type === "pointerup") latestX = pointer.clientX;
      if (frame !== null) window.cancelAnimationFrame(frame);
      render();
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      if (separator.hasPointerCapture(pointerId)) {
        separator.releasePointerCapture(pointerId);
      }
      document.documentElement.classList.remove(
        "is-panel-resizing",
        "is-column-resizing",
      );
      window.dispatchEvent(new Event("onpeople:layout-resize-end"));
      setUtilityWidth(nextWidth);
      void savePreferences({ ...preferences, utilityWidth: nextWidth }).then(
        () => setUtilityWidth(nextWidth),
      );
    };
    separator.setPointerCapture(pointerId);
    document.documentElement.classList.add(
      "is-panel-resizing",
      "is-column-resizing",
    );
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, { capture: true, once: true });
    window.addEventListener("pointercancel", finish, {
      capture: true,
      once: true,
    });
  };

  const beginTerminalResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    let nextHeight = terminalHeight;
    const move = (pointer: PointerEvent) => {
      nextHeight = Math.round(
        Math.min(
          window.innerHeight - 180,
          Math.max(180, window.innerHeight - pointer.clientY),
        ),
      );
      setTerminalHeight(nextHeight);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      document.documentElement.classList.remove(
        "is-panel-resizing",
        "is-row-resizing",
      );
      void savePreferences({ ...preferences, terminalHeight: nextHeight }).then(
        () => setTerminalHeight(null),
      );
    };
    document.documentElement.classList.add(
      "is-panel-resizing",
      "is-row-resizing",
    );
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  const selectedThread = threads.find(
    (thread) => thread.id === selectedThreadId,
  );
  const title = selectedThread?.title || viewTitle(primaryView);
  const selectedThreadIndex = selectedThread
    ? threads.findIndex((thread) => thread.id === selectedThread.id)
    : -1;
  const olderThread =
    selectedThreadIndex >= 0 ? threads[selectedThreadIndex + 1] : undefined;
  const newerThread =
    selectedThreadIndex > 0 ? threads[selectedThreadIndex - 1] : undefined;

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    // Let the native shell repair visibility as soon as React has mounted.
    // Waiting for the full data bootstrap can leave WKWebView in hidden state
    // when the app was launched from a background workspace.
    void desktopClient.frontendReady().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    void desktopClient.frontendReady().catch(() => undefined);
    let active = true;
    void desktopClient
      .activateDeepLinks()
      .then((urls) => {
        if (active && urls.length > 0) applyDeepLink({ urls });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [applyDeepLink, initialized]);

  useEffect(() => {
    const threadId = new URLSearchParams(window.location.search).get("thread");
    if (!threadId || !initialized) return;
    void useWorkbenchStore.getState().selectThread(threadId);
  }, [initialized]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        useWorkbenchStore.getState().newTask();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleBottomPanel();
      }
      if (event.ctrlKey && !event.metaKey && event.key === "`") {
        event.preventDefault();
        toggleBottomPanel();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        if (
          event.target instanceof Element &&
          event.target.closest(".terminal-host")
        ) {
          return;
        }
        event.preventDefault();
        document
          .querySelector<HTMLTextAreaElement>("[aria-label='任务输入']")
          ?.focus();
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setTaskMenuOpen(false);
        setUtilityExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSettingsOpen, toggleBottomPanel]);

  useEffect(() => {
    const closeTaskMenuWhenFocusMovesAway = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (
        event.target.closest(
          ".task-menu, .task-title-button, [aria-label='任务操作']",
        )
      ) {
        return;
      }
      setTaskMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeTaskMenuWhenFocusMovesAway);
    return () =>
      window.removeEventListener(
        "pointerdown",
        closeTaskMenuWhenFocusMovesAway,
      );
  }, []);

  useEffect(() => {
    let active = true;
    const subscriptions = [
      desktopClient.onNewTaskRequested(() => {
        useWorkbenchStore.getState().newTask();
      }),
      desktopClient.onAppMenuAction(({ action }) => {
        const store = useWorkbenchStore.getState();
        switch (action) {
          case "settings":
            store.setSettingsOpen(true, "general");
            break;
          case "check-updates":
            store.setSettingsOpen(true, "general");
            void desktopClient.checkForAppUpdate();
            break;
          case "new-window":
            void desktopClient.openTaskWindow(store.selectedThreadId);
            break;
          case "new-chat":
            store.newTask();
            break;
          case "open-folder":
            void desktopClient.pickProject().then((projectPath) => {
              if (!projectPath) return;
              useWorkbenchStore.getState().newTask(projectPath);
            });
            break;
          case "toggle-sidebar":
            setSidebarOpen((open) => !open);
            break;
          case "toggle-bottom-panel":
            toggleBottomPanel();
            break;
          case "toggle-summary":
            if (store.utilityOpen && store.toolView === "activity") {
              store.setUtilityOpen(false);
            } else {
              store.setToolView("activity");
            }
            break;
          case "open-terminal":
            showBottomPanel();
            break;
          case "toggle-files":
            store.setToolView("files");
            break;
          case "toggle-review":
            store.setToolView("git");
            break;
          case "browser":
            store.setToolView("browser");
            break;
          case "find":
            setCommandOpen(true);
            break;
          case "previous-chat":
          case "back":
            void selectAdjacentThread(1);
            break;
          case "next-chat":
          case "forward":
            void selectAdjacentThread(-1);
            break;
          case "keyboard-shortcuts":
            store.setSettingsOpen(true, "shortcuts");
            break;
          case "troubleshooting":
            store.setSettingsOpen(true, "environment");
            break;
          case "task-manager":
            store.setToolView("manage");
            break;
        }
      }),
      desktopClient.onCommandPalette(() => setCommandOpen(true)),
      desktopClient.onDeepLink(applyDeepLink),
    ];

    void Promise.all(subscriptions).then((unlisten) => {
      if (!active) unlisten.forEach((stop) => stop());
    });
    return () => {
      active = false;
      void Promise.all(subscriptions).then((unlisten) =>
        unlisten.forEach((stop) => stop()),
      );
    };
  }, [applyDeepLink, showBottomPanel, toggleBottomPanel]);

  useEffect(() => {
    if (utilityOpen) return;
    const reset = window.setTimeout(() => setUtilityExpanded(false), 0);
    return () => window.clearTimeout(reset);
  }, [utilityOpen]);

  useEffect(() => {
    // The embedded browser page is a native surface, so it needs one update
    // after React commits and another after the expanded/collapsed layout has
    // settled. This keeps the page below its tabs and address bar.
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event("onpeople:layout-resize-end"));
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [utilityExpanded, utilityOpen, toolView]);

  useEffect(() => {
    const runCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: unknown }>).detail;
      if (typeof detail?.command !== "string" || !detail.command.trim()) return;
      setTerminalCommand(detail.command);
      showBottomPanel();
    };
    const openTerminal = () => {
      setTerminalCommand(null);
      showBottomPanel();
    };
    window.addEventListener("onpeople:terminal-command", runCommand);
    window.addEventListener("onpeople:open-terminal", openTerminal);
    return () => {
      window.removeEventListener("onpeople:terminal-command", runCommand);
      window.removeEventListener("onpeople:open-terminal", openTerminal);
    };
  }, [showBottomPanel]);

  return (
    <div
      ref={shellRef}
      className={`app-shell ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"} ${utilityOpen ? "utility-visible" : "utility-hidden"} ${toolView === "activity" ? "utility-summary" : "utility-detail"} ${utilityExpanded ? "utility-expanded" : "utility-collapsed"} ${bottomPanelOpen ? "terminal-visible" : "terminal-hidden"}`}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--utility-width":
            layoutUtilityWidth === null ? undefined : `${layoutUtilityWidth}px`,
          "--terminal-height": `${terminalHeight}px`,
        } as CSSProperties
      }
    >
      {sidebarOpen ? <Sidebar /> : null}
      {sidebarOpen ? (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={MINIMUM_SIDEBAR_WIDTH}
          aria-valuemax={sidebarMaximum}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onDoubleClick={() => {
            const next = clamp(
              DEFAULT_SIDEBAR_WIDTH,
              MINIMUM_SIDEBAR_WIDTH,
              sidebarMaximum,
            );
            setSidebarWidth(next);
            void savePreferences({ ...preferences, sidebarWidth: next });
          }}
          onPointerDown={beginSidebarResize}
          onKeyDown={(event) => {
            const delta =
              event.key === "ArrowLeft"
                ? -16
                : event.key === "ArrowRight"
                  ? 16
                  : 0;
            if (!delta) return;
            event.preventDefault();
            const next = clamp(
              sidebarWidth + delta,
              MINIMUM_SIDEBAR_WIDTH,
              sidebarMaximum,
            );
            setSidebarWidth(next);
            void savePreferences({ ...preferences, sidebarWidth: next });
          }}
        />
      ) : null}
      <div className="column-resize-shield" aria-hidden="true" />
      <main className="main-column">
        <header className="topbar">
          {!sidebarOpen ? (
            <IconButton
              icon={PanelLeft}
              label="展开侧栏"
              onClick={() => setSidebarOpen(true)}
            />
          ) : null}
          <div className="history-buttons" aria-label="导航历史">
            <IconButton
              icon={ArrowLeft}
              label="上一个对话"
              disabled={!olderThread}
              onClick={() => olderThread && void selectThread(olderThread.id)}
            />
            <IconButton
              icon={ArrowRight}
              label="下一个对话"
              disabled={!newerThread}
              onClick={() => newerThread && void selectThread(newerThread.id)}
            />
          </div>
          <button
            className="task-title-button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={taskMenuOpen}
            onClick={() => setTaskMenuOpen((value) => !value)}
          >
            <span>{title}</span>
            <ChevronDown size={13} />
          </button>
          <IconButton
            icon={MoreHorizontal}
            label="任务操作"
            active={taskMenuOpen}
            onClick={() => setTaskMenuOpen((value) => !value)}
          />
          {taskMenuOpen ? (
            <TaskMenu
              thread={selectedThread}
              onClose={() => setTaskMenuOpen(false)}
              onRefresh={refreshThreads}
              onNewTask={newTask}
            />
          ) : null}
          <span className="topbar-spacer" />
          {!utilityOpen ? (
            <>
              <IconButton
                icon={ListFilter}
                label="打开命令面板"
                onClick={() => setCommandOpen(true)}
              />
              <IconButton
                icon={PanelBottom}
                label="打开终端"
                active={bottomPanelOpen}
                onClick={toggleBottomPanel}
              />
              <IconButton
                icon={PanelRight}
                label="打开工具舱"
                onClick={() => setToolView("activity")}
              />
            </>
          ) : null}
        </header>

        {primaryView === "tasks" ? (
          <>
            <div className="workspace-scroll">
              {loading && !initialized ? (
                <div className="loading-state">
                  <span className="loading-spinner" />
                  正在连接桌面服务
                </div>
              ) : null}
              {error && runtimeIssue ? (
                <div
                  className={`runtime-warning is-${runtimeIssue.kind}`}
                  role="status"
                >
                  {runtimeIssue.kind === "account" ? (
                    <LogIn size={16} aria-hidden="true" />
                  ) : (
                    <WifiOff size={16} aria-hidden="true" />
                  )}
                  <div className="runtime-warning-copy">
                    <strong>{runtimeIssue.title}</strong>
                    <span>{runtimeIssue.description}</span>
                    {runtimeIssue.kind !== "account" ? (
                      <div className="runtime-recovery-proof">
                        <ShieldCheck size={12} aria-hidden="true" />
                        <span>任务记录和本地文件已保留</span>
                        {runtimeIssue.kind === "connection" ? (
                          <code>WS 优先 · HTTP 备用</code>
                        ) : null}
                      </div>
                    ) : null}
                    {runtimeIssue.description !== error ? (
                      <details>
                        <summary>技术详情</summary>
                        <code>{error}</code>
                      </details>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={
                      runtimeIssue.kind !== "account" && runtimeRetrying
                    }
                    onClick={() => {
                      if (runtimeIssue.kind === "account") {
                        window.dispatchEvent(
                          new Event("onpeople:open-account-auth"),
                        );
                        return;
                      }
                      void reconnectRuntime();
                    }}
                  >
                    {runtimeIssue.kind !== "account" && runtimeRetrying
                      ? "正在连接"
                      : runtimeIssue.actionLabel}
                  </button>
                </div>
              ) : null}
              <Timeline />
            </div>
            <SubagentPanel />
            <Composer />
          </>
        ) : (
          <PrimaryViewPage
            view={primaryView}
            onBack={() => setPrimaryView("tasks")}
          />
        )}
      </main>
      {utilityOpen && toolView !== "activity" && !utilityExpanded ? (
        <div
          className="utility-resizer"
          role="separator"
          aria-label="调整工具舱宽度"
          aria-orientation="vertical"
          aria-valuemin={MINIMUM_UTILITY_WIDTH}
          aria-valuemax={maximumUtilityWidth(
            window.innerWidth,
            sidebarOpen,
            sidebarWidth,
          )}
          aria-valuenow={utilityWidth}
          tabIndex={0}
          onPointerDown={beginUtilityResize}
          onKeyDown={(event) => {
            const delta =
              event.key === "ArrowLeft"
                ? 24
                : event.key === "ArrowRight"
                  ? -24
                  : 0;
            if (!delta) return;
            event.preventDefault();
            const next = Math.min(
              Math.max(
                MINIMUM_UTILITY_WIDTH,
                maximumUtilityWidth(
                  window.innerWidth,
                  sidebarOpen,
                  sidebarWidth,
                ),
              ),
              Math.max(MINIMUM_UTILITY_WIDTH, utilityWidth + delta),
            );
            setUtilityWidth(next);
            void savePreferences({ ...preferences, utilityWidth: next }).then(
              () => setUtilityWidth(next),
            );
          }}
        />
      ) : null}
      {utilityOpen ? (
        <UtilityPane
          expanded={utilityExpanded}
          bottomPanelOpen={bottomPanelOpen}
          onToggleExpanded={() => setUtilityExpanded((expanded) => !expanded)}
          onToggleBottomPanel={toggleBottomPanel}
        />
      ) : null}
      {bottomPanelMounted ? (
        <section
          className={`bottom-panel ${bottomPanelOpen ? "" : "is-hidden"}`}
          aria-label="底部面板"
          aria-hidden={!bottomPanelOpen}
        >
          <div
            className="bottom-panel-resizer"
            role="separator"
            aria-label="调整终端高度"
            aria-orientation="horizontal"
            aria-valuemin={180}
            aria-valuemax={Math.max(180, window.innerHeight - 180)}
            aria-valuenow={terminalHeight}
            tabIndex={0}
            onPointerDown={beginTerminalResize}
            onKeyDown={(event) => {
              const delta =
                event.key === "ArrowUp"
                  ? 24
                  : event.key === "ArrowDown"
                    ? -24
                    : 0;
              if (!delta) return;
              event.preventDefault();
              const next = Math.min(
                window.innerHeight - 180,
                Math.max(180, terminalHeight + delta),
              );
              setTerminalHeight(next);
              void savePreferences({
                ...preferences,
                terminalHeight: next,
              }).then(() => setTerminalHeight(null));
            }}
          />
          <header className="bottom-panel-header">
            <strong>终端</strong>
            <span />
            <IconButton
              icon={X}
              label="关闭底部面板"
              onClick={() => setBottomPanelOpen(false)}
            />
          </header>
          <div className="bottom-panel-content">
            <TerminalPane
              command={terminalCommand}
              onCommandSent={() => setTerminalCommand(null)}
            />
          </div>
        </section>
      ) : null}
      <SettingsCenter />
      {commandOpen ? (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          onOpenTerminal={showBottomPanel}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onToggleUtility={() => {
            const store = useWorkbenchStore.getState();
            if (store.utilityOpen) store.setUtilityOpen(false);
            else store.setToolView("activity");
          }}
        />
      ) : null}
    </div>
  );
}

async function selectAdjacentThread(offset: -1 | 1) {
  const store = useWorkbenchStore.getState();
  const index = store.threadList.threads.findIndex(
    (thread) => thread.id === store.selectedThreadId,
  );
  const target = store.threadList.threads[index + offset];
  if (target) await store.selectThread(target.id);
}

function TaskMenu({
  thread,
  onClose,
  onRefresh,
  onNewTask,
}: {
  thread: ThreadSummary | undefined;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNewTask: (cwd?: string) => void;
}) {
  const run = async (action: () => Promise<unknown>) => {
    onClose();
    await action();
    await onRefresh();
  };

  return (
    <div className="task-menu" role="menu" aria-label="任务操作">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onNewTask();
        }}
      >
        <Command size={14} />
        新对话
        <kbd>⌘ N</kbd>
      </button>
      {thread ? (
        <>
          <div className="task-menu-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(() => desktopClient.pinThread(thread.id, !thread.pinned))
            }
          >
            <Pin size={14} />
            {thread.pinned ? "取消置顶" : "置顶对话"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(() => desktopClient.markThreadUnread(thread.id, true))
            }
          >
            <Bell size={14} />
            标记为未读
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void run(() => desktopClient.forkThread(thread.id))}
          >
            <GitFork size={14} />
            派生新对话
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(() => desktopClient.revealThread(thread.id))
            }
          >
            <FolderOpen size={14} />
            在访达中显示
          </button>
          <div className="task-menu-separator" />
          <button
            className="is-danger"
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              void desktopClient.archiveThread(thread.id).then(async () => {
                onNewTask(thread.cwd);
                await onRefresh();
              });
            }}
          >
            <Archive size={14} />
            归档对话
          </button>
        </>
      ) : null}
    </div>
  );
}

function viewTitle(view: PrimaryView): string {
  switch (view) {
    case "pull-requests":
      return "拉取请求";
    case "sites":
      return "站点";
    case "scheduled":
      return "已安排";
    case "plugins":
      return "插件";
    default:
      return "新对话";
  }
}

function CommandPalette({
  onClose,
  onOpenTerminal,
  onToggleSidebar,
  onToggleUtility,
}: {
  onClose: () => void;
  onOpenTerminal: () => void;
  onToggleSidebar: () => void;
  onToggleUtility: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actions = useMemo(
    () => [
      {
        id: "new-task",
        group: "任务",
        label: "新对话",
        hint: "⌘ N",
        keywords: "聊天 task chat",
        run: () => useWorkbenchStore.getState().newTask(),
      },
      {
        id: "quick-chat",
        group: "任务",
        label: "在新窗口中快速聊天",
        hint: "窗口",
        keywords: "新窗口 quick chat window",
        run: () => void desktopClient.openTaskWindow(),
      },
      {
        id: "open-folder",
        group: "任务",
        label: "打开文件夹",
        hint: "最近",
        keywords: "文件夹 工程 folder workspace project",
        run: async () => {
          const projectPath = await desktopClient.pickProject();
          if (!projectPath) return;
          useWorkbenchStore.getState().newTask(projectPath);
        },
      },
      {
        id: "pull-requests",
        group: "工作区",
        label: "打开拉取请求",
        hint: "工作区",
        keywords: "PR review pull request 审查",
        run: () => {
          const store = useWorkbenchStore.getState();
          store.setPrimaryView("pull-requests");
          store.setUtilityOpen(false);
        },
      },
      {
        id: "sites",
        group: "工作区",
        label: "打开站点",
        hint: "工作区",
        keywords: "site 网站 页面",
        run: () => {
          const store = useWorkbenchStore.getState();
          store.setPrimaryView("sites");
          store.setUtilityOpen(false);
        },
      },
      {
        id: "scheduled",
        group: "工作区",
        label: "打开已安排任务",
        hint: "工作区",
        keywords: "计划 定时 scheduler automation",
        run: () => {
          const store = useWorkbenchStore.getState();
          store.setPrimaryView("scheduled");
          store.setUtilityOpen(false);
        },
      },
      {
        id: "plugins",
        group: "工作区",
        label: "打开插件",
        hint: "工作区",
        keywords: "plugin MCP 扩展",
        run: () => {
          const store = useWorkbenchStore.getState();
          store.setPrimaryView("plugins");
          store.setUtilityOpen(false);
        },
      },
      {
        id: "browser",
        group: "工具",
        label: "打开浏览器",
        hint: "工具",
        keywords: "browser web 网页",
        run: () => useWorkbenchStore.getState().setToolView("browser"),
      },
      {
        id: "terminal",
        group: "工具",
        label: "打开终端",
        hint: "⌘ J",
        keywords: "terminal shell 命令行",
        run: onOpenTerminal,
      },
      {
        id: "git",
        group: "工具",
        label: "查看 Git 变更",
        hint: "工具",
        keywords: "review diff 版本控制",
        run: () => useWorkbenchStore.getState().setToolView("git"),
      },
      {
        id: "files",
        group: "工具",
        label: "打开项目文件",
        hint: "工具",
        keywords: "files tree 文件树",
        run: () => useWorkbenchStore.getState().setToolView("files"),
      },
      {
        id: "activity",
        group: "工具",
        label: "打开任务输出",
        hint: "工具舱",
        keywords: "activity output summary 来源 子智能体",
        run: () => useWorkbenchStore.getState().setToolView("activity"),
      },
      {
        id: "task-manager",
        group: "工具",
        label: "打开任务管理器",
        hint: "管理",
        keywords: "process runtime diagnostics 进程 诊断",
        run: () => useWorkbenchStore.getState().setToolView("manage"),
      },
      {
        id: "toggle-sidebar",
        group: "界面",
        label: "切换侧栏",
        hint: "界面",
        keywords: "sidebar 显示 隐藏",
        run: onToggleSidebar,
      },
      {
        id: "toggle-utility",
        group: "界面",
        label: "切换工具舱",
        hint: "界面",
        keywords: "utility summary 输出 右栏 显示 隐藏",
        run: onToggleUtility,
      },
      {
        id: "settings",
        group: "设置与帮助",
        label: "打开设置",
        hint: "⌘ ,",
        keywords: "settings preferences 常规",
        run: () => useWorkbenchStore.getState().setSettingsOpen(true),
      },
      {
        id: "models",
        group: "设置与帮助",
        label: "管理模型与提供商",
        hint: "设置",
        keywords: "model provider API 模型",
        run: () => useWorkbenchStore.getState().setSettingsOpen(true, "models"),
      },
      {
        id: "connections",
        group: "设置与帮助",
        label: "管理连接与 MCP",
        hint: "设置",
        keywords: "connections mcp integrations 连接 集成",
        run: () =>
          useWorkbenchStore.getState().setSettingsOpen(true, "connections"),
      },
      {
        id: "shortcuts",
        group: "设置与帮助",
        label: "查看键盘快捷键",
        hint: "设置",
        keywords: "keyboard shortcuts hotkeys 快捷键",
        run: () =>
          useWorkbenchStore.getState().setSettingsOpen(true, "shortcuts"),
      },
      {
        id: "troubleshooting",
        group: "设置与帮助",
        label: "打开环境与故障排除",
        hint: "诊断",
        keywords: "environment troubleshooting logs 日志 故障",
        run: () =>
          useWorkbenchStore.getState().setSettingsOpen(true, "environment"),
      },
    ],
    [onOpenTerminal, onToggleSidebar, onToggleUtility],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = actions.filter((action) => {
    if (!normalizedQuery) return true;
    return `${action.label} ${action.group} ${action.keywords}`
      .toLowerCase()
      .includes(normalizedQuery);
  });

  const runAction = (index: number) => {
    const action = filtered[index];
    if (!action) return;
    onClose();
    void action.run();
  };

  let visibleGroup = "";
  return (
    <div className="command-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-input">
          <Command size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="搜索命令"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  filtered.length ? (index + 1) % filtered.length : 0,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  filtered.length
                    ? (index - 1 + filtered.length) % filtered.length
                    : 0,
                );
              } else if (event.key === "Home") {
                event.preventDefault();
                setSelectedIndex(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setSelectedIndex(Math.max(0, filtered.length - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                runAction(selectedIndex);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="command-results" aria-label="命令结果">
          {filtered.length ? (
            filtered.map((action, index) => {
              const showGroup = action.group !== visibleGroup;
              visibleGroup = action.group;
              return (
                <div className="command-result" key={action.id}>
                  {showGroup ? (
                    <div className="command-group-label">{action.group}</div>
                  ) : null}
                  <button
                    type="button"
                    className={index === selectedIndex ? "is-selected" : ""}
                    aria-current={index === selectedIndex ? "true" : undefined}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => runAction(index)}
                  >
                    <span>{action.label}</span>
                    <small>{action.hint}</small>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="command-empty">没有匹配的命令</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RootApp() {
  return <App />;
}
