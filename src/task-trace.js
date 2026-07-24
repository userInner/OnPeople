(function taskTraceModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OnPeopleTrace = api;
})(typeof window !== "undefined" ? window : null, () => {
  const SECRET_PATTERNS = [
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
    if (type === "mcptoolcall" || type === "toolcall" || type === "customtoolcall") {
      const server = item.server || item.serverName || "TOOL";
      const tool = item.tool || item.name || item.method || "调用工具";
      const argumentsText = item.arguments || item.input || item.params;
      const resultText = detailFrom(item);
      return {
        id, kind: "tool", label: server === "TOOL" ? "TOOL" : `MCP · ${server}`, status,
        summary: firstLine(tool, "调用工具"),
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
      return { id, kind: "search", label: "WEB SEARCH", status, summary: firstLine(item.query || item.text, "搜索网页"), detail: truncateTraceText(detailFrom(item)) };
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
      command: running ? "正在运行" : completed ? "已运行" : "运行失败",
      tool: running ? "正在调用" : completed ? "已调用" : "调用失败",
      files: running ? "正在更新" : completed ? "已更新" : "更新失败",
      read: running ? "正在读取" : completed ? "已读取" : "读取失败",
      plan: running ? "正在规划" : completed ? "已规划" : "规划失败",
      reasoning: running ? "正在思考" : completed ? "已思考" : "思考失败",
      search: running ? "正在搜索" : completed ? "已搜索" : "搜索失败",
      error: "执行失败",
      event: running ? "正在处理" : completed ? "已处理" : "处理失败",
    };
    if (record.kind === "tool") {
      const server = String(record.label || "").replace(/^MCP\s*·\s*/i, "").replace(/^TOOL$/i, "工具");
      return `${verbs.tool}${server ? ` ${server}` : ""}`;
    }
    return verbs[record.kind] || verbs.event;
  }

  return { activityLabel, normalizeTraceItem, redactTraceText, truncateTraceText };
});
