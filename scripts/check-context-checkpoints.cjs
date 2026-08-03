const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CHECKPOINT_MARKER,
  ContextCheckpointStore,
  detectConflicts,
  formatContextCheckpointItem,
} = require("../src/context-checkpoints.cjs");

function record(type, payload, timestamp = "2026-08-01T00:00:00.000Z") {
  return `${JSON.stringify({ timestamp, type, payload })}\n`;
}

function message(id, role, text, phase = null) {
  return record("response_item", {
    type: "message",
    id,
    role,
    phase,
    content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
  });
}

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-context-checkpoints-"));
  try {
    const rolloutPath = path.join(temporary, "rollout-thread-1.jsonl");
    fs.writeFileSync(rolloutPath, [
      record("event_msg", { type: "thread_goal_updated", goal: { objective: "完成上下文校准", status: "active" } }),
      message("user-1", "user", "必须保留 Codex 原生压缩，并使用 sk-example-secret-value 测试脱敏。"),
      message("assistant-1", "assistant", "建议每三次从原始 rollout 重建。", "final_answer"),
      message("user-2", "user", "可以，就按这个方案开始。"),
      record("response_item", {
        type: "function_call",
        id: "plan-1",
        call_id: "plan-call-1",
        name: "update_plan",
        arguments: JSON.stringify({ plan: [{ step: "实现检查点", status: "in_progress" }] }),
      }),
      record("response_item", {
        type: "function_call",
        id: "patch-1",
        call_id: "patch-call-1",
        name: "apply_patch",
        arguments: JSON.stringify({ patch: "*** Begin Patch\n*** Update File: src/main.cjs\n*** End Patch" }),
      }),
      record("response_item", {
        type: "function_call_output",
        id: "test-1",
        call_id: "test-call-1",
        output: "context checkpoint checks passed; exit_code: 0",
      }),
    ].join(""), "utf8");

    const store = new ContextCheckpointStore(path.join(temporary, "checkpoints"), { rebuildEvery: 3 });
    const first = await store.rebuild({
      threadId: "thread-1",
      rolloutPath,
      goal: { objective: "完成上下文校准", status: "active" },
      model: "gpt-test",
      cwd: temporary,
      reason: "automatic-compaction",
      compaction: true,
    });
    assert.equal(first.checkpoint.revision, 1);
    assert.equal(first.checkpoint.rebuildMode, "full");
    assert.equal(first.shouldInject, true);
    assert.equal(first.checkpoint.constraints.length, 1);
    assert.doesNotMatch(first.checkpoint.constraints[0].text, /sk-example-secret-value/);
    assert.match(first.checkpoint.constraints[0].text, /\[REDACTED\]/);
    assert.equal(first.checkpoint.confirmedDecisions[0].context, "建议每三次从原始 rollout 重建。");
    assert.equal(first.checkpoint.currentPlan.steps[0].step, "实现检查点");
    assert.equal(first.checkpoint.modifiedFiles[0].text, "src/main.cjs");
    assert.match(first.checkpoint.testResults[0].text, /checks passed/);

    fs.appendFileSync(rolloutPath, message("user-3", "user", "第二次压缩只做增量更新。"));
    const second = await store.rebuild({
      threadId: "thread-1",
      rolloutPath,
      goal: { objective: "完成上下文校准", status: "active" },
      model: "gpt-test",
      cwd: temporary,
      reason: "automatic-compaction",
      compaction: true,
    });
    assert.equal(second.checkpoint.rebuildMode, "incremental");
    assert.equal(second.shouldInject, false);
    assert.equal(second.checkpoint.recentMessages.at(-1).sourceId, "user-3");

    fs.appendFileSync(rolloutPath, message("user-4", "user", "第三次压缩从原始记录重建。"));
    const third = await store.rebuild({
      threadId: "thread-1",
      rolloutPath,
      goal: { objective: "完成上下文校准", status: "active" },
      model: "gpt-test",
      cwd: temporary,
      reason: "automatic-compaction",
      compaction: true,
    });
    assert.equal(third.checkpoint.rebuildMode, "full");
    assert.equal(third.trigger, "periodic");
    assert.equal(third.shouldInject, true);
    assert.equal(store.summary("thread-1").compactionCount, 3);

    const manual = await store.rebuild({
      threadId: "thread-1",
      rolloutPath,
      goal: { objective: "完成上下文校准", status: "active" },
      model: "gpt-test",
      cwd: temporary,
      reason: "manual-recalibration",
      forceFull: true,
    });
    assert.equal(manual.checkpoint.rebuildMode, "full");
    assert.equal(manual.checkpoint.compactionCount, 3);
    assert.equal(manual.shouldInject, true);
    const injected = formatContextCheckpointItem(manual.checkpoint);
    assert.equal(injected.role, "developer");
    assert.match(injected.content[0].text, new RegExp(CHECKPOINT_MARKER));
    assert.match(injected.content[0].text, /highest checkpoint revision/);
    assert.doesNotMatch(injected.content[0].text, /sk-example-secret-value/);

    const conflicts = detectConflicts(
      [{ sourceId: "a", text: "必须保留 DeviceCheck" }],
      [{ sourceId: "b", text: "不要保留 DeviceCheck" }],
    );
    assert.equal(conflicts.length, 1);

    store.markInjection("thread-1", manual.checkpoint.revision, { injected: true });
    assert.equal(store.summary("thread-1").injected, true);
    const clearedGoal = await store.rebuild({
      threadId: "thread-1",
      rolloutPath,
      goal: null,
      model: "gpt-test",
      cwd: temporary,
      reason: "goal-change",
      forceFull: true,
    });
    assert.equal(clearedGoal.checkpoint.goal, null);
    assert.equal(clearedGoal.trigger, "goal-change");
    console.log("context checkpoint checks passed");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
