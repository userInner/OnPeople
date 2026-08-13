import { describe, expect, it } from "vitest";

import { runtimeIssuePresentation } from "./runtimeIssue";

describe("runtimeIssuePresentation", () => {
  it("turns missing credentials into a friendly login action", () => {
    expect(
      runtimeIssuePresentation(
        "未配置 OnPeople 服务凭据，请先登录 OnPeople 或在设置中填写 API Key",
      ),
    ).toEqual({
      kind: "account",
      title: "登录后即可开始",
      description: "登录 OnPeople 后会自动同步可用模型，无需手动配置访问凭据。",
      actionLabel: "登录 OnPeople",
    });
  });

  it("classifies the signed-out runtime message as an account action", () => {
    expect(
      runtimeIssuePresentation(
        "请登录 OnPeople 以同步可用模型；如需使用其他模型服务，可前往设置完成配置",
      ),
    ).toMatchObject({
      kind: "account",
      title: "登录后即可开始",
      actionLabel: "登录 OnPeople",
    });
  });

  it("distinguishes an expired login", () => {
    expect(runtimeIssuePresentation("OnPeople 登录状态已失效")).toMatchObject({
      kind: "account",
      title: "登录已过期",
      actionLabel: "重新登录",
    });
  });

  it("keeps network failures actionable", () => {
    expect(runtimeIssuePresentation("network timeout")).toMatchObject({
      kind: "connection",
      actionLabel: "重新连接",
    });
  });

  it("hides implementation language for desktop service failures", () => {
    expect(runtimeIssuePresentation("Rust 桌面宿主尚未启动")).toEqual({
      kind: "runtime",
      title: "暂时无法启动任务",
      description: "桌面服务暂时未连接。重新连接后即可继续。",
      actionLabel: "重新连接",
    });
  });
});
