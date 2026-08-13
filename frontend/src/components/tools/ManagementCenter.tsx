import {
  Activity,
  Bot,
  ChevronRight,
  Cloud,
  Eye,
  Gauge,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { errorMessage } from "../../lib/errors";
import { useWorkbenchStore } from "../../store/workbenchStore";
import type { SchedulerSnapshot } from "../../types";
import { ContextGoalPanel } from "./ContextGoalPanel";

type AgentTask = Record<string, unknown>;

export function ManagementCenter() {
  const cwd = useWorkbenchStore((state) => state.status?.defaultCwd ?? "");
  const selectedThreadId = useWorkbenchStore(
    (state) => state.selectedThreadId ?? state.status?.windowThreadId ?? "",
  );
  const selectThread = useWorkbenchStore((state) => state.selectThread);
  const [agents, setAgents] = useState<AgentTask[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerSnapshot>({
    tasks: [],
    runs: [],
    unread: 0,
  });
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [cloud, setCloud] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentMessage, setAgentMessage] = useState("");
  const [agentOutput, setAgentOutput] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setMessage(null);
    try {
      const [agentResult, nextScheduler, nextLive, nextCloud] =
        await Promise.all([
          desktopClient.listAgents(selectedThreadId),
          desktopClient.scheduler(),
          desktopClient.liveStatus(),
          desktopClient.cloudAccount(),
        ]);
      setAgents(agentResult.agents ?? []);
      setScheduler(nextScheduler);
      setLive(nextLive as Record<string, unknown>);
      setCloud(nextCloud as Record<string, unknown>);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [selectedThreadId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    let refreshTimer: number | null = null;
    const unsubscribe = desktopClient.onAgentEvent((event) => {
      const payload = asRecord(event.payload);
      const method = text(payload.method ?? payload.type);
      if (
        !method.includes("thread") &&
        !method.includes("turn") &&
        !method.includes("item") &&
        !method.includes("agent")
      ) {
        return;
      }
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 120);
    });
    return () => {
      window.clearTimeout(timer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      void unsubscribe.then((dispose) => dispose());
    };
  }, [refresh]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => text(agent.id) === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    success: string,
    shouldRefresh = true,
  ) => {
    setBusy(key);
    setMessage(null);
    try {
      const result = await action();
      if (shouldRefresh) await refresh();
      setMessage(success);
      return result;
    } catch (error) {
      setMessage(errorMessage(error));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runTask = async (id: string) => {
    await run(
      `schedule-${id}`,
      () => desktopClient.runScheduledTask(id),
      "计划任务已启动",
    );
  };

  const deleteTask = async (id: string) => {
    await run(
      `schedule-delete-${id}`,
      () => desktopClient.deleteScheduledTask(id),
      "计划任务已删除",
    );
  };

  return (
    <div className="management-pane">
      <div className="management-header">
        <div>
          <span className="tool-kicker">CONTROL CENTER</span>
          <h2>管理中心</h2>
        </div>
        <button
          className="tool-icon-button"
          type="button"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} aria-hidden="true" />
          刷新
        </button>
      </div>
      {message ? (
        <div className="management-message" role="status">
          {message}
        </div>
      ) : null}
      <ContextGoalPanel />
      <section className="management-card agent-board">
        <div className="management-card-title">
          <Bot size={15} aria-hidden="true" />
          <span>Codex 原生 Agent</span>
          <span className="management-count">{agents.length}</span>
        </div>
        <p className="agent-native-hint">
          复杂任务会自动拆成边界清晰的工作单，并在对话下方显示编排册。你也可以明确说“使用两个子
          Agent 并行处理”。主 Agent 负责集成，Reviewer 负责最终验收。
        </p>
        {agents.length === 0 ? (
          <p className="tool-empty">当前任务还没有原生子 Agent。</p>
        ) : (
          <div className="management-list agent-task-list">
            {agents.map((agent, index) => {
              const taskId = text(agent.id, String(index));
              const runtimeAgentId = text(agent.agentId);
              const status = text(agent.status, "queued");
              const selected = selectedAgentId === taskId;
              return (
                <article
                  className={`agent-task-row ${selected ? "is-selected" : ""}`}
                  key={taskId}
                >
                  <button
                    className="agent-task-main"
                    type="button"
                    onClick={() => {
                      setSelectedAgentId(selected ? null : taskId);
                      setAgentOutput(agent.result ?? null);
                    }}
                  >
                    <span className={`agent-status is-${status}`} />
                    <span>
                      <strong>
                        {text(agent.title, text(agent.name, "Agent"))}
                      </strong>
                      <small>{text(agent.prompt, status)}</small>
                    </span>
                  </button>
                  <span className="management-actions">
                    {runtimeAgentId ? (
                      <button
                        type="button"
                        title="读取 Agent 状态"
                        aria-label="读取 Agent 状态"
                        disabled={busy !== null}
                        onClick={() => {
                          setBusy(`read-${taskId}`);
                          void desktopClient
                            .readAgent(runtimeAgentId)
                            .then((value) => {
                              setSelectedAgentId(taskId);
                              setAgentOutput(value);
                            })
                            .catch((error) => setMessage(errorMessage(error)))
                            .finally(() => setBusy(null));
                        }}
                      >
                        <Eye size={13} />
                      </button>
                    ) : null}
                    {runtimeAgentId && status === "running" ? (
                      <button
                        type="button"
                        title="停止 Agent"
                        aria-label="停止 Agent"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            `stop-${taskId}`,
                            () => desktopClient.stopAgent(runtimeAgentId),
                            "Agent 已停止",
                          )
                        }
                      >
                        <Square size={12} />
                      </button>
                    ) : null}
                    {runtimeAgentId ? (
                      <button
                        type="button"
                        title="打开 Agent 线程"
                        aria-label="打开 Agent 线程"
                        onClick={() => void selectThread(runtimeAgentId)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    ) : null}
                  </span>
                </article>
              );
            })}
          </div>
        )}
        {selectedAgent ? (
          <div className="agent-detail">
            <div className="agent-detail-heading">
              <MessageSquare size={13} />
              <strong>{text(selectedAgent.title, "Agent")}</strong>
              <small>{text(selectedAgent.status, "queued")}</small>
            </div>
            {agentOutput ? (
              <pre>{formatOutput(agentOutput)}</pre>
            ) : (
              <p>选择“读取”以获取 Agent 的最新输出。</p>
            )}
            {text(selectedAgent.agentId) &&
            text(selectedAgent.status) === "running" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const runtimeAgentId = text(selectedAgent.agentId);
                  const outgoing = agentMessage.trim();
                  if (!runtimeAgentId || !outgoing) return;
                  void run(
                    `message-${text(selectedAgent.id)}`,
                    () => desktopClient.messageAgent(runtimeAgentId, outgoing),
                    "消息已发送给 Agent",
                    false,
                  ).then((value) => {
                    if (value) setAgentMessage("");
                  });
                }}
              >
                <input
                  value={agentMessage}
                  onChange={(event) => setAgentMessage(event.target.value)}
                  placeholder="给 Agent 发送跟进指令"
                  aria-label="给 Agent 发送消息"
                />
                <button
                  type="submit"
                  aria-label="发送 Agent 消息"
                  disabled={!agentMessage.trim() || busy !== null}
                >
                  <Send size={12} />
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="management-card">
        <div className="management-card-title">
          <Activity size={15} aria-hidden="true" />
          <span>计划任务</span>
          <span className="management-count">{scheduler.unread}</span>
        </div>
        {scheduler.tasks.length === 0 ? (
          <p className="tool-empty">没有计划任务。</p>
        ) : (
          <div className="management-list">
            {scheduler.tasks.map((task) => (
              <div className="management-row" key={task.id}>
                <span>
                  {task.name}
                  <small>{task.cwd || cwd}</small>
                </span>
                <span className="management-actions">
                  <button
                    type="button"
                    title="立即运行"
                    disabled={busy !== null}
                    onClick={() => void runTask(task.id)}
                  >
                    <Play size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    disabled={busy !== null}
                    onClick={() => void deleteTask(task.id)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="management-grid">
        <section className="management-card compact-card">
          <div className="management-card-title">
            <Cloud size={15} aria-hidden="true" />
            <span>云端账号</span>
          </div>
          <strong>{cloud?.signedIn ? "已登录" : "未登录"}</strong>
          <small>
            {text(
              (cloud?.account as Record<string, unknown> | undefined)?.email,
              "本地运行",
            )}
          </small>
        </section>
        <section className="management-card compact-card">
          <div className="management-card-title">
            <Gauge size={15} aria-hidden="true" />
            <span>GPT-Live</span>
          </div>
          <strong>{live?.activeCallId ? "连接中" : "未连接"}</strong>
          <small>{text(live?.message, "等待会话")}</small>
        </section>
      </div>
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function formatOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
