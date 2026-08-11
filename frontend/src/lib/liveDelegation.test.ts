import { describe, expect, it } from "vitest";

import {
  classifyLiveDelegationIntent,
  finalTextFromDelegationTimeline,
  liveDelegationOutcomeFromResume,
  liveDelegationStatusSummary,
  loadLiveDelegations,
  saveLiveDelegations,
  type LiveDelegationTask,
} from "./liveDelegation";

describe("Live delegation routing", () => {
  it("keeps ordinary current-information requests as independent tasks", () => {
    expect(classifyLiveDelegationIntent("帮我查一下上海天气")).toEqual({
      kind: "task",
    });
  });

  it("routes progress, cancellation, and follow-up phrases", () => {
    expect(classifyLiveDelegationIntent("查看一下当前任务进度")).toEqual({
      kind: "status",
    });
    expect(classifyLiveDelegationIntent("取消当前任务")).toEqual({
      kind: "cancel",
    });
    expect(
      classifyLiveDelegationIntent("告诉刚才的任务：再检查一次测试"),
    ).toEqual({
      kind: "follow-up",
      instruction: "再检查一次测试",
    });
  });

  it("returns the final answer instead of commentary", () => {
    expect(
      finalTextFromDelegationTimeline([
        {
          item: {
            type: "agentMessage",
            phase: "commentary",
            text: "我正在检查。",
          },
        },
        {
          item: {
            type: "agentMessage",
            phase: "final",
            text: "上海今天 28°C。",
          },
        },
      ]),
    ).toBe("上海今天 28°C。");
  });

  it("recovers an interrupted terminal state instead of reporting completion", () => {
    expect(
      liveDelegationOutcomeFromResume(
        {
          thread: {
            turns: [
              { id: "turn-old", status: "completed" },
              { id: "turn-current", status: "interrupted" },
            ],
          },
        },
        "turn-current",
      ),
    ).toBe("cancelled");
  });

  it("does not treat a genuinely running resumed turn as terminal", () => {
    expect(
      liveDelegationOutcomeFromResume({
        thread: { turns: [{ id: "turn-current", status: "inProgress" }] },
      }),
    ).toBeNull();
  });

  it("summarizes concurrent task state for the voice model", () => {
    const now = Date.now();
    const tasks: LiveDelegationTask[] = [
      {
        id: "one",
        text: "查询天气",
        state: "running",
        detail: "正在搜索网页",
        createdAt: now - 10,
        updatedAt: now - 10,
      },
      {
        id: "two",
        text: "检查测试",
        state: "waiting-approval",
        detail: "需要你在任务中批准操作",
        createdAt: now,
        updatedAt: now,
      },
    ];
    expect(liveDelegationStatusSummary(tasks)).toContain("当前有 2 个后台任务");
    expect(liveDelegationStatusSummary(tasks)).toContain("等待批准");
  });

  it("persists task mapping across app restarts", () => {
    const values = new Map<string, string>();
    const storage = {
      length: 0,
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: () => null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
    const task: LiveDelegationTask = {
      id: "delegation-1",
      text: "检查项目",
      state: "running",
      detail: "正在分析",
      threadId: "thread-1",
      turnId: "turn-1",
      createdAt: 10,
      updatedAt: 20,
    };
    saveLiveDelegations(storage, [task]);
    expect(loadLiveDelegations(storage)).toEqual([task]);
  });
});
