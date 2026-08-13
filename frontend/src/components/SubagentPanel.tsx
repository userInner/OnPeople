import {
  BookOpenText,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  ShieldCheck,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { desktopClient } from "../lib/desktopClient";
import {
  parseOrchestrationWorkOrder,
  workOrderProgressLabel,
  type OrchestrationWorkOrder,
} from "../lib/orchestration";
import { useWorkbenchStore } from "../store/workbenchStore";
import { OnPeopleIcon } from "./OnPeopleIcon";

type NativeAgent = Record<string, unknown>;

interface AgentCommandRecord {
  id: string;
  command: string;
  status: string;
  pending: boolean;
}

interface AgentRuntimeDetails {
  commands: AgentCommandRecord[];
  prompt: string;
}

interface AgentRecord {
  source: NativeAgent;
  id: string;
  title: string;
  running: boolean;
  failed: boolean;
  workOrder: OrchestrationWorkOrder;
}

export function SubagentPanel() {
  const parentThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const threadLoading = useWorkbenchStore((state) => state.threadLoading);
  const selectThread = useWorkbenchStore((state) => state.selectThread);
  const multiAgentEnabled = useWorkbenchStore(
    (state) => state.status?.policy.multiAgent !== false,
  );
  const [agents, setAgents] = useState<NativeAgent[]>([]);
  const [expandedState, setExpandedState] = useState<{
    threadId: string | null;
    value: boolean;
  }>({ threadId: null, value: false });
  const [dismissedThreadId, setDismissedThreadId] = useState<string | null>(
    null,
  );
  const [agentCommands, setAgentCommands] = useState<
    Record<string, AgentCommandRecord[]>
  >({});
  const [agentPrompts, setAgentPrompts] = useState<Record<string, string>>({});
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [orderVisibility, setOrderVisibility] = useState<
    Record<string, boolean>
  >({});
  const autoExpandedThreadId = useRef<string | null>(null);

  const expanded =
    expandedState.threadId === parentThreadId && expandedState.value;

  const loadCommandRecords = useCallback(async (nextAgents: NativeAgent[]) => {
    const values = await Promise.all(
      nextAgents.map(async (agent) => {
        const id = string(agent.agentId ?? agent.id);
        if (!id) return [id, []] as const;
        try {
          const value = await desktopClient.readAgent(id);
          return [
            id,
            {
              commands: commandRecords(value),
              prompt: workOrderPrompt(value),
            },
          ] as const;
        } catch {
          return [id, { commands: [], prompt: "" }] as const;
        }
      }),
    );
    const details = Object.fromEntries(values) as Record<
      string,
      AgentRuntimeDetails
    >;
    setAgentCommands(
      Object.fromEntries(
        Object.entries(details).map(([id, detail]) => [id, detail.commands]),
      ),
    );
    setAgentPrompts(
      Object.fromEntries(
        Object.entries(details)
          .filter(([, detail]) => Boolean(detail.prompt))
          .map(([id, detail]) => [id, detail.prompt]),
      ),
    );
  }, []);

  const refresh = useCallback(async () => {
    if (!parentThreadId || !multiAgentEnabled) {
      setAgents([]);
      return;
    }
    const result = await desktopClient.listAgents(parentThreadId);
    const nextAgents = result.agents ?? [];
    setAgents(nextAgents);
    const hasRunningAgent = nextAgents.some(
      (agent) => string(agent.status) === "running",
    );
    if (hasRunningAgent && autoExpandedThreadId.current !== parentThreadId) {
      autoExpandedThreadId.current = parentThreadId;
      setExpandedState({ threadId: parentThreadId, value: true });
      setDismissedThreadId(null);
    }
    if (expanded || hasRunningAgent) {
      await loadCommandRecords(nextAgents);
    }
  }, [expanded, loadCommandRecords, multiAgentEnabled, parentThreadId]);

  useEffect(() => {
    if (threadLoading) return;
    let refreshTimer: number | null = window.setTimeout(
      () => void refresh().catch(() => undefined),
      0,
    );
    const unsubscribe = desktopClient.onAgentEvent((event) => {
      const payload = object(event.payload);
      const method = string(payload.method ?? payload.type);
      if (
        !method.includes("thread") &&
        !method.includes("turn") &&
        !method.includes("agent") &&
        method !== "item/started" &&
        method !== "item/completed"
      ) {
        return;
      }
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        () => void refresh().catch(() => undefined),
        100,
      );
    });
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      void unsubscribe.then((dispose) => dispose());
    };
  }, [refresh, threadLoading]);

  const activeCount = useMemo(
    () => agents.filter((agent) => string(agent.status) === "running").length,
    [agents],
  );
  const agentRecords = useMemo(
    () =>
      agents.map((agent): AgentRecord => {
        const id = string(agent.agentId ?? agent.id);
        const title = string(agent.title) || "Agent";
        const status = string(agent.status);
        return {
          source: agent,
          id,
          title,
          running: status === "running",
          failed: status === "failed",
          workOrder: parseOrchestrationWorkOrder(
            agentPrompts[id] || agent.prompt,
            title,
            agent.role,
          ),
        };
      }),
    [agentPrompts, agents],
  );
  const reviewerCount = useMemo(
    () => agentRecords.filter((agent) => agent.workOrder.reviewer).length,
    [agentRecords],
  );
  const deliveredCount = useMemo(
    () =>
      agentRecords.filter((agent) => !agent.running && !agent.failed).length,
    [agentRecords],
  );

  if (
    !multiAgentEnabled ||
    agents.length === 0 ||
    dismissedThreadId === parentThreadId
  )
    return null;

  return (
    <section className="subagent-panel" aria-label="Agent 编排册">
      <div className="subagent-panel-heading">
        <button
          className="subagent-panel-header"
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            const nextExpanded = !expanded;
            setExpandedState({
              threadId: parentThreadId,
              value: nextExpanded,
            });
            if (nextExpanded) void loadCommandRecords(agents);
          }}
        >
          <BookOpenText size={14} aria-hidden="true" />
          <strong>
            {activeCount > 0
              ? `编排册 · ${activeCount} 个 Agent 正在执行`
              : `编排册 · ${agents.length} 个工作单已结束`}
          </strong>
          <span>{expanded ? "收起" : "查看"}</span>
          {expanded ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
        </button>
        <button
          className="subagent-panel-dismiss"
          type="button"
          aria-label="关闭 Agent 活动"
          title="关闭"
          onClick={() => setDismissedThreadId(parentThreadId)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div className="orchestration-ledger">
          <div className="orchestration-ledger-summary">
            <span>
              <Bot size={12} aria-hidden="true" />
              {agents.length} 个工作单
            </span>
            <span>
              <CheckCircle2 size={12} aria-hidden="true" />
              {deliveredCount} 个已交付
            </span>
            <span className={reviewerCount > 0 ? "is-covered" : ""}>
              <ShieldCheck size={12} aria-hidden="true" />
              {reviewerCount > 0 ? `${reviewerCount} 个验收单` : "等待验收安排"}
            </span>
          </div>
          <div className="subagent-panel-list">
            {agentRecords.map((agent, index) => {
              const { id, running, failed, title, workOrder } = agent;
              const commands = agentCommands[id] ?? [];
              const orderExpanded = orderVisibility[id] ?? false;
              return (
                <article
                  className={`orchestration-work-order ${running ? "is-running" : ""} ${failed ? "is-failed" : ""}`}
                  key={id}
                >
                  <span className="orchestration-spine-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="orchestration-work-order-main">
                    <div className="orchestration-work-order-heading">
                      <button
                        type="button"
                        aria-label={`${orderExpanded ? "收起" : "展开"} ${title} 工作单`}
                        aria-expanded={orderExpanded}
                        onClick={() =>
                          setOrderVisibility((current) => ({
                            ...current,
                            [id]: !orderExpanded,
                          }))
                        }
                      >
                        <span
                          className={`subagent-dot ${running ? "is-active" : ""}`}
                        />
                        <span>
                          <strong>{title}</strong>
                          <small>{workOrder.role}</small>
                        </span>
                        {orderExpanded ? (
                          <ChevronUp size={13} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={13} aria-hidden="true" />
                        )}
                      </button>
                      <span className="orchestration-work-order-status">
                        {workOrderProgressLabel(
                          failed ? "failed" : running ? "running" : "completed",
                          workOrder.reviewer,
                        )}
                      </span>
                      {running ? (
                        <button
                          className="subagent-stop"
                          type="button"
                          aria-label={`停止 ${title}`}
                          disabled={stoppingId !== null}
                          onClick={() => {
                            setStoppingId(id);
                            void desktopClient
                              .stopAgent(id)
                              .then(refresh)
                              .catch(() => undefined)
                              .finally(() => setStoppingId(null));
                          }}
                        >
                          <Square size={10} />
                        </button>
                      ) : null}
                    </div>
                    <p
                      className={`orchestration-work-order-objective ${orderExpanded ? "is-expanded" : ""}`}
                    >
                      {workOrder.objective}
                    </p>
                    {orderExpanded ? (
                      <div className="orchestration-work-order-body">
                        <WorkOrderSection
                          icon={<OnPeopleIcon name="scope" size={13} />}
                          label="负责范围"
                          values={workOrder.scope}
                        />
                        <WorkOrderSection
                          icon={<OnPeopleIcon name="clues" size={13} />}
                          label="已知线索"
                          values={workOrder.clues}
                        />
                        <WorkOrderSection
                          icon={<OnPeopleIcon name="deliverables" size={13} />}
                          label="交付物"
                          values={workOrder.deliverables}
                        />
                        <WorkOrderSection
                          icon={<OnPeopleIcon name="verification" size={13} />}
                          label="验收标准"
                          values={workOrder.verification}
                        />
                        <WorkOrderSection
                          icon={<OnPeopleIcon name="constraints" size={13} />}
                          label="边界"
                          values={workOrder.constraints}
                        />
                      </div>
                    ) : null}
                    {orderExpanded ? (
                      <div className="orchestration-work-order-detail-footer">
                        <div className="subagent-command-list">
                          {commands.length > 0 ? (
                            commands.map((command) => (
                              <div
                                className="subagent-command-row"
                                key={command.id}
                              >
                                <TerminalSquare size={12} aria-hidden="true" />
                                <code title={command.command}>
                                  {command.command}
                                </code>
                                <span
                                  className={
                                    command.pending ? "is-running" : ""
                                  }
                                >
                                  {command.status}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="subagent-command-empty">
                              暂无命令记录
                            </span>
                          )}
                        </div>
                        <button
                          className="orchestration-open-thread"
                          type="button"
                          onClick={() => void selectThread(id)}
                        >
                          <MessageSquareText size={12} aria-hidden="true" />
                          打开完整记录
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkOrderSection({
  icon,
  label,
  values,
}: {
  icon: ReactNode;
  label: string;
  values: string[];
}) {
  if (values.length === 0) return null;
  return (
    <section className="orchestration-work-order-section">
      <strong>
        {icon}
        {label}
      </strong>
      <ul>
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </section>
  );
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function commandRecords(value: unknown): AgentCommandRecord[] {
  const response = object(value);
  const thread = object(response.thread ?? response);
  const page = object(response.initialTurnsPage);
  const itemsPage = object(response.itemsPage);
  const turns = Array.isArray(thread.turns)
    ? thread.turns
    : Array.isArray(page.data)
      ? page.data
      : [];
  const records: AgentCommandRecord[] = [];
  const seen = new Set<string>();

  const appendItem = (
    item: unknown,
    fallbackId: string,
    turnPending = false,
  ) => {
    const current = object(item);
    const type = string(current.type);
    const id = string(current.id) || fallbackId;
    const status = string(object(current.status).type ?? current.status);
    const pending = turnPending || status === "inProgress";
    const failed =
      status === "failed" ||
      status === "systemError" ||
      current.success === false;
    const commands =
      type === "commandExecution"
        ? [
            Array.isArray(current.command)
              ? current.command.map(string).filter(Boolean).join(" ")
              : string(current.command),
          ]
        : type === "dynamicToolCall" && string(current.tool) === "exec"
          ? commandsFromExecInput(object(current.arguments).input)
          : [];

    commands.filter(Boolean).forEach((command, commandIndex) => {
      const recordId = `${id}-${commandIndex}`;
      if (seen.has(recordId)) return;
      seen.add(recordId);
      records.push({
        id: recordId,
        command,
        pending,
        status: pending ? "运行中" : failed ? "失败" : "已完成",
      });
    });
  };

  turns.forEach((turn, turnIndex) => {
    const currentTurn = object(turn);
    const turnPending = string(currentTurn.status) === "inProgress";
    const items = Array.isArray(currentTurn.items) ? currentTurn.items : [];
    items.forEach((item, itemIndex) => {
      appendItem(
        item,
        `${string(currentTurn.id) || turnIndex}-${itemIndex}`,
        turnPending,
      );
    });
  });

  if (Array.isArray(itemsPage.data)) {
    itemsPage.data.forEach((entry, itemIndex) => {
      const current = object(entry);
      appendItem(current.item ?? current, `history-${itemIndex}`);
    });
  }

  if (Array.isArray(response.legacyExecItems)) {
    response.legacyExecItems.forEach((item, itemIndex) => {
      appendItem(item, `legacy-exec-${itemIndex}`);
    });
  }

  return records.slice(-3);
}

function workOrderPrompt(value: unknown): string {
  const response = object(value);
  const thread = object(response.thread ?? response);
  const page = object(response.initialTurnsPage);
  const itemsPage = object(response.itemsPage);
  const turns = Array.isArray(thread.turns)
    ? thread.turns
    : Array.isArray(page.data)
      ? page.data
      : [];
  const candidates: unknown[] = [];
  turns.forEach((turn) => {
    const items = object(turn).items;
    if (Array.isArray(items)) candidates.push(...items);
  });
  if (Array.isArray(itemsPage.data)) {
    itemsPage.data.forEach((entry) => {
      const current = object(entry);
      candidates.push(current.item ?? current);
    });
  }

  for (const candidate of candidates) {
    const item = object(candidate);
    if (string(item.type) !== "userMessage") continue;
    const text = messageText(item.content ?? item.text ?? item.message);
    if (text) return text;
  }
  return "";
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return string(object(value).text).trim();
  return value
    .map((part) =>
      typeof part === "string" ? part : string(object(part).text ?? part),
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function commandsFromExecInput(value: unknown): string[] {
  const input = string(value);
  if (!input) return [];
  const commands: string[] = [];
  const pattern =
    /\bexec_command\s*\(\s*\{\s*cmd\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  for (const match of input.matchAll(pattern)) {
    const encoded = match[1];
    if (!encoded) continue;
    const decoded = decodeJavascriptString(encoded);
    if (decoded) commands.push(decoded);
  }
  return commands.length > 0 ? commands : ["exec"];
}

function decodeJavascriptString(value: string): string {
  if (value.startsWith('"')) {
    try {
      return string(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  return value
    .slice(1, -1)
    .replace(/\\n/g, "\n")
    .replace(/\\([\\'`])/g, "$1");
}
