import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LiveConversationController } from "./LiveConversation";
import { LiveCallPanel } from "./LiveCallPanel";

function controller(
  overrides: Partial<LiveConversationController> = {},
): LiveConversationController {
  return {
    active: true,
    busy: false,
    muted: false,
    durationSeconds: 4,
    view: {
      visible: true,
      phase: "delegating",
      title: "后台任务正在运行",
      status: "可查看实时进度",
      transcript: "查询天气",
    },
    entries: [],
    delegations: [],
    audioRef: createRef<HTMLAudioElement>(),
    start: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    toggleMute: vi.fn(),
    cancelDelegation: vi.fn(async () => undefined),
    openDelegation: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Live call task visibility", () => {
  it("shows whether a weather task really started and what it is doing", () => {
    render(
      <LiveCallPanel
        {...controller({
          delegations: [
            {
              id: "weather",
              text: "查询上海天气",
              state: "running",
              detail: "正在搜索网页",
              threadId: "thread-weather",
              turnId: "turn-weather",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("1 个正在执行")).toBeInTheDocument();
    expect(screen.getByText("正在搜索网页")).toBeInTheDocument();
    expect(screen.getByText("已启动 · 运行中")).toBeInTheDocument();
  });

  it("allows a task to be cancelled while its thread is still being created", () => {
    const cancelDelegation = vi.fn(async () => undefined);
    render(
      <LiveCallPanel
        {...controller({
          cancelDelegation,
          delegations: [
            {
              id: "starting-weather",
              text: "查询天气",
              state: "starting",
              detail: "正在创建独立任务",
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "取消后台任务：查询天气" }),
    );
    expect(cancelDelegation).toHaveBeenCalledWith("starting-weather");
  });
});
