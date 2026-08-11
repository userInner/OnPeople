export type SlashCommandId =
  | "agent"
  | "archive"
  | "compact"
  | "diff"
  | "fast"
  | "fork"
  | "goal"
  | "hooks"
  | "mcp"
  | "memories"
  | "model"
  | "new"
  | "permissions"
  | "plan"
  | "plugins"
  | "ps"
  | "review"
  | "settings"
  | "skills"
  | "status"
  | "subagents"
  | "terminal";

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  description: string;
  keywords: string;
  requiresThread?: boolean;
}

export const slashCommands: readonly SlashCommand[] = [
  {
    id: "new",
    label: "新建对话",
    description: "创建一个新的独立任务",
    keywords: "new task chat 新任务",
  },
  {
    id: "model",
    label: "选择模型",
    description: "切换模型、推理强度与速度",
    keywords: "model effort speed 模型 推理 速度",
  },
  {
    id: "permissions",
    label: "调整权限",
    description: "选择工作区访问和审批策略",
    keywords: "permissions sandbox approval access 权限 访问 审批",
  },
  {
    id: "agent",
    label: "Agent 模式",
    description: "自主执行任务并使用工具",
    keywords: "agent execute 执行",
  },
  {
    id: "plan",
    label: "计划模式",
    description: "先分析并给出执行计划",
    keywords: "plan planning 规划 计划",
  },
  {
    id: "goal",
    label: "目标模式",
    description: "持续执行直到完成或受阻",
    keywords: "goal persistent 目标",
  },
  {
    id: "compact",
    label: "压缩上下文",
    description: "压缩当前对话并保留关键事实",
    keywords: "compact context summarize 上下文 压缩",
    requiresThread: true,
  },
  {
    id: "memories",
    label: "管理记忆",
    description: "查看个人、项目记忆及召回设置",
    keywords: "memories memory 记忆 长期记忆",
  },
  {
    id: "plugins",
    label: "打开插件",
    description: "浏览 Skills、插件和 MCP 服务",
    keywords: "plugins extensions apps 插件 扩展",
  },
  {
    id: "skills",
    label: "打开 Skills",
    description: "管理当前工作区的 Skills",
    keywords: "skills workflow 技能 工作流",
  },
  {
    id: "mcp",
    label: "管理 MCP",
    description: "打开连接与 MCP 服务配置",
    keywords: "mcp connections servers 连接 服务",
  },
  {
    id: "hooks",
    label: "管理 Hooks",
    description: "配置任务生命周期自动化",
    keywords: "hooks automation lifecycle 钩子 自动化",
  },
  {
    id: "review",
    label: "代码审查",
    description: "打开 Git 变更与审查工具",
    keywords: "review pr git 审查 拉取请求",
  },
  {
    id: "diff",
    label: "查看变更",
    description: "查看当前工作区 Git diff",
    keywords: "diff git changes 变更 差异",
  },
  {
    id: "subagents",
    label: "查看子 Agent",
    description: "查看并管理并行 Agent 和后台进程",
    keywords: "subagents agents multi agent 子智能体 多智能体",
  },
  {
    id: "ps",
    label: "后台进程",
    description: "查看 Agent、终端和运行时进程",
    keywords: "ps process background 进程 后台",
  },
  {
    id: "status",
    label: "任务状态",
    description: "查看当前任务、运行时和上下文状态",
    keywords: "status diagnostics runtime 状态 诊断",
  },
  {
    id: "terminal",
    label: "打开终端",
    description: "打开当前工作区集成终端",
    keywords: "terminal shell cli 终端 命令行",
  },
  {
    id: "fork",
    label: "派生对话",
    description: "从当前状态创建新的任务分支",
    keywords: "fork branch thread 派生 分支",
    requiresThread: true,
  },
  {
    id: "archive",
    label: "归档对话",
    description: "归档当前任务并返回新对话",
    keywords: "archive close 归档",
    requiresThread: true,
  },
  {
    id: "fast",
    label: "快速响应",
    description: "将当前响应速度切换为快速",
    keywords: "fast speed 快速 速度",
  },
  {
    id: "settings",
    label: "打开设置",
    description: "打开 OnPeople 设置中心",
    keywords: "settings preferences 设置 偏好",
  },
] as const;

export function slashQuery(value: string): string | null {
  if (!value.startsWith("/") || value.includes("\n")) return null;
  const query = value.slice(1);
  if (/\s/u.test(query)) return null;
  return query.toLocaleLowerCase();
}

export function matchingSlashCommands(
  value: string,
  hasThread = true,
): SlashCommand[] {
  const query = slashQuery(value);
  if (query === null) return [];
  const available = slashCommands.filter(
    (command) => hasThread || !command.requiresThread,
  );
  if (!query) return [...available];
  return available
    .filter((command) =>
      `${command.id} ${command.label} ${command.keywords}`
        .toLocaleLowerCase()
        .includes(query),
    )
    .sort((left, right) => {
      const leftPrefix = left.id.startsWith(query) ? 0 : 1;
      const rightPrefix = right.id.startsWith(query) ? 0 : 1;
      return leftPrefix - rightPrefix;
    });
}
