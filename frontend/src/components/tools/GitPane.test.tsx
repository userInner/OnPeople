import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../../lib/desktopClient";
import { useWorkbenchStore } from "../../store/workbenchStore";
import type { GitState } from "../../types";
import { GitPane } from "./GitPane";

vi.mock("../../lib/desktopClient", () => ({
  desktopClient: {
    gitState: vi.fn(),
    gitDiff: vi.fn(),
    getGitHunks: vi.fn(),
    mutateGit: vi.fn(),
    mutateGitHunk: vi.fn(),
    pushGit: vi.fn(),
    preparePullRequest: vi.fn(),
    startReview: vi.fn(),
    submitReviewComments: vi.fn(),
    openExternalUrl: vi.fn(),
    initGitRepository: vi.fn(),
    commitGit: vi.fn(),
  },
}));

const gitState: GitState = {
  repository: true,
  root: "/workspace",
  branch: "feature",
  upstream: "origin/feature",
  ahead: 1,
  behind: 0,
  files: [
    {
      path: "src/demo.ts",
      indexStatus: " ",
      worktreeStatus: "M",
      untracked: false,
    },
  ],
};

describe("GitPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbenchStore.setState({
      selectedThreadId: "thread-main",
      threadList: { threads: [], projects: [] },
      draftCwd: "/workspace",
      selectThread: vi.fn().mockResolvedValue(undefined),
      refreshThreads: vi.fn().mockResolvedValue(undefined),
      setToolView: vi.fn(),
      status: {
        ready: true,
        runtime: "codex-app-server",
        version: "0.30.0",
        defaultCwd: "/workspace",
        windowThreadId: "thread-main",
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
    vi.mocked(desktopClient.gitState).mockResolvedValue(gitState);
    vi.mocked(desktopClient.gitDiff).mockResolvedValue({
      path: "src/demo.ts",
      text: "@@ -1 +1 @@\n-old\n+new",
      truncated: false,
    });
    vi.mocked(desktopClient.getGitHunks).mockResolvedValue({
      hunks: [
        {
          id: "unstaged-0",
          header: "@@ -1 +1 @@",
          text: "-old\n+new",
          patch:
            "diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n",
          staged: false,
        },
      ],
    });
    vi.mocked(desktopClient.mutateGitHunk).mockResolvedValue(gitState);
    vi.mocked(desktopClient.openExternalUrl).mockResolvedValue({
      opened: true,
    });
  });

  it("stages an individual diff hunk", async () => {
    render(<GitPane />);
    const fileName = await screen.findByText("src/demo.ts");
    const file = fileName.closest("button");
    expect(file).not.toBeNull();
    fireEvent.click(file!);

    await screen.findByText("@@ -1 +1 @@");
    fireEvent.click(screen.getByRole("button", { name: "暂存此块" }));

    await waitFor(() =>
      expect(desktopClient.mutateGitHunk).toHaveBeenCalledWith({
        cwd: "/workspace",
        path: "src/demo.ts",
        action: "stage",
        patch:
          "diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n",
      }),
    );
  });

  it("starts a native Codex review with the selected target", async () => {
    vi.mocked(desktopClient.startReview).mockResolvedValue({
      threadId: "review-thread",
      turnId: "review-turn",
    });
    render(<GitPane />);

    await screen.findByText("src/demo.ts");
    fireEvent.click(screen.getByRole("combobox", { name: "代码审阅目标" }));
    fireEvent.click(screen.getByRole("option", { name: "与基础分支比较" }));
    fireEvent.change(screen.getByLabelText("代码审阅目标值"), {
      target: { value: "release/1.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始审阅" }));

    await waitFor(() =>
      expect(desktopClient.startReview).toHaveBeenCalledWith({
        threadId: "thread-main",
        cwd: "/workspace",
        targetType: "baseBranch",
        value: "release/1.0",
      }),
    );
    expect(useWorkbenchStore.getState().selectThread).toHaveBeenCalledWith(
      "review-thread",
    );
  });

  it("opens the generated GitHub compare URL in the system browser", async () => {
    vi.mocked(desktopClient.preparePullRequest).mockResolvedValue({
      url: "https://github.com/openai/codex/compare/main...feature?expand=1",
      title: "Review work",
      branch: "feature",
      base: "origin/main",
    });
    render(<GitPane />);

    await screen.findByText("src/demo.ts");
    fireEvent.click(screen.getByRole("button", { name: "准备拉取请求" }));

    await waitFor(() =>
      expect(desktopClient.openExternalUrl).toHaveBeenCalledWith(
        "https://github.com/openai/codex/compare/main...feature?expand=1",
      ),
    );
  });

  it("sends line-level review comments with path, line and side", async () => {
    vi.mocked(desktopClient.submitReviewComments).mockResolvedValue({
      threadId: "thread-main",
      turnId: "turn-comments",
    });
    render(<GitPane />);
    const fileName = await screen.findByText("src/demo.ts");
    fireEvent.click(fileName.closest("button")!);

    const commentButtons = await screen.findAllByRole("button", {
      name: "评论 src/demo.ts:1",
    });
    fireEvent.click(commentButtons[0]!);
    fireEvent.change(screen.getByLabelText("输入 src/demo.ts:1 的审阅意见"), {
      target: { value: "请保留旧行为的兼容测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加意见" }));
    fireEvent.click(
      screen.getByRole("button", { name: "发送审阅意见给 Codex" }),
    );

    await waitFor(() =>
      expect(desktopClient.submitReviewComments).toHaveBeenCalledWith({
        threadId: "thread-main",
        cwd: "/workspace",
        comments: [
          {
            path: "src/demo.ts",
            line: 1,
            side: "old",
            code: "-old",
            body: "请保留旧行为的兼容测试",
          },
        ],
      }),
    );
  });
});
