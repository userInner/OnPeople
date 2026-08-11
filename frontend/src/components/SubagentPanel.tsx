import {
  Bot,
  ChevronDown,
  ChevronUp,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import { useWorkbenchStore } from "../store/workbenchStore";

type NativeAgent = Record<string, unknown>;

interface AgentCommandRecord {
  id: string;
  command: string;
  status: string;
  pending: boolean;
}

export function SubagentPanel() {
  const parentThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const threadLoading = useWorkbenchStore((state) => state.threadLoading);
  const selectThread = useWorkbenchStore((state) => state.selectThread);
  const multiAgentEnabled = useWorkbenchStore(
    (state) => state.status?.policy.multiAgent !== false,
  );
  const [agents, setAgents] = useState<NativeAgent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissedThreadId, setDismissedThreadId] = useState<string | null>(
    null,
  );
  const [agentCommands, setAgentCommands] = useState<
    Record<string, AgentCommandRecord[]>
  >({});
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const loadCommandRecords = useCallback(async (nextAgents: NativeAgent[]) => {
    const values = await Promise.all(
      nextAgents.map(async (agent) => {
        const id = string(agent.agentId ?? agent.id);
        if (!id) return [id, []] as const;
        try {
          const value = await desktopClient.readAgent(id);
          return [id, commandRecords(value)] as const;
        } catch {
          return [id, []] as const;
        }
      }),
    );
    setAgentCommands(Object.fromEntries(values));
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
    if (hasRunningAgent) {
      setExpanded(true);
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

  if (
    !multiAgentEnabled ||
    agents.length === 0 ||
    dismissedThreadId === parentThreadId
  )
    return null;

  return (
    <section className="subagent-panel" aria-label="子 Agent 活动">
      <div className="subagent-panel-heading">
        <button
          className="subagent-panel-header"
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            const nextExpanded = !expanded;
            setExpanded(nextExpanded);
            if (nextExpanded) void loadCommandRecords(agents);
          }}
        >
          <Bot size={14} aria-hidden="true" />
          <strong>
            {activeCount > 0
              ? `${activeCount} 个 Agent 正在运行`
              : `${agents.length} 个 Agent 已完成`}
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
        <div className="subagent-panel-list">
          {agents.map((agent) => {
            const id = string(agent.agentId ?? agent.id);
            const running = string(agent.status) === "running";
            const title = string(agent.title) || "Agent";
            const commands = agentCommands[id] ?? [];
            return (
              <div className="subagent-panel-row" key={id}>
                <button
                  type="button"
                  aria-label={`打开 ${title} 完整记录`}
                  title="打开完整记录"
                  onClick={() => void selectThread(id)}
                >
                  <span
                    className={`subagent-dot ${running ? "is-active" : ""}`}
                  />
                  <span>
                    <strong>{title}</strong>
                    <small>
                      {string(agent.role) || "default"}
                      {string(agent.nickname)
                        ? ` · ${string(agent.nickname)}`
                        : ""}
                    </small>
                  </span>
                </button>
                <span>{running ? "运行中" : "已完成"}</span>
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
                <div className="subagent-command-list">
                  {commands.length > 0 ? (
                    commands.map((command) => (
                      <div className="subagent-command-row" key={command.id}>
                        <TerminalSquare size={12} aria-hidden="true" />
                        <code title={command.command}>{command.command}</code>
                        <span className={command.pending ? "is-running" : ""}>
                          {command.status}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="subagent-command-empty">
                      暂无命令记录 · 点击 Agent 查看完整时间线
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
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
