"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AgentTaskBoardStore, agentBoardState } = require("../src/agent-task-board.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-agent-board-"));
const file = path.join(root, "agent-task-board.json");

try {
  const store = new AgentTaskBoardStore(file);
  assert.deepEqual(store.snapshot("parent").counts, {
    pending: 0,
    running: 0,
    blocked: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
  });

  const research = store.save("parent", {
    id: "research",
    title: "研究协议",
    description: "检查原生 Agent 协议和事件。",
  });
  const implementation = store.save("parent", {
    id: "implementation",
    title: "实现适配",
    description: "根据研究结果实现适配层。",
    dependencyIds: [research.id],
  });
  let board = store.snapshot("parent");
  assert.equal(board.tasks.find((task) => task.id === research.id).state, "pending");
  assert.equal(board.tasks.find((task) => task.id === implementation.id).state, "blocked");
  assert.equal(board.counts.pending, 1);
  assert.equal(board.counts.blocked, 1);
  assert.throws(() => store.assertDispatchable("parent", implementation.id), /依赖/);
  assert.throws(() => store.update("parent", research.id, { dependencyIds: [implementation.id] }), /循环/);

  store.markDispatching("parent", research.id);
  board = store.snapshot("parent");
  assert.equal(board.tasks.find((task) => task.id === research.id).state, "running");
  assert.equal(board.tasks.find((task) => task.id === implementation.id).state, "blocked");

  const recovered = store.reconcileNativeThreads("parent", [{
    id: "native-research",
    threadId: "native-research",
    name: "研究协议",
    prompt: "检查原生 Agent 协议和事件。",
    status: "running",
  }]);
  assert.equal(recovered.attached, 1);
  assert.equal(store.tasksFor("parent").find((task) => task.id === research.id).nativeThreadId, "native-research");

  board = store.snapshot("parent", [{
    id: "native-research",
    threadId: "native-research",
    name: "研究协议",
    status: "waitingOnUserInput",
  }]);
  assert.equal(board.tasks.find((task) => task.id === research.id).state, "waiting");
  assert.equal(board.tasks.find((task) => task.id === implementation.id).state, "blocked");

  board = store.snapshot("parent", [{
    id: "native-research",
    threadId: "native-research",
    name: "研究协议",
    status: "completed",
  }]);
  assert.equal(board.tasks.find((task) => task.id === research.id).state, "completed");
  assert.equal(board.tasks.find((task) => task.id === implementation.id).state, "pending");
  assert.equal(store.assertDispatchable("parent", implementation.id, [{
    id: "native-research",
    threadId: "native-research",
    name: "研究协议",
    status: "completed",
  }]).id, implementation.id);

  store.markDispatchFailed("parent", implementation.id, "runtime unavailable");
  board = store.snapshot("parent", [{
    id: "native-research",
    threadId: "native-research",
    name: "研究协议",
    status: "completed",
  }, {
    id: "native-extra",
    threadId: "native-extra",
    name: "临时审查",
    status: "running",
  }]);
  assert.equal(board.tasks.find((task) => task.id === implementation.id).state, "failed");
  assert.equal(board.tasks.find((task) => task.id === "native:native-extra").nativeOnly, true);
  assert.equal(board.counts.completed, 1);
  assert.equal(board.counts.failed, 1);
  assert.equal(board.counts.running, 1);

  const timeoutTask = store.save("parent", { id: "timeout", title: "派发超时" });
  store.markDispatching("parent", timeoutTask.id);
  store.update("parent", timeoutTask.id, { dispatchDeadlineAt: Date.now() - 1 });
  board = store.snapshot("parent");
  assert.equal(board.tasks.find((task) => task.id === timeoutTask.id).state, "failed");
  assert.match(board.tasks.find((task) => task.id === timeoutTask.id).dispatchError, /可以重试/);
  assert.equal(store.remove("parent", timeoutTask.id).removed, true);

  const queued = store.save("parent", {
    id: "queued",
    title: "待删除任务",
    dependencyIds: [],
  });
  store.update("parent", implementation.id, { dependencyIds: [queued.id] });
  assert.equal(store.remove("parent", queued.id).removed, true);
  assert.deepEqual(store.tasksFor("parent").find((task) => task.id === implementation.id).dependencyIds, []);
  assert.throws(() => store.remove("parent", research.id), /不能从看板删除/);

  const restored = new AgentTaskBoardStore(file);
  assert.equal(restored.tasksFor("parent").length, 2);
  assert.equal(agentBoardState("stopped"), "failed");
  assert.equal(agentBoardState("waitingOnApproval"), "waiting");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Agent task board checks passed.");
