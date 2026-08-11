import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../store/workbenchStore";
import type { TimelineItem } from "../types";
import { Timeline } from "./Timeline";

function renderCommand(item: TimelineItem) {
  useWorkbenchStore.setState({
    threadLoading: false,
    selectedThreadId: "thread-status",
    timeline: [item],
    turnStartedAt: {},
    turnDurations: {},
  });
  return render(<Timeline />);
}

describe("Timeline activity status", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => undefined;
    useWorkbenchStore.setState({ runtime: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("animates while a command is active", () => {
    const view = renderCommand({
      id: "command-running",
      turnId: "turn-running",
      role: "tool",
      kind: "command",
      title: "正在运行命令",
      text: "cua-driver status",
      status: "进行中",
      pending: true,
    });

    expect(
      view.container.querySelector(".activity-summary > summary strong"),
    ).toHaveTextContent("正在操作内嵌浏览器");
    expect(view.container.querySelector(".activity-summary")).toHaveClass(
      "is-pending",
    );
    expect(
      view.container.querySelector(".activity-summary"),
    ).not.toHaveAttribute("open");
    expect(
      view.container.querySelector(".tool-card .spin"),
    ).toBeInTheDocument();
  });

  it("stops animation and removes the running label after completion", () => {
    const view = renderCommand({
      id: "command-completed",
      turnId: "turn-completed",
      role: "tool",
      kind: "command",
      title: "正在运行命令",
      text: "cua-driver status",
      status: "已完成",
      pending: true,
    });

    expect(
      view.container.querySelector(".activity-summary > summary strong"),
    ).toHaveTextContent("使用了内嵌浏览器");
    expect(screen.queryByText("正在操作内嵌浏览器")).not.toBeInTheDocument();
    expect(view.container.querySelector(".activity-summary")).not.toHaveClass(
      "is-pending",
    );
    expect(view.container.querySelector(".tool-card .spin")).toBeNull();
  });

  it("keeps the complete command and execution facts when output arrives", () => {
    const view = renderCommand({
      id: "command-receipt",
      turnId: "turn-receipt",
      role: "tool",
      kind: "command",
      title: "运行命令",
      command: "pwd && sleep 12 && printf ONPEOPLE_DEV_REAL_OK",
      cwd: "/Users/test/Documents/Codex",
      text: "/Users/test/Documents/Codex\nONPEOPLE_DEV_REAL_OK",
      status: "已完成",
      exitCode: 0,
      durationMs: 12_400,
    });

    const activity = view.container.querySelector(
      ".activity-summary > summary",
    );
    expect(activity).toHaveTextContent("运行了命令");
    expect(activity).not.toHaveTextContent("pwd && sleep");
    expect(activity).not.toHaveTextContent("退出 0");
    expect(activity).not.toHaveTextContent("12s");
    expect(activity).not.toHaveTextContent("2 行输出");

    fireEvent.click(activity!);
    const toolSummary = view.container.querySelector(".tool-card > summary");
    fireEvent.click(toolSummary!);
    expect(screen.getByText("/Users/test/Documents/Codex")).toBeVisible();
    expect(
      view.container.querySelector(".command-receipt-section:last-child pre"),
    ).toHaveTextContent("ONPEOPLE_DEV_REAL_OK");
  });

  it("keeps a failed command compact until the user asks for details", () => {
    const view = renderCommand({
      id: "command-failed",
      turnId: "turn-failed",
      role: "tool",
      kind: "command",
      title: "运行命令",
      command: "npm run test:unit",
      text: "AssertionError: expected true to be false",
      status: "失败",
      exitCode: 1,
      durationMs: 1_900,
    });

    const activity = view.container.querySelector(
      ".activity-summary > summary",
    );
    expect(
      view.container.querySelector(".activity-summary"),
    ).not.toHaveAttribute("open");
    expect(activity).toHaveTextContent("命令运行失败");
    expect(activity).toHaveTextContent("退出 1");

    fireEvent.click(activity!);
    expect(view.container.querySelector(".tool-card")).toHaveAttribute("open");
    expect(screen.getByText("失败结果已保留")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试命令" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "从断点继续" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("AssertionError: expected true to be false"),
    ).toBeInTheDocument();
  });

  it("does not compete with automatic recovery while the failed turn is live", () => {
    useWorkbenchStore.setState({
      runtime: {
        state: "working",
        threadId: "thread-status",
        turnId: "turn-auto-recovery",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
    });
    renderCommand({
      id: "command-auto-recovery",
      turnId: "turn-auto-recovery",
      role: "tool",
      kind: "command",
      title: "运行命令",
      command: "npm test",
      text: "failed",
      status: "失败",
      exitCode: 1,
    });

    fireEvent.click(
      document.querySelector(".activity-summary > summary") as HTMLElement,
    );
    expect(screen.getByText("OnPeople 正在继续处理")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试命令" }),
    ).not.toBeInTheDocument();
  });

  it("renders a disconnect receipt with the actual recovery route", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-disconnected",
      timeline: [
        {
          id: "runtime-disconnected",
          role: "error",
          kind: "notice",
          title: "连接已中断",
          text: "本次回复未完成，可以重新发送。",
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    render(<Timeline />);
    expect(screen.getByText("连接中断")).toBeInTheDocument();
    expect(screen.getByText("WS 优先 · HTTP 备用")).toBeInTheDocument();
    expect(
      screen.getByText("当前任务、执行记录和本地文件不会丢失。"),
    ).toBeInTheDocument();
  });

  it("uses the command with an exit receipt when one turn reports two traces", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-duplicate-command-traces",
      timeline: [
        {
          id: "native-command-trace",
          turnId: "turn-duplicate-command-traces",
          role: "tool",
          kind: "command",
          title: "运行命令",
          command: "/bin/zsh -lc 'printf OK'",
          text: "OK",
          exitCode: 0,
          status: "已完成",
        },
        {
          id: "dynamic-command-trace",
          turnId: "turn-duplicate-command-traces",
          role: "tool",
          kind: "command",
          title: "运行命令",
          command: "printf OK",
          text: "Script completed\nOK",
          status: "已完成",
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    const view = render(<Timeline />);
    const activity = view.container.querySelector(
      ".activity-summary > summary",
    );
    expect(activity).toHaveTextContent("运行了命令");
    expect(activity).not.toHaveTextContent("/bin/zsh");
    expect(activity).not.toHaveTextContent("退出 0");
    expect(activity).not.toHaveTextContent("1 行输出");
    fireEvent.click(activity!);
    expect(view.container.querySelectorAll(".tool-card")).toHaveLength(1);
  });

  it("keeps cached task content visible during background recovery", () => {
    useWorkbenchStore.setState({
      threadLoading: true,
      selectedThreadId: "thread-cached",
      timeline: [
        {
          id: "cached-message",
          role: "assistant",
          kind: "message",
          text: "已经恢复的任务内容",
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    render(<Timeline />);

    expect(screen.getByText("已经恢复的任务内容")).toBeInTheDocument();
    expect(screen.queryByText("正在载入任务历史")).not.toBeInTheDocument();
  });

  it("shows elapsed time between a user message and its assistant activity", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-timed",
      timeline: [
        {
          id: "user-timed",
          turnId: "turn-timed",
          role: "user",
          kind: "message",
          text: "你好",
        },
        {
          id: "reasoning-timed",
          role: "assistant",
          kind: "reasoning",
          title: "思考过程",
          text: "",
        },
        {
          id: "assistant-timed",
          role: "assistant",
          kind: "message",
          text: "你好！",
        },
      ],
      turnStartedAt: {
        "turn-timed": "2026-08-08T01:31:08.000Z",
      },
      turnDurations: { "turn-timed": 4 },
    });

    render(<Timeline />);

    expect(screen.getByText("处理了 4s")).toBeInTheDocument();
  });

  it("advances every second before the server assigns a turn id", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T01:31:08.000Z"));
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-local-timing",
      timeline: [
        {
          id: "user-local-timing",
          role: "user",
          kind: "message",
          text: "帮我找客户",
          timestamp: "2026-08-08T01:31:08.000Z",
        },
        {
          id: "reasoning-local-timing",
          role: "assistant",
          kind: "reasoning",
          title: "思考过程",
          text: "",
          pending: true,
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    const view = render(<Timeline />);
    expect(screen.getByText("正在处理 0s")).toBeInTheDocument();
    expect(view.container.querySelector(".turn-summary-current")).toBeNull();
    expect(
      view.container.querySelector(".activity-summary > summary strong"),
    ).toHaveTextContent("正在分析");

    act(() => vi.advanceTimersByTime(3_000));

    expect(screen.getByText("正在处理 3s")).toBeInTheDocument();
  });

  it("starts a local timer when restored live activity has no timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T01:31:08.000Z"));
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-observed-timing",
      timeline: [
        {
          id: "user-without-time",
          role: "user",
          kind: "message",
          text: "继续执行",
        },
        {
          id: "command-without-time",
          role: "tool",
          kind: "command",
          title: "正在运行命令",
          text: "npm test",
          pending: true,
          status: "进行中",
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    render(<Timeline />);
    expect(screen.getByText("正在处理 0s")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.getByText("正在处理 2s")).toBeInTheDocument();
  });

  it("keeps timing while the runtime is working after a command completes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T01:31:08.000Z"));
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-between-command-and-reply",
      runtime: {
        state: "working",
        threadId: "thread-between-command-and-reply",
        turnId: "turn-between-command-and-reply",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      timeline: [
        {
          id: "user-between-command-and-reply",
          turnId: "turn-between-command-and-reply",
          role: "user",
          kind: "message",
          text: "运行命令",
          timestamp: "2026-08-08T01:31:08.000Z",
        },
        {
          id: "command-between-command-and-reply",
          turnId: "turn-between-command-and-reply",
          role: "tool",
          kind: "command",
          title: "运行命令",
          command: "sleep 5 && printf OK",
          text: "OK",
          status: "已完成",
          pending: false,
          exitCode: 0,
        },
      ],
      turnStartedAt: {
        "turn-between-command-and-reply": "2026-08-08T01:31:08.000Z",
      },
      turnDurations: {},
    });

    const view = render(<Timeline />);
    expect(screen.getByText("正在处理 0s")).toBeInTheDocument();
    expect(view.container.querySelector(".turn-summary")).not.toHaveTextContent(
      "已完成",
    );
    expect(view.container.querySelector(".turn-summary-current")).toBeNull();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("正在处理 2s")).toBeInTheDocument();
  });

  it("warns after three minutes without a live event and can keep waiting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T01:31:08.000Z"));
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-stalled",
      runtime: {
        state: "working",
        threadId: "thread-stalled",
        turnId: "turn-stalled",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      timeline: [
        {
          id: "user-stalled",
          turnId: "turn-stalled",
          role: "user",
          kind: "message",
          text: "运行长任务",
          timestamp: "2026-08-08T01:31:08.000Z",
        },
      ],
      turnStartedAt: { "turn-stalled": "2026-08-08T01:31:08.000Z" },
      turnDurations: {},
    });

    render(<Timeline />);
    expect(screen.queryByText("可能停滞")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(180_000));
    expect(screen.getByText("可能停滞")).toBeInTheDocument();
    expect(screen.getByText("3 分钟无新事件")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续等待" }));
    expect(screen.queryByText("可能停滞")).not.toBeInTheDocument();
  });

  it("shows one aggregate duration for one user message with multiple runtime turn ids", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-aggregate-timing",
      timeline: [
        {
          id: "user-aggregate",
          turnId: "turn-first",
          role: "user",
          kind: "message",
          text: "清理 Mac 可释放的空间",
        },
        {
          id: "command-first",
          turnId: "turn-first",
          role: "tool",
          kind: "command",
          title: "运行命令",
          text: "du -sh ~/Library/Caches",
          status: "已完成",
        },
        {
          id: "assistant-progress",
          turnId: "turn-first",
          role: "assistant",
          kind: "message",
          text: "已经确认可清理目录。",
        },
        {
          id: "command-second",
          turnId: "turn-second",
          role: "tool",
          kind: "command",
          title: "运行命令",
          text: "du -sh ~/Downloads",
          status: "已完成",
        },
        {
          id: "assistant-final",
          turnId: "turn-second",
          role: "assistant",
          kind: "message",
          text: "清理完成。",
        },
      ],
      turnStartedAt: {
        "turn-first": "2026-08-08T01:31:08.000Z",
        "turn-second": "2026-08-08T01:31:08.000Z",
      },
      turnDurations: {
        "turn-first": 141,
        "turn-second": 196,
      },
    });

    render(<Timeline />);

    expect(
      document.querySelectorAll(".turn-summary > span:first-child"),
    ).toHaveLength(1);
    expect(screen.getByText("处理了 3m 16s")).toBeInTheDocument();
    expect(screen.queryByText("处理了 2m 21s")).not.toBeInTheDocument();
  });

  it("ignores a previous turn trace appended after a recovered later turn", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-recovered-order",
      timeline: [
        {
          id: "user-recovered-first",
          turnId: "turn-recovered-first",
          role: "user",
          kind: "message",
          text: "第一个任务",
        },
        {
          id: "assistant-recovered-first",
          turnId: "turn-recovered-first",
          role: "assistant",
          kind: "message",
          text: "第一个任务完成。",
        },
        {
          id: "user-recovered-second",
          turnId: "turn-recovered-second",
          role: "user",
          kind: "message",
          text: "第二个任务",
        },
        {
          id: "assistant-recovered-second",
          turnId: "turn-recovered-second",
          role: "assistant",
          kind: "message",
          text: "第二个任务完成。",
        },
        {
          id: "late-trace-from-first-turn",
          turnId: "turn-recovered-first",
          role: "tool",
          kind: "command",
          command: "printf FIRST",
          text: "FIRST",
          exitCode: 0,
          status: "已完成",
        },
      ],
      turnStartedAt: {
        "turn-recovered-first": "2026-08-08T01:00:00.000Z",
        "turn-recovered-second": "2026-08-08T03:00:00.000Z",
      },
      turnDurations: {
        "turn-recovered-first": 5,
        "turn-recovered-second": 11,
      },
    });

    render(<Timeline />);
    expect(screen.getByText("处理了 5s")).toBeInTheDocument();
    expect(screen.getByText("处理了 11s")).toBeInTheDocument();
    expect(screen.queryByText(/1h|2h|120m/)).not.toBeInTheDocument();
  });

  it("places a delayed exec receipt before the completed reply in the same turn", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-late-exec",
      runtime: null,
      timeline: [
        {
          id: "user-late-exec",
          turnId: "turn-late-exec",
          role: "user",
          kind: "message",
          text: "创建 hello.md",
        },
        {
          id: "assistant-plan",
          turnId: "turn-late-exec",
          role: "assistant",
          kind: "message",
          text: "我会创建这个文件。",
        },
        {
          id: "file-change-before-reply",
          turnId: "turn-late-exec",
          role: "tool",
          kind: "file-change",
          title: "已修改 1 个文件",
          text: "hello.md",
          stats: { files: 1 },
        },
        {
          id: "assistant-final-before-late-exec",
          turnId: "turn-late-exec",
          role: "assistant",
          kind: "message",
          text: "已创建文件：hello.md。",
        },
        {
          id: "late-exec-receipt",
          turnId: "turn-late-exec",
          role: "tool",
          kind: "command",
          title: "运行命令",
          command: "printf 'hello world' > hello.md",
          text: "",
          exitCode: 0,
          status: "已完成",
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    const view = render(<Timeline />);
    const activity = view.container.querySelector(".activity-summary");
    const finalReply = screen.getByText("已创建文件：hello.md。");

    expect(activity).not.toBeNull();
    expect(
      activity!.compareDocumentPosition(finalReply) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps completed turns ordered while a newer turn is still running", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-order-during-next-turn",
      runtime: {
        state: "working",
        threadId: "thread-order-during-next-turn",
        turnId: "turn-current",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      timeline: [
        {
          id: "user-completed",
          turnId: "turn-completed",
          role: "user",
          kind: "message",
          text: "上一轮",
        },
        {
          id: "assistant-completed",
          turnId: "turn-completed",
          role: "assistant",
          kind: "message",
          text: "上一轮已完成。",
        },
        {
          id: "late-completed-command",
          turnId: "turn-completed",
          role: "tool",
          kind: "command",
          command: "printf PREVIOUS",
          text: "PREVIOUS",
          exitCode: 0,
          status: "已完成",
        },
        {
          id: "user-current",
          turnId: "turn-current",
          role: "user",
          kind: "message",
          text: "当前轮",
        },
        {
          id: "assistant-current-commentary",
          turnId: "turn-current",
          role: "assistant",
          kind: "message",
          text: "当前轮正在继续。",
        },
        {
          id: "current-command",
          turnId: "turn-current",
          role: "tool",
          kind: "command",
          command: "sleep 5",
          text: "",
          pending: true,
          status: "进行中",
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    const view = render(<Timeline />);
    const activities = view.container.querySelectorAll(".activity-summary");
    const previousReply = screen.getByText("上一轮已完成。");
    const currentCommentary = screen.getByText("当前轮正在继续。");

    expect(
      activities[0]!.compareDocumentPosition(previousReply) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      currentCommentary.compareDocumentPosition(activities[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stabilizes a completed reply before the turn summary replaces the running state", () => {
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-summary-stability",
      runtime: {
        state: "working",
        threadId: "thread-summary-stability",
        turnId: "turn-summary-stability",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      timeline: [
        {
          id: "user-summary-stability",
          turnId: "turn-summary-stability",
          role: "user",
          kind: "message",
          text: "创建网页",
        },
        {
          id: "assistant-summary-final",
          turnId: "turn-summary-stability",
          role: "assistant",
          kind: "message",
          text: "网页已经创建。",
          status: "final_answer",
        },
        {
          id: "late-summary-receipt",
          turnId: "turn-summary-stability",
          role: "tool",
          kind: "command",
          command: "printf html > hello.html",
          text: "",
          exitCode: 0,
          status: "已完成",
          pending: false,
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    const view = render(<Timeline />);
    const activity = view.container.querySelector(".activity-summary")!;
    const reply = screen.getByText("网页已经创建。");
    expect(
      activity.compareDocumentPosition(reply) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      useWorkbenchStore.setState({
        runtime: {
          state: "ready",
          threadId: "thread-summary-stability",
          turnId: null,
          queuedMessages: 0,
          pendingApprovals: 0,
          context: null,
        },
        turnDurations: { "turn-summary-stability": 8 },
      });
    });

    expect(screen.getByText("网页已经创建。")).toBeVisible();
    expect(screen.getByText("处理了 8s")).toBeVisible();
    expect(
      view.container
        .querySelector(".activity-summary")!
        .compareDocumentPosition(screen.getByText("网页已经创建。")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("presents a verbose browser weather trace as one quiet Codex-style activity", () => {
    const longSnapshot = Array.from(
      { length: 1776 },
      (_, index) => `browser node ${index + 1}`,
    ).join("\n");
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-weather",
      runtime: null,
      timeline: [
        {
          id: "user-weather",
          turnId: "turn-weather",
          role: "user",
          kind: "message",
          text: "打开内嵌浏览器，帮我搜索今天天气。",
        },
        {
          id: "reasoning-weather",
          turnId: "turn-weather",
          role: "assistant",
          kind: "reasoning",
          title: "思考过程",
          text: "我会使用 GUI 浏览器操作技能。",
          status: "已完成",
        },
        {
          id: "prepare-weather-browser",
          turnId: "turn-weather",
          role: "tool",
          kind: "command",
          title: "运行命令",
          command:
            '/bin/zsh -lc "cua-driver browser_prepare \'{\\"approval_token\\":\\"visible-secret-token\\"}\'"',
          text: "browser ready",
          exitCode: 0,
          durationMs: 400,
          status: "已完成",
        },
        {
          id: "snapshot-weather-browser",
          turnId: "turn-weather",
          role: "tool",
          kind: "command",
          title: "运行命令",
          command: "cua-driver get_window_state --session weather-search",
          text: longSnapshot,
          exitCode: 0,
          durationMs: 900,
          status: "已完成",
        },
        {
          id: "assistant-weather",
          turnId: "turn-weather",
          role: "assistant",
          kind: "message",
          text: "今天多云，气温 26–31°C。",
        },
      ],
      turnStartedAt: {},
      turnDurations: { "turn-weather": 60 },
    });

    const view = render(<Timeline />);
    const activity = view.container.querySelector(".activity-summary")!;
    const summary = view.container.querySelector(".turn-summary")!;
    const finalReply = screen.getByText("今天多云，气温 26–31°C。");

    expect(activity.querySelector("summary strong")).toHaveTextContent(
      "使用了内嵌浏览器",
    );
    expect(activity).not.toHaveAttribute("open");
    expect(screen.getByText("处理了 1m")).toBeVisible();
    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();
    for (const command of screen.getAllByText(/cua-driver/)) {
      expect(command).not.toBeVisible();
    }
    expect(
      activity.compareDocumentPosition(summary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      summary.compareDocumentPosition(finalReply) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(activity.querySelector("summary")!);
    expect(screen.getByText("分析")).toBeVisible();
    expect(screen.getByText("我会使用 GUI 浏览器操作技能。")).not.toBeVisible();
    const toolSummaries = view.container.querySelectorAll(
      ".tool-card > summary",
    );
    expect(toolSummaries).toHaveLength(2);
    fireEvent.click(toolSummaries[0]!);
    expect(screen.getByText(/approval_token.*••••••••/)).toBeVisible();
    expect(screen.queryByText(/visible-secret-token/)).not.toBeInTheDocument();
    fireEvent.click(toolSummaries[1]!);
    expect(screen.getByText("输出较长，仅显示前 120 行")).toBeVisible();
    expect(screen.queryByText("browser node 1776")).not.toBeInTheDocument();
  });

  it("shows a browser MCP failure without exposing the protocol envelope", () => {
    const view = renderCommand({
      id: "browser-open-failed",
      turnId: "turn-browser-open-failed",
      role: "tool",
      kind: "tool",
      title: "internal_browser · browser_open",
      text: JSON.stringify({
        _meta: null,
        content: [
          {
            type: "text",
            text: "OnPeople 内嵌浏览器尚未连接桌面应用",
          },
        ],
        structuredContent: null,
      }),
      status: "失败",
    });

    const activity = view.container.querySelector(".activity-summary")!;
    expect(activity.querySelector("summary strong")).toHaveTextContent(
      "内嵌浏览器打开失败",
    );
    fireEvent.click(activity.querySelector("summary")!);
    expect(
      view.container.querySelector(".tool-card > summary strong"),
    ).toHaveTextContent("内嵌浏览器打开失败");
    expect(
      screen.getByText("OnPeople 内嵌浏览器尚未连接桌面应用"),
    ).toBeVisible();
    expect(screen.queryByText(/structuredContent/)).not.toBeInTheDocument();
    expect(screen.queryByText(/_meta/)).not.toBeInTheDocument();
  });

  it("stops following streaming output after the user scrolls upward", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    useWorkbenchStore.setState({
      threadLoading: false,
      selectedThreadId: "thread-manual-scroll",
      runtime: {
        state: "working",
        threadId: "thread-manual-scroll",
        turnId: "turn-manual-scroll",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      timeline: [
        {
          id: "assistant-streaming",
          turnId: "turn-manual-scroll",
          role: "assistant",
          kind: "message",
          text: "正在输出",
          pending: true,
        },
      ],
      turnStartedAt: {},
      turnDurations: {},
    });

    const view = render(
      <div className="workspace-scroll">
        <Timeline />
      </div>,
    );
    const scroller = view.container.querySelector(
      ".workspace-scroll",
    ) as HTMLElement;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 800 },
    });
    fireEvent.scroll(scroller);
    scrollIntoView.mockClear();

    fireEvent.wheel(scroller, { deltaY: -80 });
    expect(screen.getByRole("button", { name: "回到最新" })).toBeVisible();

    act(() => {
      useWorkbenchStore.setState({
        timeline: [
          {
            id: "assistant-streaming",
            turnId: "turn-manual-scroll",
            role: "assistant",
            kind: "message",
            text: "正在输出更多内容",
            pending: true,
          },
        ],
      });
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "回到最新" }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "end",
      behavior: "smooth",
    });
  });
});
