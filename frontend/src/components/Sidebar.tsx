import {
  Archive,
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  GitFork,
  GitPullRequest,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { desktopClient } from "../lib/desktopClient";
import { numberedThreadShortcuts } from "../lib/threadShortcuts";
import { useWorkbenchStore } from "../store/workbenchStore";
import type { PrimaryView, ThreadSummary } from "../types";
import { AccountAuthPopover } from "./AccountAuthPopover";
import { IconButton } from "./IconButton";

type SidebarContextMenu =
  | { kind: "thread"; thread: ThreadSummary; x: number; y: number }
  | {
      kind: "project";
      project: {
        path: string;
        name: string;
        pinned: boolean;
        threadCount: number;
      };
      x: number;
      y: number;
    };

const primaryLinks: Array<{
  id: Exclude<PrimaryView, "tasks">;
  label: string;
  icon: typeof GitPullRequest;
}> = [
  { id: "pull-requests", label: "拉取请求", icon: GitPullRequest },
  { id: "scheduled", label: "已安排", icon: CalendarClock },
  { id: "plugins", label: "插件", icon: Puzzle },
];

export function Sidebar() {
  const threads = useWorkbenchStore((state) => state.threadList.threads);
  const projects = useWorkbenchStore((state) => state.threadList.projects);
  const draftCwd = useWorkbenchStore((state) => state.draftCwd);
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const threadActivity = useWorkbenchStore((state) => state.threadActivity);
  const search = useWorkbenchStore((state) => state.search);
  const primaryView = useWorkbenchStore((state) => state.primaryView);
  const scheduler = useWorkbenchStore((state) => state.scheduler);
  const showingArchived = useWorkbenchStore((state) => state.showingArchived);
  const selectThread = useWorkbenchStore((state) => state.selectThread);
  const setSearch = useWorkbenchStore((state) => state.setSearch);
  const setPrimaryView = useWorkbenchStore((state) => state.setPrimaryView);
  const setShowingArchived = useWorkbenchStore(
    (state) => state.setShowingArchived,
  );
  const setSettingsOpen = useWorkbenchStore((state) => state.setSettingsOpen);
  const setToolView = useWorkbenchStore((state) => state.setToolView);
  const setUtilityOpen = useWorkbenchStore((state) => state.setUtilityOpen);
  const newTask = useWorkbenchStore((state) => state.newTask);
  const refreshThreads = useWorkbenchStore((state) => state.refreshThreads);
  const reconnectRuntime = useWorkbenchStore((state) => state.reconnectRuntime);
  const cloudAccount = useWorkbenchStore((state) => state.cloudAccount);
  const accountStatus = useWorkbenchStore((state) => state.accountStatus);
  const setCloudAccount = useWorkbenchStore((state) => state.setCloudAccount);
  const [searchOpen, setSearchOpen] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [menuOpen, setMenuOpen] = useState<
    "project" | "account" | "brand" | null
  >(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(
    null,
  );

  useEffect(() => {
    const openAccountAuth = () => {
      setMenuOpen(null);
      setAuthOpen(true);
    };
    window.addEventListener("onpeople:open-account-auth", openAccountAuth);
    return () =>
      window.removeEventListener("onpeople:open-account-auth", openAccountAuth);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".sidebar-context-menu")
      ) {
        return;
      }
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!menuOpen && !authOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".brand-switcher, .project-switcher, .account-button, .sidebar-popup, .project-switcher-popover, .project-rail, .account-auth-popover",
        )
      ) {
        return;
      }
      setMenuOpen(null);
      setAuthOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(null);
        setAuthOpen(false);
      }
    };
    const closeOnBlur = () => setMenuOpen(null);
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [authOpen, menuOpen]);

  const activityStatus = (thread: ThreadSummary) =>
    threadActivity[thread.id] ?? thread.status;
  const visibleThreads = attentionOnly
    ? threads.filter(
        (thread) =>
          thread.unread ||
          ["working", "waiting-approval", "waiting-input"].includes(
            activityStatus(thread),
          ),
      )
    : threads;
  const selectedThread = selectedThreadId
    ? threads.find((thread) => thread.id === selectedThreadId)
    : undefined;
  const activeProjectPath =
    selectedThread?.projectPath ??
    selectedThread?.cwd ??
    draftCwd ??
    projects.find((project) => !project.hidden)?.path ??
    null;
  const addProject = async () => {
    const path = await desktopClient.pickProject();
    if (!path) return;
    await desktopClient.updateProject(path, "add");
    await refreshThreads();
    newTask(path);
  };

  const openPrimary = (view: Exclude<PrimaryView, "tasks">) => {
    setPrimaryView(view);
    setUtilityOpen(false);
  };

  const signedIn = accountStatus === "signed-in";
  const account =
    cloudAccount?.account && typeof cloudAccount.account === "object"
      ? (cloudAccount.account as Record<string, unknown>)
      : null;
  const accountName =
    (typeof account?.name === "string" && account.name) ||
    (typeof account?.email === "string" && account.email) ||
    "OnPeople";

  return (
    <aside className="sidebar codex-sidebar" aria-label="任务导航">
      <header className="codex-sidebar-header">
        <button
          className="brand-switcher"
          type="button"
          aria-label="OnPeople"
          aria-haspopup="menu"
          aria-expanded={menuOpen === "brand"}
          onClick={() => {
            setAuthOpen(false);
            setMenuOpen((value) => (value === "brand" ? null : "brand"));
          }}
        >
          <span>OnPeople</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {menuOpen === "brand" ? (
          <SidebarPopup
            placement="top"
            onClose={() => setMenuOpen(null)}
            onSettings={() => setSettingsOpen(true)}
            onManage={() => setToolView("manage")}
          />
        ) : null}
        <div className="codex-sidebar-actions">
          <IconButton
            icon={Search}
            label="搜索任务"
            active={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
          />
          <IconButton
            icon={Bell}
            label={attentionOnly ? "显示全部任务" : "需要关注"}
            active={attentionOnly}
            onClick={() => setAttentionOnly((value) => !value)}
          />
        </div>
      </header>
      <div className="codex-primary-nav" aria-label="主要功能">
        <button
          className="codex-new-thread"
          type="button"
          onClick={() => newTask()}
        >
          <MessageSquarePlus size={16} aria-hidden="true" />
          <span>新对话</span>
          <kbd>⌘ ⇧ N</kbd>
        </button>
        {primaryLinks.map(({ id, label, icon: Icon }) => (
          <button
            className={primaryView === id ? "is-active" : ""}
            type="button"
            key={id}
            onClick={() => openPrimary(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            {id === "scheduled" && scheduler.unread > 0 ? (
              <em>{scheduler.unread}</em>
            ) : null}
          </button>
        ))}
      </div>
      {searchOpen ? (
        <label className="sidebar-search codex-search project-rail-search">
          <Search size={15} aria-hidden="true" />
          <input
            autoFocus
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索任务"
            aria-label="搜索任务"
          />
        </label>
      ) : null}
      <div className="codex-project-host">
        <ProjectSwitcherPopover
          projects={projects}
          activeProjectPath={activeProjectPath}
          selectedThreadId={selectedThreadId}
          showThreadSelection={primaryView === "tasks"}
          onClose={() => undefined}
          onSelect={(path) => {
            setShowingArchived(false);
            newTask(path);
          }}
          onSelectThread={(threadId) => {
            setShowingArchived(false);
            void selectThread(threadId);
          }}
          onThreadMenu={(thread, x, y) =>
            setContextMenu({ kind: "thread", thread, x, y })
          }
          threads={visibleThreads}
          onProjectActions={(project, x, y) => {
            setContextMenu({
              kind: "project",
              project: {
                path: project.path,
                name: project.name,
                pinned: project.pinned,
                threadCount: project.threadCount,
              },
              x,
              y,
            });
          }}
          onAddProject={addProject}
          allThreads={threads}
        />
        {search.trim() && visibleThreads.length === 0 ? (
          <div className="project-rail-empty project-rail-search-empty">
            没有匹配的任务
          </div>
        ) : null}
      </div>

      <footer className="sidebar-account">
        <button
          type="button"
          className="account-button"
          data-account-state={accountStatus}
          aria-haspopup={signedIn ? "menu" : "dialog"}
          aria-expanded={signedIn ? menuOpen === "account" : authOpen}
          aria-label={signedIn ? `账户 ${accountName}` : "登录或注册 OnPeople"}
          title={signedIn ? `账户 ${accountName}` : "登录或注册 OnPeople"}
          onClick={() => {
            if (signedIn) {
              setAuthOpen(false);
              setMenuOpen((value) => (value === "account" ? null : "account"));
            } else {
              setMenuOpen(null);
              setAuthOpen((value) => !value);
            }
          }}
        >
          <span className={`account-avatar${signedIn ? "" : " is-signed-out"}`}>
            {signedIn ? accountName.slice(0, 2).toUpperCase() : "OP"}
          </span>
          <span className="account-copy">
            <strong>
              {signedIn
                ? accountName
                : accountStatus === "loading"
                  ? "正在检查账户"
                  : accountStatus === "expired"
                    ? "重新登录"
                    : "登录或注册"}
            </strong>
            <small>
              {signedIn
                ? "已登录"
                : accountStatus === "expired"
                  ? "登录已过期，重新验证后继续"
                  : accountStatus === "unavailable"
                    ? "登录服务暂时不可用"
                    : "使用 OnPeople 账户"}
            </small>
          </span>
          {signedIn ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {!signedIn && authOpen ? (
          <AccountAuthPopover
            onClose={() => setAuthOpen(false)}
            onSuccess={(value) => {
              setCloudAccount(value);
              setAuthOpen(false);
              void reconnectRuntime();
            }}
          />
        ) : null}
        {signedIn && menuOpen === "account" ? (
          <SidebarPopup
            placement="bottom"
            onClose={() => setMenuOpen(null)}
            onSettings={() => setSettingsOpen(true)}
            onManage={() => setToolView("manage")}
          />
        ) : null}
      </footer>
      {contextMenu?.kind === "thread" ? (
        <ThreadContextMenu
          menu={contextMenu}
          showingArchived={showingArchived}
          onClose={() => setContextMenu(null)}
          onRefresh={refreshThreads}
          onSelect={(threadId) => void selectThread(threadId)}
          onNewTask={newTask}
          selectedThreadId={selectedThreadId}
        />
      ) : null}
      {contextMenu?.kind === "project" ? (
        <ProjectContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRefresh={refreshThreads}
        />
      ) : null}
    </aside>
  );
}

function ProjectSwitcherPopover({
  projects,
  activeProjectPath,
  selectedThreadId,
  showThreadSelection,
  onClose,
  onSelect,
  onSelectThread,
  onThreadMenu,
  threads,
  onProjectActions,
  onAddProject,
  allThreads,
}: {
  projects: Array<{
    path: string;
    name: string;
    pinned: boolean;
    hidden: boolean;
    threadCount: number;
    archivedThreadCount: number;
    updatedAt: string;
  }>;
  activeProjectPath: string | null;
  selectedThreadId: string | null;
  showThreadSelection: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  onSelectThread: (threadId: string) => void;
  onThreadMenu: (thread: ThreadSummary, x: number, y: number) => void;
  threads: ThreadSummary[];
  allThreads: ThreadSummary[];
  onProjectActions: (
    project: (typeof projects)[number],
    x: number,
    y: number,
  ) => void;
  onAddProject: () => Promise<void>;
}) {
  const threadActivity = useWorkbenchStore((state) => state.threadActivity);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleProjects = projects.filter((project) => !project.hidden);
  const pinnedProjects = visibleProjects.filter((project) => project.pinned);
  const regularProjects = visibleProjects.filter((project) => !project.pinned);
  const visibleProjectPaths = new Set(
    visibleProjects.map((project) => project.path),
  );
  const pinnedThreads = numberedThreadShortcuts(allThreads);
  const recentThreads = [...threads]
    .filter(
      (thread) =>
        threadSidebarSection(thread, visibleProjectPaths) === "recent",
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8);
  const projectRows = showAllProjects
    ? regularProjects
    : regularProjects.slice(0, 5);
  const projectThreads = (projectPath: string) =>
    threads
      .filter(
        (thread) =>
          threadSidebarSection(thread, visibleProjectPaths) === "project" &&
          (thread.projectPath ?? thread.cwd) === projectPath,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 3);

  const renderThreadActivity = (thread: ThreadSummary) => {
    const status = threadActivity[thread.id] ?? thread.status;
    if (
      status !== "working" &&
      status !== "waiting-approval" &&
      status !== "waiting-input" &&
      status !== "error"
    ) {
      return null;
    }
    return (
      <span
        className={`project-rail-thread-status is-${status}`}
        title={
          status === "working"
            ? "运行中"
            : status === "waiting-approval"
              ? "等待审批"
              : status === "waiting-input"
                ? "等待输入"
                : "运行失败"
        }
        aria-hidden="true"
      />
    );
  };

  const hasThreadActivity = (thread: ThreadSummary) => {
    const status = threadActivity[thread.id] ?? thread.status;
    return (
      status === "working" ||
      status === "waiting-approval" ||
      status === "waiting-input" ||
      status === "error"
    );
  };

  const renderProject = (project: (typeof visibleProjects)[number]) => {
    const projectOpen = !collapsedProjects.has(project.path);
    const projectThreadRows = projectThreads(project.path);

    return (
      <div
        className="project-rail-project"
        key={project.path}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onProjectActions(project, event.clientX, event.clientY);
        }}
      >
        <div className="project-rail-project-row-shell">
          <button
            className="project-rail-project-row"
            type="button"
            role="menuitem"
            onClick={() => onSelect(project.path)}
          >
            <Folder size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>{project.name}</span>
          </button>
          <button
            className="project-rail-project-menu"
            type="button"
            aria-label={`项目菜单：${project.name}`}
            onClick={(event) => {
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              onProjectActions(project, bounds.right + 6, bounds.top + 2);
            }}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
          <button
            className="project-rail-project-toggle"
            type="button"
            aria-label={
              projectOpen ? `收起 ${project.name}` : `展开 ${project.name}`
            }
            aria-expanded={projectOpen}
            onClick={() =>
              setCollapsedProjects((current) => {
                const next = new Set(current);
                if (projectOpen) next.add(project.path);
                else next.delete(project.path);
                return next;
              })
            }
          >
            {projectOpen ? (
              <ChevronDown size={15} />
            ) : (
              <ChevronRight size={15} />
            )}
          </button>
        </div>
        {projectOpen ? (
          <div className="project-rail-thread-list">
            {projectThreadRows.map((thread) => (
              <button
                className={
                  showThreadSelection && thread.id === selectedThreadId
                    ? "project-rail-thread is-active"
                    : "project-rail-thread"
                }
                key={thread.id}
                type="button"
                role="menuitem"
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onThreadMenu(thread, event.clientX, event.clientY);
                }}
                onClick={() => onSelectThread(thread.id)}
              >
                <span className="project-rail-thread-title">
                  {thread.title || "新任务"}
                </span>
                {renderThreadActivity(thread)}
              </button>
            ))}
            {projectThreadRows.length === 0 ? (
              <div className="project-rail-empty">没有聊天</div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderRecentThread = (thread: ThreadSummary, shortcut?: number) => (
    <button
      className={
        showThreadSelection && thread.id === selectedThreadId
          ? "project-rail-recent-thread is-active"
          : "project-rail-recent-thread"
      }
      key={thread.id}
      type="button"
      role="menuitem"
      title={thread.title || "新任务"}
      onContextMenu={(event) => {
        event.preventDefault();
        onThreadMenu(thread, event.clientX, event.clientY);
      }}
      onClick={() => onSelectThread(thread.id)}
    >
      <span className="project-rail-thread-title">
        {thread.title || "新任务"}
      </span>
      {renderThreadActivity(thread)}
      {shortcut && !hasThreadActivity(thread) ? (
        <kbd>{`⌘${shortcut}`}</kbd>
      ) : null}
    </button>
  );

  return (
    <div className="project-rail" role="menu" aria-label="切换项目">
      <div className="project-rail-section project-rail-section-collapsed">
        <button
          className="project-rail-section-heading"
          type="button"
          onClick={() => setPinnedOpen((value) => !value)}
          aria-expanded={pinnedOpen}
        >
          <span>置顶</span>
          {pinnedOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </button>
        {pinnedOpen ? (
          <div className="project-rail-section-body">
            {pinnedProjects.length > 0 || pinnedThreads.length > 0 ? (
              <>
                {pinnedProjects.map(renderProject)}
                {pinnedThreads.map((thread, index) =>
                  renderRecentThread(thread, index + 1),
                )}
              </>
            ) : (
              <div className="project-rail-empty">暂无置顶任务</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="project-rail-section project-rail-projects-section">
        <div className="project-rail-section-heading-row">
          <button
            className="project-rail-section-heading"
            type="button"
            onClick={() => setProjectsOpen((value) => !value)}
            aria-expanded={projectsOpen}
          >
            <span>项目</span>
            {projectsOpen ? (
              <ChevronDown size={17} />
            ) : (
              <ChevronRight size={17} />
            )}
          </button>
          <button
            className="project-rail-action"
            type="button"
            aria-label="项目操作"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (activeProjectPath) {
                const project = projects.find(
                  (item) => item.path === activeProjectPath,
                );
                if (project) {
                  onProjectActions(
                    project,
                    bounds.right + 4,
                    bounds.bottom + 4,
                  );
                }
              }
            }}
          >
            <MoreHorizontal size={18} />
          </button>
          <button
            className="project-rail-action"
            type="button"
            aria-label="添加项目"
            onClick={() => void onAddProject().then(onClose)}
          >
            <Plus size={19} />
          </button>
        </div>
        {projectsOpen ? (
          <div className="project-rail-section-body">
            {projectRows.length > 0 ? (
              projectRows.map(renderProject)
            ) : (
              <div className="project-switcher-empty">还没有添加项目</div>
            )}
            {regularProjects.length > 5 ? (
              <button
                className="project-rail-expand"
                type="button"
                onClick={() => setShowAllProjects((value) => !value)}
              >
                {showAllProjects ? "收起显示" : "展开显示"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="project-rail-section project-rail-recent-section">
        <button
          className="project-rail-section-heading"
          type="button"
          onClick={() => setRecentOpen((value) => !value)}
          aria-expanded={recentOpen}
        >
          <span>最近</span>
          {recentOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </button>
        {recentOpen ? (
          <div className="project-rail-section-body project-rail-recent-list">
            {recentThreads.length > 0 ? (
              recentThreads.map(renderRecentThread)
            ) : (
              <div className="project-rail-empty">还没有最近任务</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Exported for the section-membership unit tests; this module otherwise exports UI.
// eslint-disable-next-line react-refresh/only-export-components
export function threadSidebarSection(
  thread: Pick<ThreadSummary, "pinned" | "projectPath" | "cwd">,
  visibleProjectPaths: ReadonlySet<string>,
): "pinned" | "project" | "recent" {
  if (thread.pinned) return "pinned";
  const path = thread.projectPath ?? thread.cwd;
  return path && visibleProjectPaths.has(path) ? "project" : "recent";
}

function SidebarPopup({
  placement,
  onClose,
  onSettings,
  onManage,
}: {
  placement: "top" | "bottom";
  onClose: () => void;
  onSettings: () => void;
  onManage: () => void;
}) {
  const act = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <div
      className={`sidebar-popup sidebar-popup-${placement}`}
      role="menu"
      aria-label="OnPeople 菜单"
    >
      <button type="button" role="menuitem" onClick={() => act(onSettings)}>
        <Settings size={14} />
        设置
        <kbd>⌘ ,</kbd>
      </button>
      <button type="button" role="menuitem" onClick={() => act(onManage)}>
        <Puzzle size={14} />
        扩展与运行时
      </button>
    </div>
  );
}

function ThreadContextMenu({
  menu,
  showingArchived,
  onClose,
  onRefresh,
  onSelect,
  onNewTask,
  selectedThreadId,
}: {
  menu: Extract<SidebarContextMenu, { kind: "thread" }>;
  showingArchived: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSelect: (threadId: string) => void;
  onNewTask: (cwd?: string) => void;
  selectedThreadId: string | null;
}) {
  const { thread } = menu;
  const run = async (action: () => Promise<unknown>, refresh = true) => {
    onClose();
    await action();
    if (refresh) await onRefresh();
  };
  const rename = async () => {
    const name = window.prompt("重命名任务", thread.title || "未命名任务");
    if (!name?.trim() || name.trim() === thread.title) return;
    await run(() => desktopClient.renameThread(thread.id, name.trim()));
  };
  const archive = async () => {
    await run(() =>
      showingArchived
        ? desktopClient.unarchiveThread(thread.id)
        : desktopClient.archiveThread(thread.id),
    );
    if (!showingArchived && selectedThreadId === thread.id)
      onNewTask(thread.cwd);
  };
  const fork = async () => {
    onClose();
    const result = await desktopClient.forkThread(thread.id);
    await onRefresh();
    const id = stringField(result, "threadId") ?? stringField(result, "id");
    if (id) onSelect(id);
  };

  return (
    <ContextMenuFrame menu={menu} label={`任务操作：${thread.title}`}>
      {showingArchived ? (
        <ContextMenuButton
          icon={RotateCcw}
          label="恢复任务"
          onClick={archive}
        />
      ) : (
        <>
          <ContextMenuButton
            icon={Pin}
            label={thread.pinned ? "取消置顶任务" : "置顶任务"}
            onClick={() =>
              void run(() => desktopClient.pinThread(thread.id, !thread.pinned))
            }
          />
          <ContextMenuButton
            icon={Pencil}
            label="重命名任务"
            onClick={rename}
          />
          <ContextMenuButton
            icon={Archive}
            label="归档任务"
            onClick={() => void archive()}
          />
          <ContextMenuButton
            icon={Bell}
            label={thread.unread ? "标记为已读" : "标记为未读"}
            onClick={() =>
              void run(() =>
                desktopClient.markThreadUnread(thread.id, !thread.unread),
              )
            }
          />
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuButton
        icon={Folder}
        label="在访达中显示"
        disabled={!thread.cwd}
        onClick={() =>
          void run(() => desktopClient.revealThread(thread.id), false)
        }
      />
      <ContextMenuButton
        icon={Copy}
        label="复制工作目录"
        disabled={!thread.cwd}
        onClick={() =>
          void run(() => desktopClient.copyText(thread.cwd), false)
        }
      />
      <ContextMenuButton
        icon={Copy}
        label="复制会话 ID"
        onClick={() => void run(() => desktopClient.copyText(thread.id), false)}
      />
      <ContextMenuButton
        icon={ExternalLink}
        label="复制深度链接"
        onClick={() =>
          void run(
            () => desktopClient.copyText(`onpeople://task/${thread.id}`),
            false,
          )
        }
      />
      <ContextMenuSeparator />
      <ContextMenuButton
        icon={ExternalLink}
        label="在新窗口中打开"
        onClick={() =>
          void run(() => desktopClient.openTaskWindow(thread.id), false)
        }
      />
      {!showingArchived ? (
        <ContextMenuButton
          icon={GitFork}
          label="创建分叉"
          onClick={() => void fork()}
        />
      ) : null}
    </ContextMenuFrame>
  );
}

function ProjectContextMenu({
  menu,
  onClose,
  onRefresh,
}: {
  menu: Extract<SidebarContextMenu, { kind: "project" }>;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { project } = menu;
  const run = async (action: () => Promise<unknown>) => {
    onClose();
    await action();
    await onRefresh();
  };
  const rename = async () => {
    const name = window.prompt("重命名项目", project.name);
    if (!name?.trim() || name.trim() === project.name) return;
    await run(() =>
      desktopClient.updateProject(project.path, "rename", name.trim()),
    );
  };
  const archive = async () => {
    if (
      !window.confirm(
        `归档“${project.name}”中的 ${project.threadCount} 个任务？项目文件不会被修改。`,
      )
    ) {
      return;
    }
    await run(() => desktopClient.archiveProjectTasks(project.path));
  };
  const remove = async () => {
    if (!window.confirm(`从侧栏移除“${project.name}”？项目文件不会被删除。`)) {
      return;
    }
    await run(() => desktopClient.updateProject(project.path, "remove"));
  };

  return (
    <ContextMenuFrame menu={menu} label={`项目操作：${project.name}`}>
      <ContextMenuButton
        icon={Pin}
        label={project.pinned ? "取消置顶项目" : "置顶项目"}
        onClick={() =>
          void run(() =>
            desktopClient.updateProject(project.path, "pin", !project.pinned),
          )
        }
      />
      <ContextMenuButton
        icon={Folder}
        label="在 Finder 中显示"
        onClick={() =>
          void run(() => desktopClient.revealProject(project.path))
        }
      />
      <ContextMenuButton icon={Pencil} label="编辑项目" onClick={rename} />
      <ContextMenuButton
        icon={Archive}
        label="归档聊天"
        disabled={project.threadCount < 1}
        onClick={() => void archive()}
      />
      <ContextMenuButton
        icon={Trash2}
        label="移除"
        danger
        onClick={() => void remove()}
      />
    </ContextMenuFrame>
  );
}

function ContextMenuFrame({
  menu,
  label,
  children,
}: {
  menu: SidebarContextMenu;
  label: string;
  children: ReactNode;
}) {
  const left = Math.max(8, Math.min(window.innerWidth - 242, menu.x));
  const menuHeight = menu.kind === "project" ? 260 : 430;
  const top = Math.max(8, Math.min(window.innerHeight - menuHeight, menu.y));
  return (
    <div
      className="sidebar-context-menu"
      role="menu"
      aria-label={label}
      style={{ left, top }}
    >
      {children}
    </div>
  );
}

function ContextMenuButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Folder;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={danger ? "is-danger" : ""}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function ContextMenuSeparator() {
  return <div className="sidebar-context-separator" role="separator" />;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  if (typeof field === "string" && field) return field;
  const thread = value.thread;
  if (typeof thread === "object" && thread !== null) {
    const nested = (thread as Record<string, unknown>)[
      key === "threadId" ? "id" : key
    ];
    if (typeof nested === "string" && nested) return nested;
  }
  return null;
}
