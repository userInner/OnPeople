const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { rrulestr } = require("rrule");
const { atomicWriteFile, readJsonWithBackup } = require("./atomic-file.cjs");

function parseRRule(schedule, from) {
  const rule = String(schedule.rule || "").trim().replace(/^RRULE:/i, "");
  if (!rule || rule.length > 2_000) throw new Error("RRULE 不能为空且不能超过 2000 个字符");
  const dtstart = schedule.dtstart ? new Date(schedule.dtstart) : new Date(from);
  if (!Number.isFinite(dtstart.getTime())) throw new Error("RRULE DTSTART 无效");
  try {
    const stamp = dtstart.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return rrulestr(`DTSTART:${stamp}\nRRULE:${rule}`, { forceset: true });
  } catch (error) {
    throw new Error(`RRULE 无效：${error.message}`);
  }
}

function nextRunAt(schedule, from = new Date()) {
  const base = new Date(from);
  if (!Number.isFinite(base.getTime())) throw new Error("无效的计划起点");
  if (schedule.kind === "rrule") {
    const next = parseRRule(schedule, base).after(base, false);
    return next ? next.toISOString() : null;
  }
  if (schedule.kind === "interval") {
    const minutes = Math.max(1, Math.min(43_200, Number(schedule.intervalMinutes) || 60));
    return new Date(base.getTime() + minutes * 60_000).toISOString();
  }
  const [hour, minute] = String(schedule.time || "09:00").split(":").map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("时间必须使用 HH:mm 格式");
  }
  const candidate = new Date(base);
  candidate.setSeconds(0, 0);
  candidate.setHours(hour, minute, 0, 0);
  if (schedule.kind === "daily") {
    if (candidate <= base) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }
  if (schedule.kind === "weekly") {
    const day = Math.max(0, Math.min(6, Number(schedule.day) || 0));
    let delta = (day - candidate.getDay() + 7) % 7;
    if (delta === 0 && candidate <= base) delta = 7;
    candidate.setDate(candidate.getDate() + delta);
    return candidate.toISOString();
  }
  throw new Error("不支持的计划类型");
}

function normalizeSchedule(value = {}, now = new Date()) {
  const kind = ["interval", "daily", "weekly", "rrule"].includes(value.kind) ? value.kind : "daily";
  if (kind === "rrule") {
    const rule = String(value.rule || "").trim().replace(/^RRULE:/i, "");
    const dtstart = value.dtstart && Number.isFinite(new Date(value.dtstart).getTime()) ? new Date(value.dtstart).toISOString() : new Date(now).toISOString();
    const schedule = { kind, rule, dtstart };
    parseRRule(schedule, now);
    return schedule;
  }
  if (kind === "interval") return { kind, intervalMinutes: Math.max(1, Math.min(43_200, Number(value.intervalMinutes) || 60)) };
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.time || "")) ? String(value.time) : "09:00";
  return kind === "weekly" ? { kind, day: Math.max(0, Math.min(6, Number(value.day) || 0)), time } : { kind, time };
}

function normalizeDestination(value = {}) {
  const mode = value.mode === "thread" ? "thread" : "standalone";
  const threadId = mode === "thread" ? String(value.threadId || "").trim() : null;
  if (mode === "thread" && !threadId) throw new Error("续跑模式需要指定会话");
  return { mode, threadId };
}

function normalizeExecution(value = {}) {
  return { mode: value.mode === "worktree" ? "worktree" : "local", ref: String(value.ref || "HEAD").trim().slice(0, 200) || "HEAD" };
}

function normalizeRuntime(value = {}) {
  const effort = ["medium", "high", "xhigh", "ultra"].includes(value.reasoningEffort) ? value.reasoningEffort : null;
  const permission = ["read-only", "workspace-write", "danger-full-access"].includes(value.permission) ? value.permission : "inherit";
  return {
    model: String(value.model || "").trim().slice(0, 200) || null,
    reasoningEffort: effort,
    permission,
  };
}

class ScheduledTaskStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this.read();
    let recovered = false;
    for (const run of this.state.runs) {
      if (run.status !== "running") continue;
      run.status = "failed"; run.error = "OnPeople 在任务完成前退出"; run.completedAt = new Date().toISOString(); run.read = false; recovered = true;
    }
    if (recovered) this.save();
  }

  read() {
    try {
      const value = readJsonWithBackup(this.filePath, { tasks: [], runs: [] });
      const tasks = Array.isArray(value.tasks) ? value.tasks.map((task) => ({
        ...task,
        destination: task.destination || { mode: "standalone", threadId: null },
        execution: task.execution || { mode: "local", ref: "HEAD" },
        runtime: normalizeRuntime(task.runtime),
        worktreePath: task.worktreePath || null,
      })) : [];
      return { tasks, runs: Array.isArray(value.runs) ? value.runs : [] };
    } catch { return { tasks: [], runs: [] }; }
  }

  save() {
    atomicWriteFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
  }

  snapshot() {
    return { tasks: this.state.tasks.map((task) => ({ ...task })), runs: this.state.runs.slice(0, 200).map((run) => ({ ...run })), unread: this.state.runs.filter((run) => !run.read).length };
  }

  create(input, now = new Date()) {
    const name = String(input.name || "").trim();
    const prompt = String(input.prompt || "").trim();
    const cwd = path.resolve(String(input.cwd || ""));
    if (!name || !prompt) throw new Error("名称和任务说明不能为空");
    if (name.length > 100 || prompt.length > 20_000) throw new Error("计划任务内容过长");
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("计划任务工作目录不存在");
    const schedule = normalizeSchedule(input.schedule, now);
    const destination = normalizeDestination(input.destination);
    const execution = normalizeExecution(input.execution);
    const runtime = normalizeRuntime(input.runtime);
    const timestamp = now.toISOString();
    const task = { id: crypto.randomUUID(), name, prompt, cwd, schedule, destination, execution, runtime, worktreePath: null, enabled: true, createdAt: timestamp, updatedAt: timestamp, nextRunAt: nextRunAt(schedule, now), lastRunAt: null };
    this.state.tasks.unshift(task); this.save(); return { ...task };
  }

  update(id, patch = {}, now = new Date()) {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task) throw new Error("计划任务不存在");
    if (Object.hasOwn(patch, "enabled")) task.enabled = Boolean(patch.enabled);
    if (patch.name) task.name = String(patch.name).trim().slice(0, 100);
    if (patch.prompt) task.prompt = String(patch.prompt).trim().slice(0, 20_000);
    if (patch.schedule) task.schedule = normalizeSchedule(patch.schedule, now);
    if (patch.destination) task.destination = normalizeDestination(patch.destination);
    if (patch.execution) task.execution = normalizeExecution(patch.execution);
    if (patch.runtime) task.runtime = normalizeRuntime(patch.runtime);
    if (Object.hasOwn(patch, "worktreePath")) task.worktreePath = patch.worktreePath ? path.resolve(String(patch.worktreePath)) : null;
    task.updatedAt = now.toISOString();
    task.nextRunAt = task.enabled ? nextRunAt(task.schedule, now) : null;
    this.save(); return { ...task };
  }

  remove(id) {
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter((task) => task.id !== id);
    if (before === this.state.tasks.length) throw new Error("计划任务不存在");
    this.save(); return { deleted: true };
  }

  due(now = new Date()) { return this.state.tasks.filter((task) => task.enabled && task.nextRunAt && new Date(task.nextRunAt) <= now); }

  beginRun(task, now = new Date()) {
    task.lastRunAt = now.toISOString(); task.nextRunAt = nextRunAt(task.schedule, now); task.updatedAt = now.toISOString();
    const run = { id: crypto.randomUUID(), taskId: task.id, taskName: task.name, status: "running", startedAt: now.toISOString(), completedAt: null, threadId: null, turnId: null, cwd: task.worktreePath || task.cwd, execution: task.execution, destination: task.destination, runtime: task.runtime, summary: "", error: null, read: true };
    this.state.runs.unshift(run); this.state.runs = this.state.runs.slice(0, 200); this.save(); return run;
  }

  finishRun(runId, result = {}, now = new Date()) {
    const run = this.state.runs.find((item) => item.id === runId);
    if (!run) return null;
    Object.assign(run, result, { completedAt: now.toISOString(), read: false }); this.save(); return { ...run };
  }

  markRead(runId = null) {
    for (const run of this.state.runs) if (!runId || run.id === runId) run.read = true;
    this.save(); return this.snapshot();
  }
}

module.exports = { ScheduledTaskStore, nextRunAt, normalizeDestination, normalizeExecution, normalizeRuntime, normalizeSchedule };
