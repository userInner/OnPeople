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
});
