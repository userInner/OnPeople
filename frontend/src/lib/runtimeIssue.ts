export type RuntimeIssueKind = "account" | "connection" | "runtime";

export interface RuntimeIssuePresentation {
  kind: RuntimeIssueKind;
  title: string;
  description: string;
  actionLabel: string;
}

export function runtimeIssuePresentation(
  message: string,
): RuntimeIssuePresentation {
  const normalized = message.trim();
  if (
    /未配置.*(?:服务凭据|api\s*key)|请(?:先)?登录|登录状态.*失效|authentication|unauthorized|\b401\b|\b403\b/iu.test(
      normalized,
    )
  ) {
    const expired = /失效|unauthorized|\b401\b|\b403\b/iu.test(normalized);
    return {
      kind: "account",
      title: expired ? "登录已过期" : "登录后即可开始",
      description: expired
        ? "重新登录 OnPeople，即可继续当前任务并恢复模型访问。"
        : "登录 OnPeople 后会自动同步可用模型，无需手动配置访问凭据。",
      actionLabel: expired ? "重新登录" : "登录 OnPeople",
    };
  }
  if (/network|连接|timeout|timed out|无法访问|服务不可用/iu.test(normalized)) {
    return {
      kind: "connection",
      title: "暂时无法连接 OnPeople",
      description: "请检查网络连接后重试，当前任务和本地文件不会受到影响。",
      actionLabel: "重新连接",
    };
  }
  return {
    kind: "runtime",
    title: "暂时无法启动任务",
    description: "桌面服务暂时未连接。重新连接后即可继续。",
    actionLabel: "重新连接",
  };
}
