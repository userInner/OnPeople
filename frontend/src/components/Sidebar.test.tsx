import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../lib/desktopClient";
import { useWorkbenchStore } from "../store/workbenchStore";
import { Sidebar, threadSidebarSection } from "./Sidebar";

vi.mock("../lib/desktopClient", () => ({
  desktopClient: {
    getCloudAccount: vi.fn(),
    onCloudAccountUpdated: vi.fn(),
  },
}));

describe("Sidebar account modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(desktopClient.getCloudAccount).mockResolvedValue({
      signedIn: false,
      serviceUrl: "",
      account: null,
      group: null,
      models: [],
    });
    vi.mocked(desktopClient.onCloudAccountUpdated).mockResolvedValue(() => {});
  });

  it("blocks and locally covers the project rail while authentication is open", () => {
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.append(appRoot);

    const view = render(<Sidebar />, { container: appRoot });
    fireEvent.click(
      screen.getByRole("button", { name: "登录或注册 OnPeople" }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.body).toHaveClass("account-auth-open");
    expect(appRoot).toHaveAttribute("inert");
    expect(
      appRoot.querySelector(".project-rail-modal-scrim"),
    ).toBeInTheDocument();

    view.unmount();
    expect(document.body).not.toHaveClass("account-auth-open");
    expect(appRoot).not.toHaveAttribute("inert");
  });

  it("does not let partial cloud events clear a signed-in account", async () => {
    let accountUpdated: ((value: unknown) => void) | null = null;
    vi.mocked(desktopClient.getCloudAccount).mockResolvedValue({
      signedIn: true,
      serviceUrl: "https://onpeople.example",
      account: { email: "person@example.com" },
      group: null,
      models: [],
    });
    vi.mocked(desktopClient.onCloudAccountUpdated).mockImplementation(
      async (handler) => {
        accountUpdated = handler;
        return () => {};
      },
    );

    render(<Sidebar />);
    expect(
      await screen.findByRole("button", {
        name: "账户 person@example.com",
      }),
    ).toBeInTheDocument();

    act(() => accountUpdated?.({ live: { active: true } }));

    expect(
      screen.getByRole("button", { name: "账户 person@example.com" }),
    ).toBeInTheDocument();
  });
});

describe("sidebar task placement", () => {
  const projects = new Set(["/workspace/project"]);

  it("assigns every task to exactly one section", () => {
    expect(
      threadSidebarSection(
        {
          pinned: true,
          projectPath: "/workspace/project",
          cwd: "/workspace/project",
        },
        projects,
      ),
    ).toBe("pinned");
    expect(
      threadSidebarSection(
        {
          pinned: false,
          projectPath: "/workspace/project",
          cwd: "/workspace/project",
        },
        projects,
      ),
    ).toBe("project");
    expect(
      threadSidebarSection(
        {
          pinned: false,
          projectPath: "/workspace/opened",
          cwd: "/workspace/opened",
        },
        projects,
      ),
    ).toBe("recent");
  });

  it("returns an unpinned task to its project or recent list", () => {
    expect(
      threadSidebarSection(
        {
          pinned: false,
          projectPath: "/workspace/project",
          cwd: "/workspace/project",
        },
        projects,
      ),
    ).toBe("project");
    expect(
      threadSidebarSection(
        { pinned: false, projectPath: null, cwd: "/workspace/opened" },
        projects,
      ),
    ).toBe("recent");
  });
});

