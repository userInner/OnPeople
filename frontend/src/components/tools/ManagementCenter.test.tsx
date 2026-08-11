import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../../lib/desktopClient";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { ManagementCenter } from "./ManagementCenter";

vi.mock("../../lib/desktopClient", () => ({
  desktopClient: {
    listAgents: vi.fn(),
    onAgentEvent: vi.fn(),
    scheduler: vi.fn(),
    liveStatus: vi.fn(),
    cloudAccount: vi.fn(),
    runScheduledTask: vi.fn(),
    deleteScheduledTask: vi.fn(),
    readAgent: vi.fn(),
    messageAgent: vi.fn(),
    stopAgent: vi.fn(),
    getContextState: vi.fn(),
    runtimeDiagnostics: vi.fn(),
    setGoal: vi.fn(),
    updateGoal: vi.fn(),
    steerTurn: vi.fn(),
    queueMessage: vi.fn(),
    recalibrateContext: vi.fn(),
    compactContext: vi.fn(),
    restartRuntime: vi.fn(),
  },
}));

describe("ManagementCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbenchStore.setState({
      selectedThreadId: "thread-main",
      runtime: {
        state: "ready",
        threadId: "thread-main",
        turnId: null,
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
    vi.mocked(desktopClient.listAgents).mockResolvedValue({ agents: [] });
    vi.mocked(desktopClient.onAgentEvent).mockResolvedValue(() => undefined);
    vi.mocked(desktopClient.scheduler).mockResolvedValue({
      tasks: [],
      runs: [],
      unread: 0,
    });
    vi.mocked(desktopClient.liveStatus).mockResolvedValue({
      available: true,
      voice: "cove",
      activeCallId: null,
      message: null,
    });
    vi.mocked(desktopClient.cloudAccount).mockResolvedValue({
      signedIn: false,
      serviceUrl: "https://api.aibro.vip",
      account: null,
      group: null,
      models: [],
    });
    vi.mocked(desktopClient.getContextState).mockResolvedValue({
      usage: null,
      queued: [],
      goal: null,
      checkpoint: null,
    });
    vi.mocked(desktopClient.runtimeDiagnostics).mockResolvedValue({
      state: "ready",
      pid: null,
      executable: "/runtime/codex",
      version: "0.30.0",
      restartCount: 0,
      lastStartedAt: null,
      lastExitAt: null,
      lastError: null,
      events: [],
    });
    vi.mocked(desktopClient.setGoal).mockResolvedValue({
      id: "goal-thread-main",
      threadId: "thread-main",
      objective: "完成完整验收",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0n,
      timeUsedSeconds: 0n,
      createdAt: "2026-08-05T00:00:00Z",
      updatedAt: "2026-08-05T00:00:00Z",
    });
    vi.mocked(desktopClient.steerTurn).mockResolvedValue({
      turnId: "turn-main",
    });
  });

  it("lists only Codex-native child Agents for the active task", async () => {
    vi.mocked(desktopClient.listAgents).mockResolvedValue({
      agents: [
        {
          id: "agent-thread-1",
          agentId: "agent-thread-1",
          parentThreadId: "thread-main",
          title: "explorer",
          role: "explorer",
          prompt: "检查调度器",
          status: "completed",
          source: "codex-native",
        },
      ],
    });
    const selectThread = vi.fn().mockResolvedValue(undefined);
    useWorkbenchStore.setState({ selectThread });
    render(<ManagementCenter />);
    await waitFor(() =>
      expect(desktopClient.listAgents).toHaveBeenCalledWith("thread-main"),
    );
    expect(screen.getByText("explorer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开 Agent 线程" }));
    expect(selectThread).toHaveBeenCalledWith("agent-thread-1");
  });

  it("starts a persistent goal through the Codex goal protocol", async () => {
    render(<ManagementCenter />);
    await waitFor(() =>
      expect(desktopClient.getContextState).toHaveBeenCalledWith("thread-main"),
    );

    fireEvent.change(screen.getByLabelText("持续目标"), {
      target: { value: "完成完整验收" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动目标" }));

    await waitFor(() =>
      expect(desktopClient.setGoal).toHaveBeenCalledWith({
        threadId: "thread-main",
        objective: "完成完整验收",
        tokenBudget: null,
      }),
    );
  });

  it("steers the active Codex turn with an explicit context instruction", async () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "working",
        threadId: "thread-main",
        turnId: "turn-main",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
    });
    render(<ManagementCenter />);
    await waitFor(() =>
      expect(desktopClient.getContextState).toHaveBeenCalled(),
    );

    fireEvent.change(screen.getByLabelText("上下文指令"), {
      target: { value: "先修复启动白屏" },
    });
    fireEvent.click(screen.getByRole("button", { name: /立即转向/ }));

    await waitFor(() =>
      expect(desktopClient.steerTurn).toHaveBeenCalledWith(
        "先修复启动白屏",
        "thread-main",
      ),
    );
  });
});
