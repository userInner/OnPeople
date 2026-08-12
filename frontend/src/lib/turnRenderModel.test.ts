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

  it("places a late user anchor before assistant output from the same turn", () => {
    const source = [
      item({
        id: "previous-user",
        role: "user",
        turnId: "turn-previous",
        text: "查看一下今天天气",
      }),
      item({
        id: "previous-final",
        turnId: "turn-previous",
        phase: "final_answer",
        text: "请告诉我你所在的城市。",
      }),
      item({
        id: "next-commentary",
        turnId: "turn-weather",
        phase: "commentary",
        text: "我来查询北京今天的实时天气预报。",
      }),
      item({
        id: "next-user",
        role: "user",
        turnId: "turn-weather",
        text: "北京",
      }),
    ];

    expect(
      buildTurnRenderModel(source, true).items.map((entry) => entry.id),
    ).toEqual([
      "previous-user",
      "previous-final",
      "next-user",
      "next-commentary",
    ]);
  });
});
