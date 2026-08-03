const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { activityLabel, normalizeTraceItem, redactTraceText, truncateTraceText, webSearchActionDetail } = require("../src/task-trace.js");

assert.equal(redactTraceText("Authorization: Bearer abc.def.ghi"), "Authorization: [REDACTED]");
assert.equal(redactTraceText("api_key=sk-example1234567890"), "api_key=[REDACTED]");
assert.equal(redactTraceText('{"password":"hello"}'), '{"password":"[REDACTED]"}');
assert.equal(redactTraceText("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz"), "GITHUB_TOKEN=[REDACTED]");
assert.equal(redactTraceText("OPENAI_API_KEY=plain-secret-value-123456"), "OPENAI_API_KEY=[REDACTED]");
assert.equal(redactTraceText("AWS_SECRET_ACCESS_KEY=ABCD1234EFGH5678"), "AWS_SECRET_ACCESS_KEY=[REDACTED]");
assert.match(truncateTraceText("x".repeat(20_000), 1_000), /characters omitted/);

const command = normalizeTraceItem({ id: "1", type: "commandExecution", command: "npm test", aggregatedOutput: "passed", status: "completed" });
assert.deepEqual({ kind: command.kind, label: command.label, summary: command.summary, detail: command.detail }, { kind: "command", label: "COMMAND", summary: "npm test", detail: "passed" });

const tool = normalizeTraceItem({ type: "mcpToolCall", server: "browser", tool: "navigate", arguments: { token: "secret-token" }, status: "inProgress" }, "started");
assert.equal(tool.label, "BROWSER");
assert.equal(tool.summary, "打开网页");
assert.match(tool.detail, /\[REDACTED\]/);
assert.equal(activityLabel(command, "completed"), "已运行命令");
assert.equal(activityLabel(tool, "running"), "正在打开网页");
const read = normalizeTraceItem({ type: "commandExecution", command: "/bin/zsh -lc 'sed -n 1,20p src/main.cjs'", status: "completed" });
assert.equal(read.kind, "read"); assert.equal(read.summary, "main.cjs"); assert.equal(activityLabel(read, "completed"), "已读取文件");
const search = normalizeTraceItem({ type: "commandExecution", command: "rg -n \"browser_fill\" src/browser-mcp.cjs", status: "completed" });
assert.equal(search.kind, "search"); assert.equal(search.summary, "browser_fill · browser-mcp.cjs");
const webSearchStarted = normalizeTraceItem({ id: "ws-1", type: "webSearch", query: "", action: null, status: "inProgress" }, "started");
assert.equal(webSearchStarted.summary, "搜索网页");
assert.equal(activityLabel(webSearchStarted, "running"), "正在搜索网页");
const webSearchCompleted = normalizeTraceItem({
  id: "ws-1",
  type: "webSearch",
  query: "OnPeople news",
  action: { type: "search", query: "OnPeople news", queries: ["OnPeople news", "AI agent news"] },
  status: "completed",
});
assert.equal(webSearchCompleted.summary, "OnPeople news …");
assert.equal(webSearchActionDetail({ action: { type: "openPage", url: "https://example.com/news" } }), "https://example.com/news");
assert.equal(webSearchActionDetail({ action: { type: "findInPage", pattern: "release", url: "https://example.com/news" } }), "'release' · https://example.com/news");
const nativeSearchTool = normalizeTraceItem({
  type: "customToolCall",
  name: "exec",
  input: 'const result = await tools.web__run({search_query:[{q:"Node.js LTS"}]});',
  status: "completed",
});
assert.equal(nativeSearchTool.kind, "search");
assert.equal(nativeSearchTool.summary, "Node.js LTS");
assert.equal(activityLabel(nativeSearchTool, "completed"), "已搜索网页");
const browserTool = normalizeTraceItem({ type: "mcpToolCall", server: "internal_browser", tool: "navigate", arguments: { url: "https://example.com" }, status: "completed" });
assert.equal(browserTool.kind, "browse");
assert.equal(activityLabel(browserTool, "completed"), "已打开网页");
const researchTool = normalizeTraceItem({
  type: "mcpToolCall",
  server: "research-sources",
  tool: "research_verify_reference",
  result: { evidenceLevel: "metadata-only", source: "Crossref", error: "HTTP 429" },
  status: "completed",
});
assert.equal(researchTool.label, "科研资料");
assert.equal(researchTool.summary, "核验参考文献");
assert.doesNotMatch(researchTool.detail, /research_verify_reference|evidenceLevel|Crossref|429/);
const collab = normalizeTraceItem({ type: "collabAgentToolCall", id: "a1", tool: "spawnAgent", receiverThreadIds: ["child-1"], status: "completed" });
assert.equal(collab.kind, "agent"); assert.equal(collab.summary, "派发子 Agent"); assert.equal(activityLabel(collab, "completed"), "已协调");
const subagent = normalizeTraceItem({ type: "subAgentActivity", id: "a2", kind: "started", agentThreadId: "child-1", agentPath: "root/child-1" }, "started");
assert.equal(subagent.kind, "agent"); assert.equal(subagent.summary, "子 Agent 已开始"); assert.match(subagent.detail, /root\/child-1/);

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src/renderer.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
assert.ok(renderer.includes("function ensureProcessFlow("), "turn activity must render inside a shared process flow");
assert.ok(renderer.includes("function addProcessUpdate("), "commentary updates must use the compact process flow");
assert.ok(renderer.includes('if (item.phase === "commentary") addProcessUpdate'), "history commentary must not render as repeated agent cards");
assert.ok(renderer.includes("finishProcessFlow("), "completed turns must finalize their process duration");
assert.ok(renderer.includes('flow.toggle.setAttribute("aria-expanded", String(!collapse))'), "completed process flows must collapse automatically");
assert.ok(renderer.includes('if (kind !== "agent") card.append(heading)'), "assistant answers must not repeat an identity heading");
assert.ok(!renderer.includes('avatar.className = "agent-avatar"'), "assistant answers must not render a repeated app avatar");
assert.ok(styles.includes(".process-flow-toggle"), "the process summary must be styled as a compact collapsible row");
assert.ok(styles.includes(".process-update + .process-update"), "consecutive progress updates must have compact visual rhythm");

console.log("Task trace checks passed.");
