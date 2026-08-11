import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../types";
import {
  attachQueuedMessageToTurn,
  assignTurnIdToLatestTurn,
  completeTurnTimeline,
  historyFromResume,
  reconcileRecoveredTimeline,
  retainOnlyLatestPending,
  turnTimingFromResume,
} from "./workbenchStore";

describe("live turn attribution", () => {
  it("attaches a late turn id to the latest user turn only", () => {
    const items: TimelineItem[] = [
      {
        id: "old-assistant",
        role: "assistant",
        kind: "message",
        text: "较早回复",
        turnId: "turn-old",
      },
      { id: "new-user", role: "user", kind: "message", text: "你好" },
      {
        id: "new-reasoning",
        role: "assistant",
        kind: "reasoning",
        text: "",
      },
      {
        id: "new-assistant",
        role: "assistant",
        kind: "message",
        text: "你好！",
      },
    ];

    const attributed = assignTurnIdToLatestTurn(items, "turn-new");

    expect(attributed[0]?.turnId).toBe("turn-old");
    expect(attributed.slice(1).map((item) => item.turnId)).toEqual([
      "turn-new",
      "turn-new",
      "turn-new",
    ]);
  });

  it("anchors a queued user message before the next turn starts streaming", () => {
    const current: TimelineItem[] = [
      {
        id: "user-previous",
        role: "user",
        kind: "message",
        turnId: "turn-previous",
        text: "检查项目设置",
      },
      {
        id: "assistant-previous",
        role: "assistant",
        kind: "message",
        turnId: "turn-previous",
        text: "正在检查。",
      },
    ];

    const anchored = attachQueuedMessageToTurn(
      current,
      [
        {
          id: "queue-search",
          threadId: "thread-search",
          text: "你搜索 ChatGPT",
          queuedAt: "2026-08-11T02:59:00.000Z",
          status: "queued",
        },
      ],
      "thread-search",
      "turn-search",
      "2026-08-11T02:59:01.000Z",
    );

    expect(anchored.queuedMessages).toHaveLength(0);
    expect(anchored.timeline).toEqual([
      ...current,
      expect.objectContaining({
        id: "queued-user-queue-search",
        queueId: "queue-search",
        turnId: "turn-search",
        role: "user",
        text: "你搜索 ChatGPT",
      }),
    ]);

    const withLiveTool = [
      ...anchored.timeline,
      {
        id: "web-search",
        turnId: "turn-search",
        role: "tool" as const,
        kind: "tool" as const,
        text: "web_search",
      },
    ];
    expect(withLiveTool.map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "user",
      "tool",
    ]);
  });
});

describe("turn timing recovery", () => {
  it("normalizes app-server Unix timestamps and restores elapsed time", () => {
    const timing = turnTimingFromResume({
      thread: {
        turns: [
          {
            id: "turn-timed",
            status: "completed",
            createdAt: 1_800_000_000,
            completedAt: 1_800_000_064,
          },
        ],
      },
    });

    expect(timing.turnStartedAt["turn-timed"]).toBe("2027-01-15T08:00:00.000Z");
    expect(timing.turnDurations["turn-timed"]).toBe(64);
  });

  it("prefers an explicit server duration when present", () => {
    const timing = turnTimingFromResume({
      initialTurnsPage: {
        data: [
          {
            id: "turn-duration",
            createdAt: "2027-01-15T08:00:00.000Z",
            durationMs: 125_000,
          },
        ],
      },
    });

    expect(timing.turnDurations["turn-duration"]).toBe(125);
  });
});

