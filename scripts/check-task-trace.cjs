const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { activityLabel, normalizeTraceItem, redactTraceText, truncateTraceText } = require("../src/task-trace.js");

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
assert.equal(tool.label, "MCP · browser");
assert.equal(tool.summary, "navigate");
assert.match(tool.detail, /\[REDACTED\]/);
assert.equal(activityLabel(command, "completed"), "已运行");
assert.equal(activityLabel(tool, "running"), "正在调用 browser");
const read = normalizeTraceItem({ type: "commandExecution", command: "/bin/zsh -lc 'sed -n 1,20p src/main.cjs'", status: "completed" });
assert.equal(read.kind, "read"); assert.equal(read.summary, "main.cjs"); assert.equal(activityLabel(read, "completed"), "已读取");
const search = normalizeTraceItem({ type: "commandExecution", command: "rg -n \"browser_fill\" src/browser-mcp.cjs", status: "completed" });
assert.equal(search.kind, "search"); assert.equal(search.summary, "browser_fill · browser-mcp.cjs");
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
assert.ok(styles.includes(".process-flow-toggle"), "the process summary must be styled as a compact collapsible row");
assert.ok(styles.includes(".process-update + .process-update"), "consecutive progress updates must have compact visual rhythm");

console.log("Task trace checks passed.");
