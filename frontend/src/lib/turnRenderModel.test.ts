import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../types";
import { buildTurnRenderModel } from "./turnRenderModel";

const item = (value: Partial<TimelineItem>): TimelineItem => ({
  id: crypto.randomUUID(),
  role: "assistant",
  text: "",
  kind: "message",
  ...value,
});

describe("buildTurnRenderModel", () => {
  it("keeps streamed items owned by the preceding turn", () => {
    const source = [
      item({ id: "user", role: "user", turnId: "turn-1", text: "检查" }),
      item({ id: "tool", role: "tool", kind: "tool", title: "检查" }),
    ];
    expect(buildTurnRenderModel(source).items[1]?.turnId).toBe("turn-1");
  });

  it("collapses duplicate commentary and final narration deterministically", () => {
    const source = [
      item({ id: "user", role: "user", turnId: "turn-1", text: "检查" }),
      item({
        id: "commentary",
        turnId: "turn-1",
        phase: "commentary",
        text: "我先读取。",
      }),
      item({
        id: "final",
        turnId: "turn-1",
        phase: "final_answer",
        text: "我先读取。",
      }),
    ];
    const rendered = buildTurnRenderModel(source).items;
    expect(rendered.map((entry) => entry.id)).toEqual(["user", "final"]);
  });

  it("moves late completed activities before the final answer", () => {
    const source = [
      item({ id: "user", role: "user", turnId: "turn-1", text: "检查" }),
      item({
        id: "final",
        turnId: "turn-1",
        phase: "final_answer",
        text: "完成",
      }),
      item({
        id: "tool",
        turnId: "turn-1",
        role: "tool",
        kind: "tool",
        title: "读取",
        status: "已完成",
      }),
    ];
    expect(
      buildTurnRenderModel(source, false).items.map((entry) => entry.id),
    ).toEqual(["user", "tool", "final"]);
  });

  it("does not reorder a still-running late activity", () => {
    const source = [
      item({ id: "user", role: "user", turnId: "turn-1", text: "检查" }),
      item({
        id: "final",
        turnId: "turn-1",
        phase: "final_answer",
        text: "处理中",
      }),
      item({
        id: "tool",
        turnId: "turn-1",
        role: "tool",
        kind: "tool",
        title: "读取",
        pending: true,
      }),
    ];
    expect(
      buildTurnRenderModel(source, true).items.map((entry) => entry.id),
    ).toEqual(["user", "final", "tool"]);
  });
});