describe("attachment recovery", () => {
  it("restores file and image inputs as attachments instead of @filename text", () => {
    const timeline = historyFromResume({
      thread: {
        turns: [
          {
            id: "turn-with-files",
            status: "completed",
            items: [
              {
                id: "user-with-files",
                type: "userMessage",
                content: [
                  { type: "text", text: "看看我的简历" },
                  {
                    type: "mention",
                    name: "web3+defi (1).pdf",
                    path: "/Users/test/Documents/web3+defi (1).pdf",
                  },
                  {
                    type: "localImage",
                    path: "/Users/test/Desktop/resume.png",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(timeline).toEqual([
      expect.objectContaining({
        text: "看看我的简历",
        attachments: [
          {
            kind: "file",
            name: "web3+defi (1).pdf",
            path: "/Users/test/Documents/web3+defi (1).pdf",
          },
          {
            kind: "image",
            name: "resume.png",
            path: "/Users/test/Desktop/resume.png",
          },
        ],
      }),
    ]);
    expect(timeline[0]?.text).not.toContain("@web3+defi");
  });
});

describe("completed turn timeline recovery", () => {
  it("preserves command execution facts separately from output", () => {
    const timeline = historyFromResume({
      thread: {
        turns: [
          {
            id: "turn-command-receipt",
            status: "completed",
            items: [
              {
                id: "command-receipt",
                type: "commandExecution",
                command: ["/bin/zsh", "-lc", "pwd && printf OK"],
                cwd: "/Users/test/Documents/Codex",
                aggregatedOutput: "/Users/test/Documents/Codex\nOK",
                exitCode: 0,
                durationMs: 1_250,
                status: "completed",
              },
            ],
          },
        ],
      },
    });

    expect(timeline[0]).toMatchObject({
      kind: "command",
      command: "/bin/zsh -lc pwd && printf OK",
      cwd: "/Users/test/Documents/Codex",
      text: "/Users/test/Documents/Codex\nOK",
      exitCode: 0,
      durationMs: 1_250,
      status: "已完成",
    });
  });

  it("keeps reasoning and command traces when recovered history only has messages", () => {
    const current: TimelineItem[] = [
      {
        id: "local-user",
        turnId: "turn-1",
        role: "user",
        kind: "message",
        text: "帮我运营推特。",
      },
      {
        id: "reasoning-1",
        turnId: "turn-1",
        role: "assistant",
        kind: "reasoning",
        title: "正在思考",
        text: "先读取本地的界面操作规范。",
        pending: true,
      },
      {
        id: "command-1",
        turnId: "turn-1",
        role: "tool",
        kind: "command",
        title: "正在运行命令",
        text: "sed -n '1,240p' MACOS.md",
        status: "进行中",
        pending: true,
      },
      {
        id: "live-assistant",
        turnId: "turn-1",
        role: "assistant",
        kind: "message",
        text: "可以。我能帮你做内容规划。",
        pending: true,
      },
    ];
    const recovered: TimelineItem[] = [
      {
        id: "persisted-user",
        turnId: "turn-1",
        role: "user",
        kind: "message",
        text: "帮我运营推特。",
      },
      {
        id: "persisted-assistant",
        turnId: "turn-1",
        role: "assistant",
        kind: "message",
        text: "可以。我能帮你做内容规划。",
      },
    ];

    const completed = completeTurnTimeline(current, "turn-1");
    const reconciled = reconcileRecoveredTimeline(completed, recovered);

    expect(reconciled).toHaveLength(4);
    expect(reconciled.map((item) => item.kind)).toEqual([
      "message",
      "reasoning",
      "command",
      "message",
    ]);
    expect(reconciled[1]).toMatchObject({
      title: "思考过程",
      pending: false,
    });
    expect(reconciled[2]).toMatchObject({
      title: "运行命令",
      status: "已完成",
      pending: false,
    });
  });

  it("settles a pending item whose payload already reports completion", () => {
    const completed = completeTurnTimeline(
      [
        {
          id: "command-terminal",
          turnId: "turn-2",
          role: "tool",
          kind: "command",
          title: "正在运行命令",
          text: "cua-driver status",
          status: "已完成",
          pending: true,
        },
      ],
      "turn-2",
    );

    expect(completed[0]).toMatchObject({
      title: "运行命令",
      status: "已完成",
      pending: false,
    });
  });

  it("restores persisted reasoning and exec traces alongside resume messages", () => {
    const timeline = historyFromResume({
      thread: {
        turns: [
          {
            id: "turn-3",
            status: "completed",
            items: [
              {
                id: "user-3",
                type: "userMessage",
                content: [{ type: "text", text: "运行测试" }],
              },
              {
                id: "assistant-3",
                type: "agentMessage",
                text: "测试已完成。",
              },
            ],
          },
        ],
      },
      onpeopleTimelineItems: [
        {
          turnId: "turn-3",
          sequence: 1,
          item: {
            id: "user-3",
            type: "userMessage",
            content: [{ type: "text", text: "运行测试" }],
            status: "completed",
          },
        },
        {
          turnId: "turn-3",
          sequence: 2,
          item: {
            id: "reasoning-3",
            type: "reasoning",
            title: "思考过程",
            status: "completed",
          },
        },
        {
          turnId: "turn-3",
          sequence: 3,
          item: {
            id: "exec-3",
            type: "dynamicToolCall",
            tool: "exec",
            arguments: {
              input: 'tools.exec_command({cmd:"npm test"})',
            },
            status: "completed",
          },
        },
      ],
    });

    expect(timeline.map((item) => item.kind)).toEqual([
      "message",
      "reasoning",
      "command",
      "message",
    ]);
    expect(timeline[2]).toMatchObject({
      text: "npm test",
      status: "已完成",
      pending: false,
    });
  });

  it("does not render the internal turn-aborted protocol message", () => {
    const timeline = historyFromResume({
      thread: {
        turns: [
          {
            id: "turn-interrupted",
            status: "interrupted",
            items: [
              {
                id: "user-before-interrupt",
                type: "userMessage",
                content: [{ type: "text", text: "停止这个任务" }],
              },
              {
                id: "internal-abort-message",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: "<turn_aborted>\nThe previous turn was interrupted on purpose.\n</turn_aborted>",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.text).toBe("停止这个任务");
  });

  it("does not render internal goal continuation context as a user message", () => {
    const timeline = historyFromResume({
      thread: {
        turns: [
          {
            id: "turn-goal-continuation",
            status: "inProgress",
            items: [
              {
                id: "internal-goal-context",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: '<codex_internal_context source="goal">\nContinue working toward the active thread goal.\n</codex_internal_context>',
                  },
                ],
              },
              {
                id: "assistant-goal-progress",
                type: "agentMessage",
                text: "继续推进目标。",
              },
            ],
          },
        ],
      },
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      id: "assistant-goal-progress",
      role: "assistant",
      text: "继续推进目标。",
    });
  });

  it("restores missing older turns ahead of the live turn", () => {
    const current: TimelineItem[] = [
      {
        id: "user-latest",
        turnId: "turn-3",
        role: "user",
        kind: "message",
        text: "好。",
      },
      {
        id: "reasoning-latest",
        turnId: "turn-3",
        role: "assistant",
        kind: "reasoning",
        text: "正在继续分析",
        pending: true,
      },
    ];
    const recovered: TimelineItem[] = [
      {
        id: "user-oldest",
        turnId: "turn-1",
        role: "user",
        kind: "message",
        text: "怎么找客户？",
      },
      {
        id: "assistant-oldest",
        turnId: "turn-1",
        role: "assistant",
        kind: "message",
        text: "先明确目标客户。",
      },
      {
        id: "user-middle",
        turnId: "turn-2",
        role: "user",
        kind: "message",
        text: "目前没有什么资源。",
      },
      {
        id: "user-latest-server",
        turnId: "turn-3",
        role: "user",
        kind: "message",
        text: "好。",
      },
    ];

    const reconciled = reconcileRecoveredTimeline(current, recovered);

    expect(reconciled.map((item) => item.turnId)).toEqual([
      "turn-1",
      "turn-1",
      "turn-2",
      "turn-3",
      "turn-3",
    ]);
    expect(reconciled.map((item) => item.text)).toEqual([
      "怎么找客户？",
      "先明确目标客户。",
      "目前没有什么资源。",
      "好。",
      "正在继续分析",
    ]);
  });

  it("keeps only the newest unfinished activity spinning", () => {
    const timeline = retainOnlyLatestPending([
      {
        id: "reasoning-old",
        role: "assistant",
        kind: "reasoning",
        title: "正在思考",
        text: "第一步",
        pending: true,
      },
      {
        id: "command-old",
        role: "tool",
        kind: "command",
        title: "正在运行命令",
        text: "npm test",
        status: "进行中",
        pending: true,
      },
      {
        id: "reasoning-latest",
        role: "assistant",
        kind: "reasoning",
        title: "正在思考",
        text: "最后一步",
        pending: true,
      },
    ]);

    expect(timeline.map((item) => item.pending)).toEqual([false, false, true]);
    expect(timeline[0]?.title).toBe("思考过程");
    expect(timeline[1]).toMatchObject({
      title: "运行命令",
      status: "已完成",
    });
  });
});
