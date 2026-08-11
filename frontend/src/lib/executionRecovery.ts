import type { TimelineItem } from "../types";

export const STALL_WARNING_MS = 3 * 60 * 1_000;

export type ExecutionRecoveryKind =
  | "connection"
  | "timeout"
  | "transport"
  | "error";

export interface ExecutionRecoveryPresentation {
  kind: ExecutionRecoveryKind;
  eyebrow: string;
  title: string;
  description: string;
  preservation: string;
  primaryAction: "reconnect" | "resume";
  primaryLabel: string;
  route?: string | undefined;
}

export function executionRecoveryPresentation(
  item: TimelineItem,
): ExecutionRecoveryPresentation | null {
  const raw = `${item.title ?? ""}\n${item.text}`.trim();

  if (/websocket|\bws\b/iu.test(raw) && /http|fallback|回退|备用/iu.test(raw)) {
    return {
      kind: "transport",
      eyebrow: "传输已恢复",
      title: item.title || "已切换备用连接",
      description: item.text || "WebSocket 不可用，当前请求已改用 HTTP。",
      preservation: "执行上下文和已完成结果已保留，无需重新开始任务。",
      primaryAction: "reconnect",
      primaryLabel: "恢复首选连接",
      route: "WS → HTTP",
    };
  }

  if (/timeout|timed out|超时|等待时间过长/iu.test(raw)) {
    return {
      kind: "timeout",
      eyebrow: "等待超时",
      title: item.title || "任务未在时限内完成",
      description: item.text || "本轮执行已停止等待。",
      preservation: "已完成的步骤、命令输出和本地文件都已保留。",
      primaryAction: "resume",
      primaryLabel: "从断点继续",
    };
  }

  if (
    /reconnect|重新连接|连接不稳定|连接已中断|stream disconnected|network|无法连接/iu.test(
      raw,
    )
  ) {
    const reconnecting = /正在重新连接|reconnecting/iu.test(raw);
    return {
      kind: "connection",
      eyebrow: reconnecting ? "自动恢复中" : "连接中断",
      title: item.title || (reconnecting ? "正在恢复连接" : "连接已中断"),
      description: item.text || "本次回复未完成，可以恢复连接后继续。",
      preservation: "当前任务、执行记录和本地文件不会丢失。",
      primaryAction: "reconnect",
      primaryLabel: reconnecting ? "立即重连" : "恢复连接",
      route: "WS 优先 · HTTP 备用",
    };
  }

  if (item.role !== "error") return null;
  return {
    kind: "error",
    eyebrow: "执行已暂停",
    title: item.title || "任务遇到错误",
    description: item.text || "本轮执行遇到问题。",
    preservation: "错误前的任务记录、命令输出和本地改动已保留。",
    primaryAction: "resume",
    primaryLabel: "从断点继续",
  };
}

export function retryCommandPrompt(
  item: TimelineItem,
  command: string,
): string {
  const exit = item.exitCode === undefined ? "" : `（退出码 ${item.exitCode}）`;
  return [
    `请重新运行刚才失败的命令${exit}，并从失败位置继续任务。`,
    "",
    "命令：",
    command,
  ].join("\n");
}

export const resumeFromFailurePrompt =
  "请从刚才中断或失败的位置继续。先核对已经完成的内容，不要重复已完成步骤，再执行剩余任务。";

export function shouldShowStallWarning({
  runtimeWorking,
  lastActivityAt,
  now,
  awaitingUser,
}: {
  runtimeWorking: boolean;
  lastActivityAt: number;
  now: number;
  awaitingUser: boolean;
}): boolean {
  return (
    runtimeWorking && !awaitingUser && now - lastActivityAt >= STALL_WARNING_MS
  );
}
