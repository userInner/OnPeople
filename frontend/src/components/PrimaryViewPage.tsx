import {
  ArrowLeft,
  CalendarClock,
  Check,
  CirclePlay,
  Clock3,
  GitPullRequest,
  Globe2,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import { errorMessage } from "../lib/errors";
import { useWorkbenchStore } from "../store/workbenchStore";
import type {
  PrimaryView,
  ScheduledRun,
  ScheduledTask,
  SettingsRoute,
} from "../types";
import { SettingsActionPanel } from "./SettingsActionPanels";
import { BrowserPane } from "./tools/BrowserPane";
import { GitPane } from "./tools/GitPane";
import { CustomSelect } from "./ui/CustomSelect";

type WorkspaceView = Exclude<PrimaryView, "tasks">;

export function PrimaryViewPage({
  view,
  onBack,
}: {
  view: WorkspaceView;
  onBack: () => void;
}) {
  const config = {
    "pull-requests": {
      icon: GitPullRequest,
      title: "拉取请求",
      description: "审阅本地变更、整理提交并准备拉取请求。",
    },
    sites: {
      icon: Globe2,
      title: "站点",
      description: "在隔离浏览器中打开、操作和验证 Web 项目。",
    },
    scheduled: {
      icon: CalendarClock,
      title: "已安排",
      description: "创建自动任务、立即运行并查看执行历史。",
    },
    plugins: {
      icon: Puzzle,
      title: "插件",
      description: "管理项目 Skills、插件与 MCP 服务。",
    },
  }[view];
  const Icon = config.icon;

  return (
    <section className={`primary-workspace primary-workspace-${view}`}>
      {view !== "plugins" ? (
        <header className="primary-workspace-header">
          <button type="button" onClick={onBack} aria-label="返回对话">
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <span className="primary-workspace-icon">
            <Icon size={17} aria-hidden="true" />
          </span>
          <div>
            <h1>{config.title}</h1>
            <p>{config.description}</p>
          </div>
        </header>
      ) : null}
      <div className="primary-workspace-content">
        {view === "pull-requests" ? <GitPane /> : null}
        {view === "sites" ? <BrowserPane /> : null}
        {view === "scheduled" ? <ScheduledWorkspace /> : null}
        {view === "plugins" ? <ExtensionsWorkspace /> : null}
      </div>
    </section>
  );
}

interface ScheduleDraft {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  kind: "interval" | "once";
  intervalMinutes: string;
  runAt: string;
}

function emptySchedule(cwd: string): ScheduleDraft {
  const nextHour = new Date(Date.now() + 60 * 60 * 1000);
  nextHour.setMinutes(0, 0, 0);
  return {
    id: "",
    name: "",
    prompt: "",
    cwd,
    kind: "interval",
    intervalMinutes: "1440",
    runAt: toLocalDateTime(nextHour),
  };
}

function ScheduledWorkspace() {
  const scheduler = useWorkbenchStore((state) => state.scheduler);
  const cwd = useWorkbenchStore((state) => state.status?.defaultCwd ?? "");
  const refreshScheduler = useWorkbenchStore((state) => state.refreshScheduler);
  const selectThread = useWorkbenchStore((state) => state.selectThread);
  const [draft, setDraft] = useState<ScheduleDraft>(() => emptySchedule(cwd));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const run = async (
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(id);
    setMessage(null);
    try {
      await action();
      await refreshScheduler();
      setMessage({ kind: "success", text: success });
      return true;
    } catch (error) {
      setMessage({
        kind: "error",
        text: errorMessage(error),
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const editTask = (task: ScheduledTask) => {
    const schedule = asRecord(task.schedule);
    const interval = schedule.intervalMinutes;
    setDraft({
      id: task.id,
      name: task.name,
      prompt: task.prompt,
      cwd: task.cwd,
      kind: typeof interval === "number" ? "interval" : "once",
      intervalMinutes: typeof interval === "number" ? String(interval) : "1440",
      runAt:
        typeof schedule.at === "string"
          ? toLocalDateTime(new Date(schedule.at))
          : toLocalDateTime(new Date(Date.now() + 60 * 60 * 1000)),
    });
  };

  const save = async () => {
    const schedule =
      draft.kind === "interval"
        ? {
            kind: "interval",
            intervalMinutes: Math.max(1, Number(draft.intervalMinutes) || 1),
          }
        : { kind: "once", at: new Date(draft.runAt).toISOString() };
    const task = {
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      cwd: draft.cwd.trim(),
      schedule,
      runtime: { mode: "local" },
    };
    const ok = await run(
      "save-schedule",
      () =>
        draft.id
          ? desktopClient.updateScheduledTask(draft.id, task)
          : desktopClient.createScheduledTask(task),
      draft.id ? "计划任务已更新" : "计划任务已创建",
    );
    if (ok) setDraft(emptySchedule(cwd));
  };

  return (
    <div className="scheduled-workspace">
      <div className="scheduled-column">
        <div className="primary-section-heading">
          <div>
            <h2>计划任务</h2>
            <span>{scheduler.tasks.length} 个</span>
          </div>
          <button type="button" onClick={() => setDraft(emptySchedule(cwd))}>
            <Plus size={13} aria-hidden="true" />
            新建
          </button>
        </div>
        <div className="scheduled-list">
          {scheduler.tasks.length === 0 ? (
            <div className="primary-empty-state">
              <CalendarClock size={20} aria-hidden="true" />
              <strong>没有计划任务</strong>
              <span>创建后可按间隔运行，或安排一次执行。</span>
            </div>
          ) : null}
          {scheduler.tasks.map((task) => (
            <article
              className={`scheduled-task ${draft.id === task.id ? "is-selected" : ""}`}
              key={task.id}
            >
              <button
                className="scheduled-task-main"
                type="button"
                onClick={() => editTask(task)}
              >
                <span
                  className={`scheduled-status ${task.enabled ? "is-on" : ""}`}
                />
                <span>
                  <strong>{task.name}</strong>
                  <small>{scheduleLabel(task)}</small>
                </span>
              </button>
              <div className="scheduled-task-actions">
                <button
                  type="button"
                  title={task.enabled ? "暂停" : "启用"}
                  aria-label={task.enabled ? "暂停计划任务" : "启用计划任务"}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `toggle-${task.id}`,
                      () =>
                        desktopClient.updateScheduledTask(task.id, {
                          enabled: !task.enabled,
                        }),
                      task.enabled ? "计划任务已暂停" : "计划任务已启用",
                    )
                  }
                >
                  {task.enabled ? <Check size={13} /> : <Clock3 size={13} />}
                </button>
                <button
                  type="button"
                  title="立即运行"
                  aria-label="立即运行计划任务"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `run-${task.id}`,
                      () => desktopClient.runScheduledTask(task.id),
                      "计划任务已启动",
                    )
                  }
                >
                  <CirclePlay size={13} />
                </button>
                <button
                  type="button"
                  title="编辑"
                  aria-label="编辑计划任务"
                  onClick={() => editTask(task)}
                >
                  <Pencil size={13} />
                </button>
                {deleteId === task.id ? (
                  <span className="scheduled-delete-confirm">
                    <button type="button" onClick={() => setDeleteId(null)}>
                      取消
                    </button>
                    <button
                      className="is-danger"
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `delete-${task.id}`,
                          () => desktopClient.deleteScheduledTask(task.id),
                          "计划任务已删除",
                        ).then((ok) => ok && setDeleteId(null))
                      }
                    >
                      删除
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    title="删除"
                    aria-label="删除计划任务"
                    onClick={() => setDeleteId(task.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="scheduled-editor-column">
        <div className="scheduled-editor">
          <div className="primary-section-heading">
            <div>
              <h2>{draft.id ? "编辑计划" : "新建计划"}</h2>
              <span>
                {draft.id ? "修改后将重新计算下次运行" : "本地安全执行"}
              </span>
            </div>
          </div>
          <label>
            <span>名称</span>
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="例如：每日检查项目"
            />
          </label>
          <label>
            <span>提示词</span>
            <textarea
              rows={6}
              value={draft.prompt}
              onChange={(event) =>
                setDraft({ ...draft, prompt: event.target.value })
              }
              placeholder="描述任务要完成的工作"
            />
          </label>
          <label>
            <span>工作目录</span>
            <div className="scheduled-cwd-row">
              <input
                value={draft.cwd}
                onChange={(event) =>
                  setDraft({ ...draft, cwd: event.target.value })
                }
                placeholder="选择项目目录"
              />
              <button
                type="button"
                onClick={() =>
                  void desktopClient.pickProject().then((path) => {
                    if (path) setDraft((value) => ({ ...value, cwd: path }));
                  })
                }
              >
                选择
              </button>
            </div>
          </label>
          <div className="scheduled-grid">
            <div className="scheduled-field">
              <span>运行方式</span>
              <CustomSelect
                ariaLabel="运行方式"
                value={draft.kind}
                options={[
                  { value: "interval", label: "重复间隔" },
                  { value: "once", label: "一次" },
                ]}
                onChange={(kind) =>
                  setDraft({
                    ...draft,
                    kind: kind as ScheduleDraft["kind"],
                  })
                }
              />
            </div>
            {draft.kind === "interval" ? (
              <label>
                <span>间隔（分钟）</span>
                <input
                  type="number"
                  min="1"
                  value={draft.intervalMinutes}
                  onChange={(event) =>
                    setDraft({ ...draft, intervalMinutes: event.target.value })
                  }
                />
              </label>
            ) : (
              <label>
                <span>运行时间</span>
                <input
                  type="datetime-local"
                  value={draft.runAt}
                  onChange={(event) =>
                    setDraft({ ...draft, runAt: event.target.value })
                  }
                />
              </label>
            )}
          </div>
          <div className="scheduled-editor-actions">
            {draft.id ? (
              <button
                type="button"
                onClick={() => setDraft(emptySchedule(cwd))}
              >
                取消编辑
              </button>
            ) : null}
            <button
              className="is-primary"
              type="button"
              disabled={
                !draft.name.trim() ||
                !draft.prompt.trim() ||
                !draft.cwd.trim() ||
                (draft.kind === "once" && !draft.runAt) ||
                busy !== null
              }
              onClick={() => void save()}
            >
              {busy === "save-schedule"
                ? "保存中…"
                : draft.id
                  ? "保存更改"
                  : "创建计划"}
            </button>
          </div>
          {message ? (
            <p className={`primary-feedback is-${message.kind}`} role="status">
              {message.text}
            </p>
          ) : null}
        </div>

        <RunHistory
          runs={scheduler.runs}
          tasks={scheduler.tasks}
          busy={busy}
          onOpenThread={(threadId) => void selectThread(threadId)}
          onMarkRead={(runId) =>
            void run(
              `read-${runId}`,
              () => desktopClient.markScheduledNotificationsRead(runId),
              "通知已标记为已读",
            )
          }
          onMarkAllRead={() =>
            void Promise.all(
              scheduler.runs
                .filter((item) => item.unread)
                .map((item) =>
                  desktopClient.markScheduledNotificationsRead(item.id),
                ),
            ).then(() => refreshScheduler())
          }
        />
      </div>
    </div>
  );
}

function RunHistory({
  runs,
  tasks,
  busy,
  onOpenThread,
  onMarkRead,
  onMarkAllRead,
}: {
  runs: ScheduledRun[];
  tasks: ScheduledTask[];
  busy: string | null;
  onOpenThread: (threadId: string) => void;
  onMarkRead: (runId: string) => void;
  onMarkAllRead: () => void;
}) {
  const taskNames = useMemo(
    () => new Map(tasks.map((task) => [task.id, task.name])),
    [tasks],
  );
  const unread = runs.filter((run) => run.unread).length;
  return (
    <section className="scheduled-history">
      <div className="primary-section-heading">
        <div>
          <h2>运行历史</h2>
          <span>{unread} 条未读</span>
        </div>
        {unread > 0 ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={onMarkAllRead}
          >
            全部已读
          </button>
        ) : null}
      </div>
      {runs.length === 0 ? (
        <p className="primary-empty-copy">运行结果会显示在这里。</p>
      ) : (
        <div className="scheduled-run-list">
          {runs.slice(0, 30).map((run) => (
            <article className={run.unread ? "is-unread" : ""} key={run.id}>
              <span className={`run-status is-${run.status}`} />
              <button
                className="scheduled-run-main"
                type="button"
                disabled={!run.threadId}
                onClick={() => run.threadId && onOpenThread(run.threadId)}
              >
                <strong>{taskNames.get(run.taskId) ?? "计划任务"}</strong>
                <small>
                  {run.status} · {formatDate(run.startedAt)}
                </small>
              </button>
              {run.unread ? (
                <button type="button" onClick={() => onMarkRead(run.id)}>
                  已读
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ExtensionsWorkspace() {
  const cwd = useWorkbenchStore((state) => state.status?.defaultCwd ?? "");
  const threadId = useWorkbenchStore(
    (state) => state.status?.windowThreadId ?? "",
  );
  const [resource, setResource] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResource(await desktopClient.listExtensions(cwd));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const handleRefresh = () => void refresh();
    window.addEventListener("onpeople:extensions-refresh", handleRefresh);
    return () =>
      window.removeEventListener("onpeople:extensions-refresh", handleRefresh);
  }, [refresh]);

  if (loading) {
    return (
      <div className="primary-loading">
        <RefreshCw className="spin" size={16} />
        正在读取扩展
      </div>
    );
  }
  if (error) {
    return (
      <div className="primary-error">
        <span>{error}</span>
        <button type="button" onClick={() => void refresh()}>
          重试
        </button>
      </div>
    );
  }
  return (
    <div className="extensions-workspace">
      <SettingsActionPanel
        route={"plugins" satisfies SettingsRoute}
        resource={resource}
        cwd={cwd}
        threadId={threadId}
        onRefresh={refresh}
      />
    </div>
  );
}

function scheduleLabel(task: ScheduledTask): string {
  const schedule = asRecord(task.schedule);
  if (typeof schedule.intervalMinutes === "number") {
    const minutes = schedule.intervalMinutes;
    if (minutes % 1440 === 0) return `每 ${minutes / 1440} 天`;
    if (minutes % 60 === 0) return `每 ${minutes / 60} 小时`;
    return `每 ${minutes} 分钟`;
  }
  if (typeof schedule.at === "string") {
    return `一次 · ${formatDate(schedule.at)}`;
  }
  return task.enabled ? "已启用" : "已暂停";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function toLocalDateTime(value: Date): string {
  if (Number.isNaN(value.valueOf())) return "";
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.valueOf() - offset).toISOString().slice(0, 16);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
