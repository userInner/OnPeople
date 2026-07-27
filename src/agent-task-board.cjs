const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteFile, readJsonWithBackup } = require("./atomic-file.cjs");

const BOARD_STATES = Object.freeze(["pending", "running", "blocked", "waiting", "completed", "failed"]);
const ACTIVE_AGENT_STATES = new Set(["starting", "running", "waitingOnApproval", "waitingOnUserInput"]);

function cleanText(value, maximum = 4_000) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, maximum);
}

function normalizeTask(input = {}) {
  return {
    id: cleanText(input.id, 100) || crypto.randomUUID(),
    parentThreadId: cleanText(input.parentThreadId, 180),
    title: cleanText(input.title || input.name, 120) || "未命名任务",
    description: cleanText(input.description || input.prompt, 12_000),
    role: cleanText(input.role, 80) || "worker",
    model: cleanText(input.model, 160),
    effort: cleanText(input.effort, 24) || "medium",
    profileId: cleanText(input.profileId, 100),
    instructions: cleanText(input.instructions, 8_000),
    dependencyIds: [...new Set((Array.isArray(input.dependencyIds) ? input.dependencyIds : [])
      .map((value) => cleanText(value, 100))
      .filter(Boolean))],
    nativeThreadId: cleanText(input.nativeThreadId, 180) || null,
    dispatchState: new Set(["pending", "dispatching", "failed"]).has(input.dispatchState)
      ? input.dispatchState
      : "pending",
    dispatchAttemptId: cleanText(input.dispatchAttemptId, 100) || null,
    dispatchDeadlineAt: Number.isFinite(Number(input.dispatchDeadlineAt)) ? Number(input.dispatchDeadlineAt) : null,
    dispatchError: cleanText(input.dispatchError, 1_000) || null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function agentBoardState(status) {
  if (new Set(["starting", "running"]).has(status)) return "running";
  if (new Set(["waitingOnApproval", "waitingOnUserInput"]).has(status)) return "waiting";
  if (new Set(["failed", "systemError", "interrupted", "cancelled", "stopped"]).has(status)) return "failed";
  return "completed";
}

function comparable(value) {
  return cleanText(value, 4_000).toLocaleLowerCase();
}

class AgentTaskBoardStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    try {
      const value = readJsonWithBackup(this.filePath, { tasks: [] });
      return {
        version: 1,
        tasks: (Array.isArray(value.tasks) ? value.tasks : []).map(normalizeTask),
      };
    } catch {
      return { version: 1, tasks: [] };
    }
  }

  write(state) {
    atomicWriteFile(this.filePath, `${JSON.stringify({ version: 1, tasks: state.tasks }, null, 2)}\n`, { mode: 0o600 });
  }

  tasksFor(parentThreadId) {
    const parentId = cleanText(parentThreadId, 180);
    return this.read().tasks.filter((task) => task.parentThreadId === parentId);
  }

  validateDependencies(task, tasks) {
    const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
    for (const dependencyId of task.dependencyIds) {
      if (dependencyId === task.id) throw new Error("任务不能依赖自己");
      if (!byId.has(dependencyId)) throw new Error("选择的依赖任务不存在");
    }
    const visits = new Set();
    const complete = new Set();
    const visit = (id) => {
      if (complete.has(id)) return;
      if (visits.has(id)) throw new Error("任务依赖不能形成循环");
      visits.add(id);
      for (const dependencyId of byId.get(id)?.dependencyIds || []) visit(dependencyId);
      visits.delete(id);
      complete.add(id);
    };
    visit(task.id);
  }

  save(parentThreadId, input = {}) {
    const parentId = cleanText(parentThreadId || input.parentThreadId, 180);
    if (!parentId) throw new Error("请先新建父任务，再创建共享任务");
    const state = this.read();
    const existing = state.tasks.find((task) => task.id === input.id && task.parentThreadId === parentId);
    const task = normalizeTask({
      ...existing,
      ...input,
      id: existing?.id || input.id,
      parentThreadId: parentId,
      nativeThreadId: existing?.nativeThreadId || null,
      dispatchState: existing?.dispatchState || "pending",
      createdAt: existing?.createdAt,
      updatedAt: new Date().toISOString(),
    });
    const siblings = [...state.tasks.filter((candidate) => candidate.parentThreadId === parentId && candidate.id !== task.id), task];
    this.validateDependencies(task, siblings);
    state.tasks = [...state.tasks.filter((candidate) => candidate.id !== task.id), task];
    this.write(state);
    return task;
  }

  update(parentThreadId, taskId, changes = {}) {
    const parentId = cleanText(parentThreadId, 180);
    const state = this.read();
    const index = state.tasks.findIndex((task) => task.id === taskId && task.parentThreadId === parentId);
    if (index < 0) throw new Error("找不到共享任务");
    const task = normalizeTask({
      ...state.tasks[index],
      ...changes,
      id: state.tasks[index].id,
      parentThreadId: parentId,
      updatedAt: new Date().toISOString(),
    });
    const siblings = state.tasks.filter((candidate) => candidate.parentThreadId === parentId && candidate.id !== task.id);
    this.validateDependencies(task, [...siblings, task]);
    state.tasks[index] = task;
    this.write(state);
    return task;
  }

  remove(parentThreadId, taskId) {
    const parentId = cleanText(parentThreadId, 180);
    const state = this.read();
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.parentThreadId === parentId);
    if (!task) return { removed: false };
    if (task.nativeThreadId || task.dispatchState === "dispatching") {
      throw new Error("已经派发的任务不能从看板删除");
    }
    state.tasks = state.tasks
      .filter((candidate) => candidate.id !== taskId)
      .map((candidate) => candidate.parentThreadId === parentId
        ? { ...candidate, dependencyIds: candidate.dependencyIds.filter((id) => id !== taskId) }
        : candidate);
    this.write(state);
    return { removed: true };
  }

  snapshot(parentThreadId, agents = []) {
    const parentId = cleanText(parentThreadId, 180);
    this.expireDispatches(parentId);
    const stored = this.tasksFor(parentId);
    const agentsByThread = new Map(agents.map((agent) => [agent.threadId || agent.id, agent]));
    const storedIdsByThread = new Map(stored.filter((task) => task.nativeThreadId).map((task) => [task.nativeThreadId, task.id]));
    const baseStates = new Map();
    for (const task of stored) {
      const agent = task.nativeThreadId ? agentsByThread.get(task.nativeThreadId) : null;
      if (agent) baseStates.set(task.id, agentBoardState(agent.status));
      else if (task.dispatchState === "dispatching") baseStates.set(task.id, "running");
      else if (task.dispatchState === "failed") baseStates.set(task.id, "failed");
      else baseStates.set(task.id, "pending");
    }
    const tasks = stored.map((task) => {
      const agent = task.nativeThreadId ? agentsByThread.get(task.nativeThreadId) : null;
      const unmetDependencyIds = task.dependencyIds.filter((id) => baseStates.get(id) !== "completed");
      const state = baseStates.get(task.id) === "pending" && unmetDependencyIds.length ? "blocked" : baseStates.get(task.id);
      return {
        ...task,
        state,
        agent: agent || null,
        unmetDependencyIds,
      };
    });
    for (const agent of agents) {
      const threadId = agent.threadId || agent.id;
      if (storedIdsByThread.has(threadId)) continue;
      tasks.push({
        id: `native:${threadId}`,
        parentThreadId: parentId,
        title: agent.name || "Subagent",
        description: agent.prompt || "",
        role: agent.role || "worker",
        model: agent.model || "",
        effort: agent.effort || "inherit",
        dependencyIds: [],
        nativeThreadId: threadId,
        dispatchState: "dispatched",
        dispatchError: null,
        createdAt: agent.startedAt ? new Date(agent.startedAt).toISOString() : new Date().toISOString(),
        updatedAt: agent.completedAt ? new Date(agent.completedAt).toISOString() : new Date().toISOString(),
        state: agentBoardState(agent.status),
        agent,
        unmetDependencyIds: [],
        nativeOnly: true,
      });
    }
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const enriched = tasks
      .map((task) => ({
        ...task,
        dependencies: task.dependencyIds.map((id) => byId.get(id)).filter(Boolean).map((dependency) => ({
          id: dependency.id,
          title: dependency.title,
          state: dependency.state,
        })),
      }))
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    const counts = Object.fromEntries(BOARD_STATES.map((state) => [state, enriched.filter((task) => task.state === state).length]));
    return { tasks: enriched, counts, states: BOARD_STATES };
  }

  assertDispatchable(parentThreadId, taskId, agents = []) {
    const snapshot = this.snapshot(parentThreadId, agents);
    const task = snapshot.tasks.find((candidate) => candidate.id === taskId && !candidate.nativeOnly);
    if (!task) throw new Error("找不到共享任务");
    if (task.state === "blocked") throw new Error("上游依赖尚未完成，当前任务不能开始");
    if (task.nativeThreadId || task.dispatchState === "dispatching") throw new Error("该任务已经派发");
    return task;
  }

  markDispatching(parentThreadId, taskId) {
    return this.update(parentThreadId, taskId, {
      dispatchState: "dispatching",
      dispatchAttemptId: crypto.randomUUID(),
      dispatchDeadlineAt: Date.now() + 120_000,
      dispatchError: null,
    });
  }

  markDispatchFailed(parentThreadId, taskId, error) {
    return this.update(parentThreadId, taskId, {
      dispatchState: "failed",
      dispatchAttemptId: null,
      dispatchDeadlineAt: null,
      dispatchError: cleanText(error, 1_000),
    });
  }

  attachNativeThread(parentThreadId, taskId, nativeThreadId) {
    return this.update(parentThreadId, taskId, {
      nativeThreadId: cleanText(nativeThreadId, 180),
      dispatchState: "dispatching",
      dispatchAttemptId: null,
      dispatchDeadlineAt: null,
      dispatchError: null,
    });
  }

  expireDispatches(parentThreadId, now = Date.now()) {
    const parentId = cleanText(parentThreadId, 180);
    const state = this.read();
    let expired = 0;
    state.tasks = state.tasks.map((task) => {
      if (task.parentThreadId !== parentId
        || task.dispatchState !== "dispatching"
        || task.nativeThreadId
        || !task.dispatchDeadlineAt
        || task.dispatchDeadlineAt > now) return task;
      expired += 1;
      return normalizeTask({
        ...task,
        dispatchState: "failed",
        dispatchAttemptId: null,
        dispatchDeadlineAt: null,
        dispatchError: "Codex Core 未在限定时间内创建子 Agent，可以重试派发。",
        updatedAt: new Date().toISOString(),
      });
    });
    if (expired) this.write(state);
    return { expired };
  }

  reconcileNativeThreads(parentThreadId, agents = []) {
    const parentId = cleanText(parentThreadId, 180);
    if (!parentId || !Array.isArray(agents) || !agents.length) return { attached: 0 };
    const state = this.read();
    const tasks = state.tasks.filter((task) => task.parentThreadId === parentId);
    const usedThreadIds = new Set(tasks.map((task) => task.nativeThreadId).filter(Boolean));
    let attached = 0;
    for (const task of tasks.filter((candidate) => candidate.dispatchState === "dispatching" && !candidate.nativeThreadId)) {
      const available = agents.filter((agent) => {
        const threadId = cleanText(agent.threadId || agent.id, 180);
        return threadId && !usedThreadIds.has(threadId);
      });
      const taskTitle = comparable(task.title);
      const taskDescription = comparable(task.description).slice(0, 240);
      const titleMatches = available.filter((agent) => comparable(agent.name) === taskTitle);
      const descriptionMatches = taskDescription.length >= 24
        ? available.filter((agent) => comparable(agent.prompt).includes(taskDescription))
        : [];
      const matches = titleMatches.length === 1
        ? titleMatches
        : (descriptionMatches.length === 1 ? descriptionMatches : []);
      if (matches.length !== 1) continue;
      const threadId = cleanText(matches[0].threadId || matches[0].id, 180);
      const index = state.tasks.findIndex((candidate) => candidate.id === task.id);
      state.tasks[index] = normalizeTask({
        ...task,
        nativeThreadId: threadId,
        dispatchState: "dispatching",
        dispatchError: null,
        updatedAt: new Date().toISOString(),
      });
      usedThreadIds.add(threadId);
      attached += 1;
    }
    if (attached) this.write(state);
    return { attached };
  }
}

module.exports = {
  ACTIVE_AGENT_STATES,
  AgentTaskBoardStore,
  BOARD_STATES,
  agentBoardState,
};