describe("sidebar selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(desktopClient.getCloudAccount).mockResolvedValue({
      signedIn: false,
      serviceUrl: "",
      account: null,
      group: null,
      models: [],
    });
    vi.mocked(desktopClient.onCloudAccountUpdated).mockResolvedValue(() => {});
    useWorkbenchStore.setState({
      primaryView: "plugins",
      selectedThreadId: "thread-1",
      draftCwd: "/workspace/project",
      search: "",
      threadList: {
        projects: [
          {
            path: "/workspace/project",
            name: "OnPeople",
            pinned: false,
            hidden: false,
            threadCount: 1,
            archivedThreadCount: 0,
            updatedAt: "2026-08-07T00:00:00Z",
          },
        ],
        threads: [
          {
            id: "thread-1",
            title: "具体任务",
            cwd: "/workspace/project",
            projectPath: "/workspace/project",
            status: "idle",
            pinned: false,
            archived: false,
            unread: false,
            model: null,
            reasoningEffort: null,
            workspaceMode: "local",
            workspaceBaseCwd: null,
            createdAt: "2026-08-07T00:00:00Z",
            updatedAt: "2026-08-07T00:00:00Z",
          },
        ],
      },
    });
  });

  it("starts a top-level new conversation in a fresh automatic workspace", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: /新对话/ }));

    expect(useWorkbenchStore.getState().selectedThreadId).toBeNull();
    expect(useWorkbenchStore.getState().draftCwd).toBeNull();
  });

  it("shows an independent running indicator for every active task", () => {
    useWorkbenchStore.setState({
      primaryView: "tasks",
      selectedThreadId: "thread-1",
      threadActivity: {
        "thread-1": "working",
        "thread-2": "working",
      },
      threadList: {
        projects: [
          {
            path: "/workspace/project",
            name: "OnPeople",
            pinned: false,
            hidden: false,
            threadCount: 1,
            archivedThreadCount: 0,
            updatedAt: "2026-08-07T00:00:00Z",
          },
        ],
        threads: [
          {
            id: "thread-1",
            title: "前端任务",
            cwd: "/workspace/project",
            projectPath: "/workspace/project",
            status: "working",
            pinned: false,
            archived: false,
            unread: false,
            model: null,
            reasoningEffort: null,
            workspaceMode: "local",
            workspaceBaseCwd: null,
            createdAt: "2026-08-07T00:00:00Z",
            updatedAt: "2026-08-07T00:00:00Z",
          },
          {
            id: "thread-2",
            title: "后台任务",
            cwd: "/workspace/other",
            projectPath: "/workspace/other",
            status: "working",
            pinned: false,
            archived: false,
            unread: false,
            model: null,
            reasoningEffort: null,
            workspaceMode: "local",
            workspaceBaseCwd: null,
            createdAt: "2026-08-07T00:00:00Z",
            updatedAt: "2026-08-07T00:00:00Z",
          },
        ],
      },
    });

    const view = render(<Sidebar />);

    expect(
      view.container.querySelectorAll(".project-rail-thread-status.is-working"),
    ).toHaveLength(2);
    expect(
      view.container.querySelectorAll(
        ".project-rail-thread.is-active, .project-rail-recent-thread.is-active",
      ),
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll(".project-rail-recent-thread kbd"),
    ).toHaveLength(0);
  });

  it("highlights only the selected primary view or task, never the project row", () => {
    const view = render(<Sidebar />);
    const plugins = screen.getByRole("button", { name: "插件" });
    const project = screen.getByRole("menuitem", { name: "OnPeople" });
    const task = screen.getByRole("menuitem", { name: "具体任务" });
    const selectedRows = () =>
      view.container.querySelectorAll(
        ".codex-primary-nav > .is-active, .project-rail-thread.is-active, .project-rail-recent-thread.is-active",
      );

    expect(plugins).toHaveClass("is-active");
    expect(task).not.toHaveClass("is-active");
    expect(project.closest(".project-rail-project-row-shell")).not.toHaveClass(
      "is-active",
    );
    expect(selectedRows()).toHaveLength(1);

    act(() => useWorkbenchStore.setState({ primaryView: "tasks" }));

    expect(plugins).not.toHaveClass("is-active");
    expect(task).toHaveClass("is-active");
    expect(selectedRows()).toHaveLength(1);

    view.unmount();
    useWorkbenchStore.setState({
      primaryView: "tasks",
      selectedThreadId: null,
      draftCwd: null,
      threadActivity: {},
      threadList: { projects: [], threads: [] },
    });
  });
});
