import {
  CheckCircle2,
  CirclePause,
  Gauge,
  Goal as GoalIcon,
  ListPlus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { errorMessage } from "../../lib/errors";
import { useWorkbenchStore } from "../../store/workbenchStore";
import type { Goal, RuntimeDiagnostics } from "../../types";

type JsonRecord = Record<string, unknown>;

export function ContextGoalPanel() {
  const threadId = useWorkbenchStore(
    (state) => state.selectedThreadId ?? state.status?.windowThreadId ?? "",
  );
  const runtime = useWorkbenchStore((state) => state.runtime);
  const queueMessage = useWorkbenchStore((state) => state.queueMessage);
  const reconnectRuntime = useWorkbenchStore((state) => state.reconnectRuntime);
  const [context, setContext] = useState<JsonRecord>({});
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(
    null,
  );
  const [objective, setObjective] = useState("");
  const [tokenBudget, setTokenBudget] = useState("");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [confirmCompact, setConfirmCompact] = useState(false);

  const refresh = useCallback(async () => {
    if (!threadId) {
      setContext({});
      setDiagnostics(await desktopClient.runtimeDiagnostics());
      return;
    }
    const [nextContext, nextDiagnostics] = await Promise.all([
      desktopClient.getContextState(threadId),
      desktopClient.runtimeDiagnostics(),
    ]);
    setContext(nextContext);
    setDiagnostics(nextDiagnostics);
    const nextGoal = asRecord(nextContext.goal) as Goal | JsonRecord;
    setObjective(text(nextGoal.objective));
    setTokenBudget(optionalNumberText(nextGoal.tokenBudget));
    syncGoal(nextContext.goal);
  }, [threadId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((error) =>
        setMessage({ kind: "error", text: errorText(error) }),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    success: string,
    refreshAfter = true,
  ) => {
    setBusy(key);
    setMessage(null);
    try {
      const result = await action();
      if (refreshAfter) await refresh();
      setMessage({ kind: "success", text: success });
      return result;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const goal = useMemo(() => {
    const value = asRecord(context.goal);
    return text(value.threadId) ? value : null;
  }, [context.goal]);
  const usage = asRecord(context.usage);
  const total = asRecord(usage.total);
  const usedTokens = number(total.totalTokens);
  const contextWindow = number(usage.modelContextWindow);
  const contextPercent = contextWindow
    ? Math.min(100, Math.round((usedTokens / contextWindow) * 100))
    : 0;
  const checkpoint = asRecord(context.checkpoint);
  const queued = array(context.queued);
  const running = [
    "working",
    "running",
    "waiting-approval",
    "waiting-input",
  ].includes(runtime?.state ?? "");

  const saveGoal = async () => {
    const value = objective.trim();
    if (!value || !threadId) return;
    const budget = tokenBudget.trim() ? Number(tokenBudget) : null;
    const result = goal
      ? await run(
          "goal-edit",
          () =>
            desktopClient.updateGoal({
              threadId,
              action: "edit",
              value,
            }),
          "目标已更新",
        )
      : await run(
          "goal-create",
          () =>
            desktopClient.setGoal({
              threadId,
              objective: value,
              tokenBudget:
                budget && Number.isFinite(budget) && budget > 0
                  ? Math.floor(budget)
                  : null,
            }),
          "持续目标已启动",
        );
    if (result) syncGoal(result);
  };

  const updateGoal = async (action: string, success: string) => {
    if (!threadId) return;
    const result = await run(
      `goal-${action}`,
      () => desktopClient.updateGoal({ threadId, action }),
      success,
    );
    syncGoal(result);
  };

  return (
    <>
      {message ? (
        <div
          className={`management-message is-${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </div>
      ) : null}

      <section className="management-card goal-control-card">
        <div className="management-card-title">
          <GoalIcon size={15} aria-hidden="true" />
          <span>持续目标</span>
          {goal ? (
            <span
              className={`context-status is-${text(goal.status, "active")}`}
            >
              {goalStatus(text(goal.status, "active"))}
            </span>
          ) : null}
        </div>
        <textarea
          aria-label="持续目标"
          rows={3}
          value={objective}
          disabled={!threadId || busy !== null}
          onChange={(event) => setObjective(event.target.value)}
          placeholder={
            threadId ? "描述需要持续追求的最终结果" : "先打开一个任务"
          }
        />
        <div className="goal-control-footer">
          {!goal ? (
            <label>
              <span>Token 预算</span>
              <input
                aria-label="目标 Token 预算"
                type="number"
                min="1"
                step="1000"
                value={tokenBudget}
                disabled={!threadId || busy !== null}
                onChange={(event) => setTokenBudget(event.target.value)}
                placeholder="不限"
              />
            </label>
          ) : (
            <small>
              已用 {formatNumber(goal.tokensUsed)}
              {number(goal.tokenBudget)
                ? ` / ${formatNumber(goal.tokenBudget)} tokens`
                : " tokens · 无预算上限"}
            </small>
          )}
          <span className="context-action-row">
            {goal ? (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void updateGoal(
                      text(goal.status) === "paused" ? "resume" : "pause",
                      text(goal.status) === "paused"
                        ? "目标已继续"
                        : "目标已暂停",
                    )
                  }
                >
                  <CirclePause size={12} />
                  {text(goal.status) === "paused" ? "继续" : "暂停"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void updateGoal("complete", "目标已完成")}
                >
                  <CheckCircle2 size={12} /> 完成
                </button>
                <button
                  className="is-danger"
                  type="button"
                  aria-label="清除持续目标"
                  disabled={busy !== null}
                  onClick={() => void updateGoal("clear", "目标已清除")}
                >
                  <Trash2 size={12} />
                </button>
              </>
            ) : null}
            <button
              className="is-primary"
              type="button"
              disabled={!threadId || !objective.trim() || busy !== null}
              onClick={() => void saveGoal()}
            >
              {busy?.startsWith("goal-")
                ? "保存中…"
                : goal
                  ? "更新"
                  : "启动目标"}
            </button>
          </span>
        </div>
      </section>

      <section className="management-card context-control-card">
        <div className="management-card-title">
          <Gauge size={15} aria-hidden="true" />
          <span>上下文</span>
          <span className="context-status">{contextPercent}%</span>
          <button
            className="management-title-action"
            type="button"
            aria-label="刷新上下文"
            disabled={busy !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div
          className="context-meter"
          aria-label={`上下文使用 ${contextPercent}%`}
        >
          <i style={{ width: `${contextPercent}%` }} />
        </div>
        <p className="context-breakdown">
          {contextWindow
            ? `${formatNumber(usedTokens)} / ${formatNumber(contextWindow)} tokens · 输入 ${formatNumber(total.inputTokens)} · 输出 ${formatNumber(total.outputTokens)} · 推理 ${formatNumber(total.reasoningOutputTokens)}`
            : "运行一次任务后会显示上下文用量。"}
        </p>
        <p className="context-checkpoint">
          {checkpoint.available
            ? `校准 R${number(checkpoint.revision)} · ${text(checkpoint.rebuildMode) === "full" ? "完整重建" : "压缩记录"} · ${number(checkpoint.evidenceCount)} 条证据`
            : "尚未建立本地上下文校准记录。"}
        </p>
        <textarea
          aria-label="上下文指令"
          rows={3}
          value={direction}
          disabled={!threadId || busy !== null}
          onChange={(event) => setDirection(event.target.value)}
          placeholder="在运行中立即转向，或排队到下一轮"
        />
        <div className="context-action-row is-wide">
          <button
            type="button"
            disabled={!running || !direction.trim() || busy !== null}
            onClick={() =>
              void run(
                "steer",
                () => desktopClient.steerTurn(direction.trim(), threadId),
                "转向指令已送达当前回合",
              ).then((result) => result && setDirection(""))
            }
          >
            <Send size={12} /> 立即转向
          </button>
          <button
            type="button"
            disabled={!threadId || !direction.trim() || busy !== null}
            onClick={() => {
              const value = direction.trim();
              setBusy("queue");
              setMessage(null);
              void queueMessage(value)
                .then(() => {
                  setDirection("");
                  setMessage({ kind: "success", text: "消息已加入下一轮队列" });
                  return refresh();
                })
                .catch((error) =>
                  setMessage({ kind: "error", text: errorText(error) }),
                )
                .finally(() => setBusy(null));
            }}
          >
            <ListPlus size={12} /> 排队下一轮
          </button>
          <button
            type="button"
            disabled={!threadId || running || busy !== null}
            onClick={() =>
              void run(
                "recalibrate",
                () => desktopClient.recalibrateContext(threadId),
                "上下文校准已从任务历史重建",
              )
            }
          >
            <Sparkles size={12} /> 重新校准
          </button>
          {confirmCompact ? (
            <span className="context-confirm">
              <button type="button" onClick={() => setConfirmCompact(false)}>
                取消
              </button>
              <button
                className="is-danger"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "compact",
                    () => desktopClient.compactContext(threadId),
                    "上下文压缩已开始",
                  ).then(() => setConfirmCompact(false))
                }
              >
                确认压缩
              </button>
            </span>
          ) : (
            <button
              className="is-danger"
              type="button"
              disabled={!threadId || running || busy !== null}
              onClick={() => setConfirmCompact(true)}
            >
              压缩上下文
            </button>
          )}
        </div>
        {queued.length > 0 ? (
          <div className="context-queue-list" aria-label="下一轮消息队列">
            {queued.map((item, index) => (
              <div key={text(item.id, String(index))}>
                <span>NEXT TURN</span>
                <p>{text(item.text)}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="management-card runtime-control-card">
        <div className="management-card-title">
          <RotateCcw size={15} aria-hidden="true" />
          <span>Codex Runtime</span>
          <span
            className={`context-status is-${diagnostics?.state ?? "unknown"}`}
          >
            {runtimeStatus(diagnostics?.state)}
          </span>
        </div>
        <div className="runtime-control-summary">
          <span>
            <strong>{diagnostics?.version ?? "—"}</strong>
            <small>{diagnostics?.executable ?? "运行时尚未初始化"}</small>
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "runtime-restart",
                () => desktopClient.restartRuntime(),
                "Codex Runtime 已重新连接",
                false,
              ).then(async (result) => {
                if (!result) return;
                setDiagnostics(result as RuntimeDiagnostics);
                await reconnectRuntime();
              })
            }
          >
            <RotateCcw size={12} />
            {busy === "runtime-restart" ? "重启中…" : "重启运行时"}
          </button>
        </div>
        {diagnostics?.lastError ? (
          <p className="runtime-last-error">{diagnostics.lastError}</p>
        ) : null}
      </section>
    </>
  );
}

function syncGoal(value: unknown) {
  const goal = asRecord(value);
  useWorkbenchStore.setState((state) => ({
    status: state.status
      ? {
          ...state.status,
          goal: text(goal.threadId) ? (goal as Goal) : null,
        }
      : state.status,
  }));
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: unknown): string {
  return number(value).toLocaleString("zh-CN");
}

function optionalNumberText(value: unknown): string {
  const parsed = number(value);
  return parsed > 0 ? String(parsed) : "";
}

const errorText = errorMessage;

function goalStatus(status: string): string {
  return (
    {
      active: "运行中",
      paused: "已暂停",
      complete: "已完成",
      blocked: "受阻",
      usageLimited: "用量受限",
      budgetLimited: "预算用尽",
    }[status] ?? status
  );
}

function runtimeStatus(status: string | undefined): string {
  return (
    {
      ready: "就绪",
      working: "运行中",
      recovering: "恢复中",
      unavailable: "不可用",
      stopped: "已停止",
    }[status ?? ""] ??
    status ??
    "未知"
  );
}
