(function taskTraceModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OnPeopleTrace = api;
})(typeof window !== "undefined" ? window : null, () => {
  const SECRET_PATTERNS = [
    [/(\b[A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY)\b\s*=\s*)[^\s]+/g, "$1[REDACTED]"],
    [/(\bauthorization\b\s*[=:]\s*)(?:Bearer\s+)?[^\s,;\]}]+/gi, "$1[REDACTED]"],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
    [/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|set-cookie)\b\s*[=:]\s*)([^\s,;\]}]+)/gi, "$1[REDACTED]"],
    [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[REDACTED]"],
    [/([?&](?:key|token|access_token|api_key|password|secret)=)[^&#\s]+/gi, "$1[REDACTED]"],
    [/("(?:apiKey|api_key|authorization|token|access_token|refresh_token|password|secret|cookie)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2"],
  ];

  function text(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  function redactTraceText(value) {
    let result = text(value);
    for (const [pattern, replacement] of SECRET_PATTERNS) result = result.replace(pattern, replacement);
    return result;
  }

  function truncateTraceText(value, limit = 12_000) {
    const clean = redactTraceText(value);
    if (clean.length <= limit) return clean;
    const head = Math.max(800, Math.floor(limit * 0.24));
    const tail = Math.max(1_600, limit - head - 40);
    return `${clean.slice(0, head)}\n\n… ${clean.length - head - tail} characters omitted …\n\n${clean.slice(-tail)}`;
  }

  function firstLine(value, fallback) {
    const line = redactTraceText(value).split("\n").map((part) => part.trim()).find(Boolean);
    if (!line) return fallback;
    return line.length > 160 ? `${line.slice(0, 159)}…` : line;
  }

  function itemType(item = {}) {
    return String(item.type || item.kind || "event").replace(/[ _-]/g, "").toLowerCase();
  }

  function detailFrom(item = {}) {
    return item.aggregatedOutput || item.output || item.result || item.error?.message || item.error || item.details || "";
  }

  function commandTarget(command) {
    const matches = [...String(command || "").matchAll(/(?:^|[\s'\"])([^\s'\";|]+\.(?:[cm]?[jt]sx?|json|md|css|html?|go|py|rs|toml|ya?ml|txt))(?:$|[\s'\";|])/gi)];
    const target = matches.at(-1)?.[1] || "";
    return target.split(/[\\/]/).pop() || target;
  }

  function webSearchActionDetail(item = {}) {
    const action = item.action && typeof item.action === "object" ? item.action : {};
    const type = String(action.type || "").replace(/[ _-]/g, "").toLowerCase();
    if (type === "search") {
      const queries = Array.isArray(action.queries) ? action.queries.filter(Boolean) : [];
      const first = action.query || item.query || queries[0] || "";
      return queries.length > 1 && first ? `${first} …` : first;
    }
    if (type === "openpage") return action.url || item.query || "";
    if (type === "findinpage") {
      return [
        action.pattern && `'${action.pattern}'`,
        action.url,
      ].filter(Boolean).join(" · ");
    }
    return item.query || item.text || "";
  }

  function toolInputText(item = {}) {
    return text(item.arguments || item.input || item.params || item.command || "").toLowerCase();
  }

  function classifyTool(item = {}) {
    const toolName = String(item.tool || item.name || item.method || "").toLowerCase();
    const server = String(item.server || item.serverName || "").toLowerCase();
    const input = toolInputText(item);
    const combined = `${server} ${toolName} ${input}`;
    if (/(?:web__run|web\.run|search_query|searchquery|browser_search|websearch)/.test(combined)) return "search";
    if (/(?:internal_browser|browser)[\s_.-]*(?:navigate|open|click|snapshot|find|read)/.test(combined)) return "browse";
    if (/(?:read_file|readfile|read_directory|readdir|cat_file|file_read)/.test(combined)) return "read";
    if (/(?:write_file|writefile|apply_patch|edit_file|editfile|file_change|patch)/.test(combined)) return "files";
    return "tool";
  }

  function toolActionSummary(item = {}, kind = "tool") {
    const input = text(item.arguments || item.input || item.params || "");
    if (kind === "search") {
      const match = input.match(/(?:q|query|search_query)\s*[:=]\s*["']([^"']+)/i);
      return match?.[1] || firstLine(item.tool || item.name || "搜索网页", "搜索网页");
    }
    if (kind === "browse") {
      const match = input.match(/https?:\/\/[^\s"'}]+/i);
      return match?.[0] || "打开网页";
    }
    if (kind === "read" || kind === "files") {
      const match = input.match(/(?:path|file|filename)\s*[:=]\s*["']?([^,"'}\n]+)/i);
      return match?.[1]?.split(/[\\/]/).pop() || (kind === "read" ? "读取文件" : "更新文件");
    }
    return firstLine(item.tool || item.name || "调用工具", "调用工具");
  }

  function researchToolSummary(toolName) {
    const summaries = {
      research_search_papers: "检索学术文献",
      research_resolve_doi: "解析文献标识",
      research_verify_reference: "核验参考文献",
      research_search_datasets: "检索研究数据",
      research_lookup_institution: "查询研究机构",
      research_search_trials: "检索临床试验",
      research_source_status: "检查资料来源",
    };
    return summaries[String(toolName || "").toLowerCase()] || null;
  }

  function normalizeTraceItem(item = {}, phase = "completed") {
    const type = itemType(item);
    const status = String(item.status || phase || "completed").toLowerCase();
    const id = String(item.id || item.itemId || item.callId || item.processId || "");
    if (type === "commandexecution" || type === "command") {
      const commandText = Array.isArray(item.command) ? item.command.join(" ") : String(item.command || "");
      const target = commandTarget(commandText);
      const readCommand = /(?:^|[\s'\"])(?:cat|head|tail|sed)(?:\s|$)/.test(commandText);
      const searchCommand = /(?:^|[\s'\"])(?:rg|grep)(?:\s|$)/.test(commandText);
      const searchMatch = commandText.match(/(?:rg|grep)\s+(?:-\S+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s'\"]+))/);
      const searchTerm = searchMatch?.[1] || searchMatch?.[2] || searchMatch?.[3] || "";
      return {
        id, kind: searchCommand ? "search" : readCommand ? "read" : "command", label: "COMMAND", status,
        summary: searchCommand && (searchTerm || target) ? [searchTerm, target].filter(Boolean).join(" · ") : readCommand && target ? target : firstLine(commandText, "运行命令"),
        detail: truncateTraceText(detailFrom(item)),
      };
    }
    if (type === "collabagenttoolcall") {
      const tool = String(item.tool || item.name || "").replace(/[ _-]/g, "").toLowerCase();
      const receivers = item.receiverThreadIds || item.receiver_thread_ids || [];
      const agentsStates = item.agentsStates || item.agents_states || {};
      const summaries = {
        spawnagent: "派发子 Agent",
        sendinput: "向子 Agent 追加指令",
        resumeagent: "恢复子 Agent",
        wait: "等待子 Agent",
        closeagent: "停止子 Agent",
      };
      const detail = [
        item.prompt && `INSTRUCTION\n${item.prompt}`,
        receivers.length && `THREADS\n${receivers.join("\n")}`,
        Object.keys(agentsStates).length && `STATES\n${text(agentsStates)}`,
        detailFrom(item) && `RESULT\n${text(detailFrom(item))}`,
      ].filter(Boolean).join("\n\n");
      return {
        id, kind: "agent", label: "SUBAGENT", status,
        summary: summaries[tool] || firstLine(item.tool, "协调子 Agent"),
        detail: truncateTraceText(detail),
      };
    }
    if (type === "subagentactivity") {
      const activity = String(item.kind || item.activity || "started").toLowerCase();
      const summaries = { started: "子 Agent 已开始", interacted: "子 Agent 正在协作", interrupted: "子 Agent 已中断" };
      const agentPath = item.agentPath || item.agent_path || "";
      const agentThreadId = item.agentThreadId || item.agent_thread_id || "";
      return {
        id, kind: "agent", label: "SUBAGENT", status: activity === "interrupted" ? "failed" : status,
        summary: summaries[activity] || "子 Agent 状态更新",
        detail: truncateTraceText([agentPath && `PATH\n${agentPath}`, agentThreadId && `THREAD\n${agentThreadId}`].filter(Boolean).join("\n\n")),
      };
    }
    if (type === "mcptoolcall" || type === "toolcall" || type === "customtoolcall") {
      const server = item.server || item.serverName || "TOOL";
      const tool = item.tool || item.name || item.method || "调用工具";
      const argumentsText = item.arguments || item.input || item.params;
      const resultText = detailFrom(item);
      const kind = classifyTool(item);
      const researchSummary = researchToolSummary(tool);
      if (researchSummary) {
        const unavailable = status === "failed" || /(?:429|rate.?limit|too many requests)/i.test(text(resultText));
        return {
          id, kind: "search", label: "科研资料", status,
          summary: researchSummary,
          detail: unavailable ? "一个公开资料来源暂时不可用；任务会继续使用其他可用来源。" : "已通过公开学术资料来源完成查询，结果将由科研助手整理到交付内容中。",
        };
      }
      return {
        id, kind, label: kind === "search" ? "WEB SEARCH" : kind === "browse" ? "BROWSER" : server === "TOOL" ? "TOOL" : `MCP · ${server}`, status,
        summary: toolActionSummary(item, kind),
        detail: truncateTraceText([argumentsText && `INPUT\n${text(argumentsText)}`, resultText && `RESULT\n${text(resultText)}`].filter(Boolean).join("\n\n")),
      };
    }
    if (type === "filechange" || type === "files") {
      const changes = (item.changes || []).map((change) => `${change.kind?.type || change.kind || "change"}  ${change.path || ""}`.trim()).join("\n");
      return { id, kind: "files", label: "FILES", status, summary: `${(item.changes || []).length || 1} 项文件变更`, detail: truncateTraceText(changes || detailFrom(item)) };
    }
    if (type === "reasoning") {
      const summary = item.summary || item.text || item.content;
      return { id, kind: "reasoning", label: "REASONING SUMMARY", status, summary: firstLine(summary, "推理摘要"), detail: truncateTraceText(summary) };
    }
    if (type === "plan" || type === "planupdate") {
      return { id, kind: "plan", label: "PLAN", status, summary: firstLine(item.explanation || item.text, "计划已更新"), detail: truncateTraceText(item.text || item.explanation || detailFrom(item)) };
    }
    if (type === "websearch" || type === "search") {
      return {
        id,
        kind: "search",
        label: "WEB SEARCH",
        status,
        summary: firstLine(webSearchActionDetail(item), "搜索网页"),
        detail: truncateTraceText(detailFrom(item)),
      };
    }
    if (type === "error" || status === "failed") {
      return { id, kind: "error", label: String(item.label || "ERROR").toUpperCase(), status: "failed", summary: firstLine(item.message || detailFrom(item), "任务执行失败"), detail: truncateTraceText(item.message || detailFrom(item)) };
    }
    return { id, kind: "event", label: String(item.label || item.type || "EVENT").toUpperCase(), status, summary: firstLine(item.message || item.text, "任务事件"), detail: truncateTraceText(detailFrom(item)) };
  }

  function activityLabel(record = {}, status = "completed") {
    const running = status === "running";
    const completed = status === "completed";
    const verbs = {
      command: running ? "正在运行命令" : completed ? "已运行命令" : "运行命令失败",
      tool: running ? "正在调用" : completed ? "已调用" : "调用失败",
      files: running ? "正在编辑文件" : completed ? "已编辑文件" : "编辑文件失败",
      read: running ? "正在读取文件" : completed ? "已读取文件" : "读取文件失败",
      plan: running ? "正在更新计划" : completed ? "已更新计划" : "更新计划失败",
      reasoning: running ? "正在整理思路" : completed ? "已整理思路" : "整理思路失败",
      search: running ? "正在搜索网页" : completed ? "已搜索网页" : "搜索网页失败",
      browse: running ? "正在打开网页" : completed ? "已打开网页" : "打开网页失败",
      agent: running ? "正在协调" : completed ? "已协调" : "协调失败",
      error: "执行失败",
      event: running ? "正在处理" : completed ? "已处理" : "处理失败",
    };
    if (record.kind === "tool") {
      const server = String(record.label || "").replace(/^MCP\s*·\s*/i, "").replace(/^TOOL$/i, "工具");
      return `${verbs.tool}${server ? ` ${server}` : ""}`;
    }
    return verbs[record.kind] || verbs.event;
  }

  return { activityLabel, normalizeTraceItem, redactTraceText, truncateTraceText, webSearchActionDetail };
});
