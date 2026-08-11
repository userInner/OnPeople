import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../lib/desktopClient";
import { useWorkbenchStore } from "../store/workbenchStore";
import { Composer } from "./Composer";
import { SubagentPanel } from "./SubagentPanel";
import { Timeline } from "./Timeline";

const originalSendPrompt = useWorkbenchStore.getState().sendPrompt;

vi.mock("../lib/desktopClient", () => ({
  desktopClient: {
    queueMessage: vi.fn(),
    deleteQueuedMessage: vi.fn(),
    steerQueuedMessage: vi.fn(),
    resolveApproval: vi.fn(),
    resolveUserInput: vi.fn(),
    interrupt: vi.fn(),
    updateGoal: vi.fn(),
    setThreadReasoningEffort: vi.fn(),
    createLiveSession: vi.fn(),
    closeLiveSession: vi.fn(),
    liveStatus: vi.fn(),
    onLiveSidebandEvent: vi.fn(),
    onLiveSidebandStatus: vi.fn(),
    pickFiles: vi.fn(),
    pasteFiles: vi.fn(),
    openLocalArtifact: vi.fn(),
    pickProject: vi.fn(),
    updateProject: vi.fn(),
    copyText: vi.fn(),
    getQuickLauncherSuggestions: vi.fn(),
    getProjectActions: vi.fn(),
    listExtensions: vi.fn(),
    activateIndustryPlugin: vi.fn(),
    deactivateIndustryPlugin: vi.fn(),
    discoverModels: vi.fn(),
    listAgents: vi.fn(),
    onAgentEvent: vi.fn(),
    readAgent: vi.fn(),
    stopAgent: vi.fn(),
  },
}));

