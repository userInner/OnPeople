const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ScheduledTaskStore, nextRunAt } = require("../src/scheduled-tasks.cjs");
const { parseScheduledRequest } = require("../src/scheduled-language.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-scheduler-"));
try {
  const from = new Date("2026-07-22T08:30:00+08:00");
  assert.equal(new Date(nextRunAt({ kind: "interval", intervalMinutes: 15 }, from)).getTime(), from.getTime() + 900_000);
  assert.ok(new Date(nextRunAt({ kind: "daily", time: "09:00" }, from)) > from);
  assert.ok(new Date(nextRunAt({ kind: "weekly", day: 1, time: "10:00" }, from)) > from);
  assert.equal(nextRunAt({ kind: "rrule", rule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", dtstart: from.toISOString() }, from), "2026-07-22T09:00:00.000Z");
  assert.deepEqual(parseScheduledRequest("每天 9 点检查项目").schedule, { kind: "daily", time: "09:00" });
  assert.deepEqual(parseScheduledRequest("每周三下午 2 点整理周报").schedule, { kind: "weekly", day: 3, time: "14:00" });
  assert.deepEqual(parseScheduledRequest("每隔 2 小时检查服务").schedule, { kind: "interval", intervalMinutes: 120 });
  assert.equal(parseScheduledRequest("帮我检查一下项目"), null);

  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace);
  const storePath = path.join(root, "scheduled.json");
  const store = new ScheduledTaskStore(storePath);
  const task = store.create({ name: "巡检", prompt: "检查项目", cwd: workspace, schedule: { kind: "interval", intervalMinutes: 10 }, destination: { mode: "thread", threadId: "thread-1" }, execution: { mode: "worktree", ref: "main" }, runtime: { model: "gpt-test", reasoningEffort: "high", permission: "read-only" } }, from);
  assert.equal(store.snapshot().tasks.length, 1);
  assert.equal(task.destination.threadId, "thread-1");
  assert.equal(task.execution.mode, "worktree");
  assert.deepEqual(task.runtime, { model: "gpt-test", reasoningEffort: "high", permission: "read-only" });
  const run = store.beginRun(store.state.tasks[0], from);
  store.finishRun(run.id, { status: "completed", summary: "完成" }, new Date(from.getTime() + 1000));
  assert.equal(store.snapshot().unread, 1);
  store.markRead(run.id); assert.equal(store.snapshot().unread, 0);
  store.update(task.id, { enabled: false }, from); assert.equal(store.state.tasks[0].nextRunAt, null);
  assert.equal(new ScheduledTaskStore(storePath).snapshot().runs[0].status, "completed");
  store.remove(task.id); assert.equal(store.snapshot().tasks.length, 0);
} finally { fs.rmSync(root, { recursive: true, force: true }); }

console.log("scheduled tasks checks passed");
