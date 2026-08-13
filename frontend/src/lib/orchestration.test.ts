import { describe, expect, it } from "vitest";

import {
  parseOrchestrationWorkOrder,
  workOrderProgressLabel,
} from "./orchestration";

describe("orchestration work orders", () => {
  it("parses the structured delegation contract used by OnPeople", () => {
    const workOrder = parseOrchestrationWorkOrder(
      `
<agent_work_order>
角色：代码审查员
目标：检查登录状态恢复是否可靠
范围：
- 只读审查认证与启动链路
【已知线索】
- 首次启动可能晚于 UI
交付物：
- 按严重程度列出发现
验证：
- 运行定向测试并给出证据
边界：
- 不修改文件
</agent_work_order>`,
      "审查登录恢复",
      "reviewer",
    );

    expect(workOrder).toMatchObject({
      role: "代码审查员",
      objective: "检查登录状态恢复是否可靠",
      scope: ["只读审查认证与启动链路"],
      clues: ["首次启动可能晚于 UI"],
      deliverables: ["按严重程度列出发现"],
      verification: ["运行定向测试并给出证据"],
      constraints: ["不修改文件"],
      reviewer: true,
    });
  });

  it("keeps useful freeform prompts readable", () => {
    expect(
      parseOrchestrationWorkOrder(
        "梳理桌面 API 的事件恢复链路，并报告风险。",
        "事件链路",
        "default",
      ),
    ).toMatchObject({
      role: "执行 Agent",
      objective: "梳理桌面 API 的事件恢复链路，并报告风险。",
      reviewer: false,
    });
  });

  it("uses acceptance language for reviewer status", () => {
    expect(workOrderProgressLabel("running", true)).toBe("正在验收");
    expect(workOrderProgressLabel("completed", false)).toBe("已交付");
  });
});