describe("Codex conversation controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useWorkbenchStore.setState({
      sendPrompt: originalSendPrompt,
      selectedThreadId: "thread-main",
      threadLoading: false,
      timeline: [],
      queuedMessages: [],
      runtime: {
        state: "working",
        threadId: "thread-main",
        turnId: "turn-1",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
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
    vi.mocked(desktopClient.queueMessage).mockResolvedValue({
      id: "queue-1",
      threadId: "thread-main",
      text: "继续检查测试",
    });
    vi.mocked(desktopClient.deleteQueuedMessage).mockResolvedValue({
      deleted: true,
      id: "queue-1",
    });
    vi.mocked(desktopClient.steerQueuedMessage).mockResolvedValue({
      steered: true,
      id: "queue-1",
    });
    vi.mocked(desktopClient.resolveApproval).mockResolvedValue({
      requestId: "approval-1",
      decision: "accept",
    });
    vi.mocked(desktopClient.resolveUserInput).mockResolvedValue({
      requestId: "input-1",
      answered: true,
    });
    vi.mocked(desktopClient.interrupt).mockResolvedValue({});
    vi.mocked(desktopClient.getQuickLauncherSuggestions).mockResolvedValue([]);
    vi.mocked(desktopClient.getProjectActions).mockResolvedValue([]);
    vi.mocked(desktopClient.listExtensions).mockResolvedValue({
      skills: [],
      plugins: [],
      activeIndustryPlugin: null,
      mcpServers: [],
    });
    vi.mocked(desktopClient.activateIndustryPlugin).mockResolvedValue({});
    vi.mocked(desktopClient.deactivateIndustryPlugin).mockResolvedValue({});
    vi.mocked(desktopClient.discoverModels).mockResolvedValue({ models: [] });
    vi.mocked(desktopClient.pickFiles).mockResolvedValue([]);
    vi.mocked(desktopClient.pasteFiles).mockResolvedValue([]);
    vi.mocked(desktopClient.openLocalArtifact).mockResolvedValue({});
    vi.mocked(desktopClient.listAgents).mockResolvedValue({
      agents: [
        {
          id: "agent-pasteur",
          title: "Pasteur",
          role: "default",
          nickname: "Pasteur",
          status: "completed",
        },
        {
          id: "agent-kepler",
          title: "Kepler",
          role: "default",
          nickname: "Kepler",
          status: "completed",
        },
      ],
    });
    vi.mocked(desktopClient.onAgentEvent).mockResolvedValue(() => undefined);
    vi.mocked(desktopClient.readAgent).mockImplementation(async (agentId) => ({
      thread: {
        id: agentId,
        turns: [
          {
            id: `turn-${agentId}`,
            status: "completed",
            items: [
              {
                id: `command-${agentId}`,
                type: "commandExecution",
                command: ["rg", "--files"],
                status: "completed",
              },
            ],
          },
        ],
      },
      itemsPage: {
        data: [
          {
            turnId: "turn-1",
            item: {
              id: `exec-${agentId}`,
              type: "dynamicToolCall",
              tool: "exec",
              status: "completed",
              success: true,
              arguments: {
                input:
                  'const result = await tools.exec_command({cmd:"npm test",workdir:"/tmp/project"}); text(result.output);',
              },
            },
          },
        ],
      },
      legacyExecItems: [
        {
          id: `legacy-exec-${agentId}`,
          type: "dynamicToolCall",
          tool: "exec",
          status: "completed",
          success: true,
          arguments: {
            input:
              'const result = await tools.exec_command({cmd:"npm run build",workdir:"/tmp/project"}); text(result.output);',
          },
        },
      ],
    }));
    vi.mocked(desktopClient.liveStatus).mockResolvedValue({
      available: true,
      voice: "cove",
      activeCallId: null,
      message: null,
    });
    vi.mocked(desktopClient.onLiveSidebandEvent).mockResolvedValue(
      () => undefined,
    );
    vi.mocked(desktopClient.onLiveSidebandStatus).mockResolvedValue(
      () => undefined,
    );
  });

  it("queues composer input while a turn is running", async () => {
    render(<Composer />);
    fireEvent.change(screen.getByLabelText("任务输入"), {
      target: { value: "继续检查测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加入消息队列" }));

    await waitFor(() =>
      expect(desktopClient.queueMessage).toHaveBeenCalledWith(
        "继续检查测试",
        "thread-main",
      ),
    );
    expect(screen.getByLabelText("任务输入")).toHaveValue("");
    expect(useWorkbenchStore.getState().runtime?.queuedMessages).toBe(1);
    expect(useWorkbenchStore.getState().timeline).toHaveLength(0);
    expect(useWorkbenchStore.getState().queuedMessages).toEqual([
      expect.objectContaining({
        id: "queue-1",
        text: "继续检查测试",
        status: "queued",
      }),
    ]);
    expect(screen.getByText("继续检查测试")).toBeInTheDocument();
  });

  it("pauses an active goal before interrupting its current turn", async () => {
    useWorkbenchStore.setState((state) => ({
      status: state.status
        ? {
            ...state.status,
            goal: {
              id: "goal-1",
              threadId: "thread-main",
              objective: "全程你去推进",
              status: "active",
              tokenBudget: null,
              tokensUsed: 12n,
              timeUsedSeconds: 8n,
              createdAt: "2026-08-10T00:00:00.000Z",
              updatedAt: "2026-08-10T00:00:08.000Z",
            },
          }
        : state.status,
    }));
    vi.mocked(desktopClient.updateGoal).mockResolvedValue({
      id: "goal-1",
      threadId: "thread-main",
      objective: "全程你去推进",
      status: "paused",
      tokenBudget: null,
      tokensUsed: 12n,
      timeUsedSeconds: 8n,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:09.000Z",
    });

    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: "暂停目标" }));

    await waitFor(() =>
      expect(desktopClient.updateGoal).toHaveBeenCalledWith({
        threadId: "thread-main",
        action: "pause",
      }),
    );
    expect(desktopClient.interrupt).toHaveBeenCalledWith("thread-main");
    expect(
      vi.mocked(desktopClient.updateGoal).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(desktopClient.interrupt).mock.invocationCallOrder[0]!,
    );
    expect(useWorkbenchStore.getState().status?.goal?.status).toBe("paused");
  });

  it("can guide a queued message without adding timeline noise", async () => {
    useWorkbenchStore.setState({
      queuedMessages: [
        {
          id: "queue-1",
          threadId: "thread-main",
          text: "改为优先检查登录流程",
          status: "queued",
        },
      ],
    });

    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: "引导" }));

    await waitFor(() =>
      expect(desktopClient.steerQueuedMessage).toHaveBeenCalledWith(
        "queue-1",
        "thread-main",
      ),
    );
    expect(useWorkbenchStore.getState().queuedMessages).toHaveLength(0);
    expect(useWorkbenchStore.getState().timeline).toHaveLength(0);
  });

  it("does not send when WebKit emits compositionend before the IME Enter", () => {
    const sendPrompt = vi.fn().mockResolvedValue(undefined);
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: "thread-main",
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      sendPrompt,
    });

    render(<Composer />);
    const input = screen.getByLabelText("任务输入");
    fireEvent.change(input, { target: { value: "你是使用sub" } });
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(input).toHaveValue("你是使用sub");
  });

  it("sends on the next Enter when the IME Enter arrived before compositionend", () => {
    const sendPrompt = vi.fn().mockResolvedValue(undefined);
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: "thread-main",
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      sendPrompt,
    });

    render(<Composer />);
    const input = screen.getByLabelText("任务输入");
    fireEvent.change(input, { target: { value: "不对" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      keyCode: 229,
      isComposing: true,
    });
    fireEvent.compositionEnd(input);

    expect(sendPrompt).not.toHaveBeenCalled();

    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });

    expect(sendPrompt).toHaveBeenCalledWith(
      "不对",
      expect.objectContaining({ mode: "agent" }),
    );
  });

  it("shows a clean model settings menu and closes it outside", async () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: "thread-main",
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
    });

    const { container } = render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: /5\.6 Luna高/ }));

    expect(screen.getByText("推理强度")).toBeInTheDocument();
    expect(container.querySelectorAll(".model-settings-row svg")).toHaveLength(
      0,
    );

    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("推理强度")).not.toBeInTheDocument();
  });

  it("keeps the draft model selected when sending creates a new task", async () => {
    const sendPrompt = vi.fn().mockImplementation(async () => {
      useWorkbenchStore.setState({
        selectedThreadId: "thread-created",
        runtime: {
          state: "working",
          threadId: "thread-created",
          turnId: "turn-created",
          queuedMessages: 0,
          pendingApprovals: 0,
          context: null,
        },
      });
      return {
        threadId: "thread-created",
        turnId: "turn-created",
        queued: false,
      };
    });
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: null,
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      selectedThreadId: null,
      threadList: { threads: [], projects: [] },
      draftCwd: "/workspace",
      sendPrompt,
    });

    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: /5\.6 Luna高/ }));
    fireEvent.click(screen.getByRole("button", { name: /模型5\.6 Luna/ }));
    fireEvent.click(await screen.findByRole("button", { name: "GPT5.6 sol" }));
    expect(screen.getByRole("button", { name: /5\.6 Sol高/ })).toBeVisible();

    fireEvent.change(screen.getByLabelText("任务输入"), {
      target: { value: "检查界面" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        "检查界面",
        expect.objectContaining({ model: "gpt-5.6-sol" }),
      ),
    );
    expect(screen.getByRole("button", { name: /5\.6 Sol高/ })).toBeVisible();
  });

  it("switches the draft workspace from the composer footer", () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: null,
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      selectedThreadId: null,
      draftCwd: "/workspace/alpha",
      threadList: {
        threads: [],
        projects: [
          {
            path: "/workspace/alpha",
            name: "Alpha",
            pinned: false,
            hidden: false,
            threadCount: 0,
            archivedThreadCount: 0,
            updatedAt: "2026-08-07T00:00:00Z",
          },
          {
            path: "/workspace/beta",
            name: "Beta",
            pinned: false,
            hidden: false,
            threadCount: 0,
            archivedThreadCount: 0,
            updatedAt: "2026-08-07T00:00:00Z",
          },
        ],
      },
    });

    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: "选择工作空间" }));
    expect(screen.getByPlaceholderText("搜索工作空间")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Beta" }));
    expect(useWorkbenchStore.getState().draftCwd).toBe("/workspace/beta");
    expect(
      screen.getByRole("button", { name: "选择工作空间" }),
    ).toHaveTextContent("beta");
  });

  it("groups reasoning and commands into one turn activity digest", () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: "thread-main",
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      timeline: [
        {
          id: "reasoning-1",
          turnId: "turn-1",
          role: "assistant",
          kind: "reasoning",
          title: "思考过程",
          text: "先检查项目结构。",
          pending: false,
        },
        {
          id: "command-1",
          turnId: "turn-1",
          role: "tool",
          kind: "command",
          title: "运行命令",
          text: "rg --files",
          status: "已完成",
          pending: false,
        },
      ],
    });

    const view = render(<Timeline />);
    const activityHeadline = view.container.querySelector(
      ".activity-summary > summary strong",
    );
    expect(activityHeadline).toHaveTextContent("已运行 rg --files");
    expect(screen.getByText("思考过程")).not.toBeVisible();

    fireEvent.click(activityHeadline!);
    expect(screen.getByText("思考过程")).toBeVisible();
    fireEvent.click(
      view.container.querySelector(".tool-card > summary strong")!,
    );
    expect(screen.getByText("rg --files")).toBeVisible();
  });

  it("keeps completed Agent activity compact and lets the user close it", async () => {
    render(<SubagentPanel />);

    const summary = await screen.findByRole("button", {
      name: /2 个 Agent 已完成/,
    });
    expect(screen.queryByText("Pasteur")).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(screen.getByText("Pasteur")).toBeInTheDocument();
    expect(await screen.findAllByText("rg --files")).toHaveLength(2);
    expect(await screen.findAllByText("npm test")).toHaveLength(2);
    expect(await screen.findAllByText("npm run build")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "关闭 Agent 活动" }));
    expect(
      screen.queryByRole("button", { name: /2 个 Agent 已完成/ }),
    ).not.toBeInTheDocument();
  });

  it("selects an industry plugin and forwards it to the next Codex turn", async () => {
    const sendPrompt = vi.fn().mockResolvedValue(undefined);
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: null,
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      selectedThreadId: null,
      draftCwd: "/workspace",
      sendPrompt,
    });
    vi.mocked(desktopClient.listExtensions).mockResolvedValue({
      skills: [],
      plugins: [
        {
          id: "legal-review",
          name: "法务审阅",
          active: false,
        },
      ],
      activeIndustryPlugin: null,
      mcpServers: [],
    });
    vi.mocked(desktopClient.activateIndustryPlugin).mockResolvedValue({
      id: "legal-review",
      name: "法务审阅",
      active: true,
    });

    render(<Composer />);
    fireEvent.click(
      screen.getByRole("button", { name: "添加文件、技能与能力" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /法务审阅/ }));
    fireEvent.change(screen.getByLabelText("任务输入"), {
      target: { value: "审阅这份合同" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        "审阅这份合同",
        expect.objectContaining({ industryPlugin: "legal-review" }),
      ),
    );
  });

  it("selects a bundled productivity plugin for one turn", async () => {
    const sendPrompt = vi.fn().mockResolvedValue(undefined);
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: null,
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      selectedThreadId: null,
      draftCwd: "/workspace",
      sendPrompt,
    });

    render(<Composer />);
    fireEvent.click(
      screen.getByRole("button", { name: "添加文件、技能与能力" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Spreadsheets创建和分析电子表格/,
      }),
    );
    fireEvent.change(screen.getByLabelText("任务输入"), {
      target: { value: "把这些数据整理成工作簿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        "把这些数据整理成工作簿",
        expect.objectContaining({ capability: "spreadsheets" }),
      ),
    );
  });

  it("adds real local files and can send them without converting names to text", async () => {
    const sendPrompt = vi.fn().mockResolvedValue(undefined);
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: null,
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      selectedThreadId: null,
      draftCwd: "/workspace",
      sendPrompt,
    });
    vi.mocked(desktopClient.pickFiles).mockResolvedValue([
      "/Users/test/Documents/web3+defi (1).pdf",
      "/Users/test/Desktop/resume.png",
    ]);

    render(<Composer />);
    fireEvent.click(
      screen.getByRole("button", { name: "添加文件、技能与能力" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /添加文件或图片/ }));

    expect(await screen.findByText("web3+defi (1).pdf")).toBeInTheDocument();
    expect(screen.getByText("resume.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          images: ["/Users/test/Desktop/resume.png"],
          attachments: ["/Users/test/Documents/web3+defi (1).pdf"],
        }),
      ),
    );
    expect(screen.getByLabelText("任务输入")).toHaveValue("");
  });

  it("turns a Finder paste into a real attachment instead of filename text", async () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: "thread-main",
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
    });
    vi.mocked(desktopClient.pasteFiles).mockResolvedValue([
      "/Users/test/Documents/web3+defi (1).pdf",
    ]);

    render(<Composer />);
    const input = screen.getByLabelText("任务输入");
    fireEvent.paste(input, {
      clipboardData: {
        files: [new File(["pdf"], "web3+defi (1).pdf")],
        items: [{ kind: "file" }],
        types: ["Files"],
      },
    });

    expect(await screen.findByText("web3+defi (1).pdf")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("shows restored attachments as cards that preview the actual local file", () => {
    useWorkbenchStore.setState({
      timeline: [
        {
          id: "user-with-pdf",
          role: "user",
          kind: "message",
          text: "看看我的简历",
          attachments: [
            {
              kind: "file",
              name: "web3+defi (1).pdf",
              path: "/Users/test/Documents/web3+defi (1).pdf",
            },
          ],
        },
      ],
    });

    render(<Timeline />);
    fireEvent.click(
      screen.getByRole("button", { name: /web3\+defi \(1\)\.pdf/ }),
    );

    expect(useWorkbenchStore.getState().localArtifactPreview).toMatchObject({
      path: "/Users/test/Documents/web3+defi (1).pdf",
      threadId: "thread-main",
    });
    expect(useWorkbenchStore.getState().toolView).toBe("files");
  });

  it("does not inherit a persisted industry plugin in a new task", async () => {
    const sendPrompt = vi.fn().mockResolvedValue(undefined);
    useWorkbenchStore.setState({
      runtime: {
        state: "ready",
        threadId: null,
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      selectedThreadId: null,
      draftCwd: "/workspace",
      sendPrompt,
    });
    vi.mocked(desktopClient.listExtensions).mockResolvedValue({
      skills: [],
      plugins: [
        {
          id: "research-paper",
          name: "科研论文",
          active: true,
        },
      ],
      activeIndustryPlugin: {
        id: "research-paper",
        name: "科研论文",
        active: true,
      },
      mcpServers: [],
    });

    render(<Composer />);
    fireEvent.change(screen.getByLabelText("任务输入"), {
      target: { value: "普通的新任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        "普通的新任务",
        expect.objectContaining({ industryPlugin: null }),
      ),
    );
  });

  it("resolves an approval from the timeline card", async () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "waiting-approval",
        threadId: "thread-main",
        turnId: "turn-1",
        queuedMessages: 0,
        pendingApprovals: 1,
        context: null,
      },
      timeline: [
        {
          id: "approval-approval-1",
          role: "tool",
          kind: "approval",
          title: "批准命令执行",
          text: "npm test",
          meta: "item/commandExecution/requestApproval",
          requestId: "approval-1",
          approvalMethod: "item/commandExecution/requestApproval",
          status: "需要确认",
          pending: true,
        },
      ],
    });

    render(<Timeline />);
    fireEvent.click(screen.getByRole("button", { name: "允许一次" }));

    await waitFor(() =>
      expect(desktopClient.resolveApproval).toHaveBeenCalledWith(
        "approval-1",
        "accept",
      ),
    );
    await screen.findByText("已允许一次");
    expect(useWorkbenchStore.getState().runtime?.pendingApprovals).toBe(0);
  });

  it("submits a request_user_input answer and resumes the turn", async () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "waiting-input",
        threadId: "thread-main",
        turnId: "turn-1",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      timeline: [
        {
          id: "user-input-input-1",
          role: "tool",
          kind: "user-input",
          title: "Codex 需要你的输入",
          text: "选择发布方式",
          requestId: "input-1",
          status: "等待回答",
          pending: true,
          userInputQuestions: [
            {
              id: "delivery",
              header: "发布方式",
              question: "选择发布方式",
              isOther: false,
              isSecret: false,
              options: [
                { label: "本地预览", description: "只在本机打开" },
                { label: "正式发布", description: "部署到生产环境" },
              ],
            },
          ],
        },
      ],
    });

    render(<Timeline />);
    fireEvent.click(screen.getByRole("radio", { name: /本地预览/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交回答" }));

    await waitFor(() =>
      expect(desktopClient.resolveUserInput).toHaveBeenCalledWith("input-1", {
        delivery: ["本地预览"],
      }),
    );
    await screen.findByText("已回答");
    expect(useWorkbenchStore.getState().runtime?.state).toBe("working");
  });
});
