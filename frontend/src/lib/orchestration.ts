export type WorkOrderSectionKey =
  | "scope"
  | "clues"
  | "deliverables"
  | "verification"
  | "constraints";

export interface OrchestrationWorkOrder {
  role: string;
  objective: string;
  scope: string[];
  clues: string[];
  deliverables: string[];
  verification: string[];
  constraints: string[];
  reviewer: boolean;
}

const HEADING_ALIASES: Array<{
  key: WorkOrderSectionKey | "role" | "objective";
  pattern: RegExp;
}> = [
  { key: "role", pattern: /^(?:角色|role|身份)$/i },
  {
    key: "objective",
    pattern: /^(?:目标|任务目标|objective|task|mission)$/i,
  },
  {
    key: "scope",
    pattern:
      /^(?:范围|负责范围|任务范围|你负责的项目|assigned items?|scope|ownership)$/i,
  },
  {
    key: "clues",
    pattern: /^(?:已知线索|上下文|背景|known clues?|context|background)$/i,
  },
  {
    key: "deliverables",
    pattern: /^(?:交付物|输出|输出格式|deliverables?|outputs?|result format)$/i,
  },
  {
    key: "verification",
    pattern:
      /^(?:验证|验证方式|验收|验收标准|verification|validation|acceptance criteria)$/i,
  },
  {
    key: "constraints",
    pattern: /^(?:边界|约束|不要做|禁止事项|constraints?|boundaries|do not)$/i,
  },
];

export function parseOrchestrationWorkOrder(
  prompt: unknown,
  fallbackTitle: unknown,
  fallbackRole: unknown,
): OrchestrationWorkOrder {
  const text = string(prompt).replace(/\r\n?/g, "\n").trim();
  const sections: Record<WorkOrderSectionKey, string[]> = {
    scope: [],
    clues: [],
    deliverables: [],
    verification: [],
    constraints: [],
  };
  let role = normalizeInline(string(fallbackRole));
  let objective = "";
  let active: WorkOrderSectionKey | "role" | "objective" | null = null;
  const unscoped: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || isEnvelopeLine(line)) continue;
    const heading = parseHeading(line);
    if (heading) {
      active = heading.key;
      if (heading.value) {
        if (active === "role") role = normalizeInline(heading.value);
        else if (active === "objective")
          objective = normalizeInline(heading.value);
        else append(sections[active], heading.value);
      }
      continue;
    }

    const value = normalizeListItem(line);
    if (!value) continue;
    if (active === "role") {
      if (!role) role = value;
      continue;
    }
    if (active === "objective") {
      objective = objective ? `${objective} ${value}` : value;
      continue;
    }
    if (active) append(sections[active], value);
    else unscoped.push(value);
  }

  if (!objective) {
    objective =
      unscoped.find((value) => !looksLikePreamble(value)) ||
      normalizeInline(string(fallbackTitle)) ||
      "完成分配的工作并返回可核验结果";
  }
  if (!role || role === "default") role = "执行 Agent";

  const reviewer = /review|reviewer|审查|复核|验收/i.test(
    `${role} ${string(fallbackTitle)} ${text.slice(0, 400)}`,
  );

  return {
    role,
    objective,
    ...sections,
    reviewer,
  };
}

export function workOrderProgressLabel(
  status: unknown,
  reviewer: boolean,
): string {
  const value = string(status).toLowerCase();
  if (value === "running") return reviewer ? "正在验收" : "执行中";
  if (value === "failed") return reviewer ? "验收失败" : "执行失败";
  return reviewer ? "已验收" : "已交付";
}

function parseHeading(
  line: string,
): { key: WorkOrderSectionKey | "role" | "objective"; value: string } | null {
  const cleaned = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*{1,2}|\*{1,2}$/g, "")
    .trim();
  const bracketed = cleaned.match(/^【([^】]+)】\s*(.*)$/);
  const separated = cleaned.match(/^([^:：]{1,28})[:：]\s*(.*)$/);
  const label = normalizeInline(bracketed?.[1] ?? separated?.[1] ?? cleaned);
  const value = normalizeInline(bracketed?.[2] ?? separated?.[2] ?? "");
  const matched = HEADING_ALIASES.find(({ pattern }) => pattern.test(label));
  return matched ? { key: matched.key, value } : null;
}

function append(target: string[], value: string) {
  const normalized = normalizeListItem(value);
  if (normalized && !target.includes(normalized) && target.length < 8) {
    target.push(normalized);
  }
}

function normalizeListItem(value: string): string {
  return normalizeInline(
    value
      .replace(/^[-*+•]\s*/, "")
      .replace(/^\d+[.)、]\s*/, "")
      .replace(/^\[[ xX]\]\s*/, ""),
  );
}

function normalizeInline(value: string): string {
  return value
    .replace(/^`|`$/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEnvelopeLine(value: string): boolean {
  return /^<\/?(?:work_order|agent_work_order|onpeople_orchestration)>$/i.test(
    value,
  );
}

function looksLikePreamble(value: string): boolean {
  return /^(?:你是|you are|今天是|today is|工作单|work order)/i.test(value);
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
