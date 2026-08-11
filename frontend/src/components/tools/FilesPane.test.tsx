import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../../lib/desktopClient";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { FilesPane } from "./FilesPane";

vi.mock("../../lib/desktopClient", () => ({
  desktopClient: {
    listProjectFiles: vi.fn(),
    searchProjectFiles: vi.fn(),
    openWorkspaceFile: vi.fn(),
    openEditor: vi.fn(),
    copyText: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("FilesPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbenchStore.setState({
      selectedThreadId: "thread-project",
      draftCwd: null,
      threadList: {
        threads: [
          {
            id: "thread-project",
            title: "Project task",
            cwd: "/workspace/project",
            projectPath: "/workspace/project",
            status: "idle",
            pinned: false,
            archived: false,
            unread: false,
            model: null,
            reasoningEffort: null,
            workspaceMode: "local",
            workspaceBaseCwd: "/workspace/project",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        projects: [],
      },
      status: {
        ready: true,
        runtime: "codex-app-server",
        version: "0.30.0",
        defaultCwd: "/workspace/default",
        windowThreadId: "thread-project",
        goal: null,
        provider: {
          kind: "onpeople",
          name: "OnPeople",
          protocol: "responses",
          baseUrl: "",
          model: "gpt-5.6",
          vision: true,
          apiKeySet: true,
          extra: {},
        },
        policy: {
          sandbox: "workspace-write",
          approvalPolicy: "on-request",
          reviewer: "user",
          network: true,
          multiAgent: true,
          maxConcurrentAgents: 4,
        },
        capabilities: {},
      },
    });
    vi.mocked(desktopClient.listProjectFiles).mockImplementation(
      async (_cwd, relative) =>
        relative === "src"
          ? [
              {
                name: "main.ts",
                path: "src/main.ts",
                kind: "file",
                size: 20n,
                modifiedAt: null,
                hidden: false,
              },
            ]
          : [
              {
                name: "src",
                path: "src",
                kind: "directory",
                size: null,
                modifiedAt: null,
                hidden: false,
              },
            ],
    );
    vi.mocked(desktopClient.searchProjectFiles).mockResolvedValue({
      entries: [],
      truncated: false,
    });
    vi.mocked(desktopClient.openWorkspaceFile).mockResolvedValue({
      name: "main.ts",
      path: "src/main.ts",
      absolutePath: "/workspace/project/src/main.ts",
      kind: "text",
      mimeType: "text/typescript",
      size: 20,
      content: "export const ready = true;",
    });
    vi.mocked(desktopClient.openEditor).mockResolvedValue({ opened: true });
    vi.mocked(desktopClient.copyText).mockResolvedValue();
  });

  it("keeps directory navigation and previews files in the selected task cwd", async () => {
    render(<FilesPane />);

    fireEvent.click(await screen.findByRole("button", { name: /src/ }));
    await waitFor(() =>
      expect(desktopClient.listProjectFiles).toHaveBeenCalledWith(
        "/workspace/project",
        "src",
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: /main\.ts/ }));
    await waitFor(() =>
      expect(desktopClient.openWorkspaceFile).toHaveBeenCalledWith(
        "/workspace/project",
        "src/main.ts",
      ),
    );
    expect(screen.getByText("export const ready = true;")).toBeInTheDocument();
  });

  it("keeps the newest search result when an older request finishes later", async () => {
    const oldSearch =
      deferred<Awaited<ReturnType<typeof desktopClient.searchProjectFiles>>>();
    const newSearch =
      deferred<Awaited<ReturnType<typeof desktopClient.searchProjectFiles>>>();
    vi.mocked(desktopClient.searchProjectFiles).mockImplementation(
      async (_cwd, query) =>
        query === "old" ? oldSearch.promise : newSearch.promise,
    );

    render(<FilesPane />);
    await screen.findByRole("button", { name: /src/ });

    fireEvent.change(screen.getByLabelText("搜索文件"), {
      target: { value: "old" },
    });
    await waitFor(() =>
      expect(desktopClient.searchProjectFiles).toHaveBeenCalledWith(
        "/workspace/project",
        "old",
      ),
    );
    fireEvent.change(screen.getByLabelText("搜索文件"), {
      target: { value: "new" },
    });
    await waitFor(() =>
      expect(desktopClient.searchProjectFiles).toHaveBeenCalledWith(
        "/workspace/project",
        "new",
      ),
    );

    await act(async () => {
      newSearch.resolve({
        entries: [
          {
            name: "new.ts",
            path: "src/new.ts",
            kind: "file",
            size: 1n,
            modifiedAt: null,
            hidden: false,
          },
        ],
        truncated: false,
      });
    });
    expect(
      await screen.findByRole("button", { name: /new\.ts/ }),
    ).toBeVisible();

    await act(async () => {
      oldSearch.resolve({
        entries: [
          {
            name: "old.ts",
            path: "src/old.ts",
            kind: "file",
            size: 1n,
            modifiedAt: null,
            hidden: false,
          },
        ],
        truncated: false,
      });
    });
    expect(screen.queryByRole("button", { name: /old\.ts/ })).toBeNull();
    expect(screen.getByRole("button", { name: /new\.ts/ })).toBeVisible();
  });

  it("offers an in-place retry after the project file list fails", async () => {
    vi.mocked(desktopClient.listProjectFiles)
      .mockRejectedValueOnce(new Error("文件服务暂时不可用"))
      .mockResolvedValueOnce([
        {
          name: "src",
          path: "src",
          kind: "directory",
          size: null,
          modifiedAt: null,
          hidden: false,
        },
      ]);

    render(<FilesPane />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "文件服务暂时不可用",
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("button", { name: /src/ })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
