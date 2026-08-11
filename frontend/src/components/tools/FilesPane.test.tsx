import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
