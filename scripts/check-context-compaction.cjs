const assert = require("node:assert/strict");
const {
  ContextCompactionTracker,
  PENDING_MANUAL_CONTEXT_COMPACTION_ID,
} = require("../src/context-compaction.cjs");

function notification(method, threadId, itemId = "compact-1") {
  return {
    method,
    params: {
      threadId,
      turnId: "turn-1",
      item: { id: itemId, type: "contextCompaction" },
    },
  };
}

const tracker = new ContextCompactionTracker();
assert.equal(tracker.beginManual("thread-1").id, PENDING_MANUAL_CONTEXT_COMPACTION_ID);

const manualStarted = tracker.observe(notification("item/started", "thread-1"));
assert.equal(manualStarted.message.params.item.source, "manual");
assert.equal(manualStarted.message.params.item.completed, false);

const manualCompleted = tracker.observe(notification("item/completed", "thread-1"));
assert.equal(manualCompleted.message.params.item.source, "manual");
assert.equal(manualCompleted.message.params.item.completed, true);

const automaticStarted = tracker.observe(notification("item/started", "thread-2", "compact-2"));
assert.equal(automaticStarted.message.params.item.source, "automatic");
assert.deepEqual(tracker.clearThread("thread-2"), {
  itemIds: ["compact-2"],
  hadPendingManual: false,
});

tracker.beginManual("thread-3");
assert.equal(tracker.failManual("thread-3"), PENDING_MANUAL_CONTEXT_COMPACTION_ID);
assert.deepEqual(tracker.clearThread("thread-3"), { itemIds: [], hadPendingManual: false });

tracker.beginManual("thread-4");
tracker.observe(notification("item/started", "thread-5", "compact-5"));
const cleared = tracker.clearAll();
assert.equal(cleared.get("thread-4").hadPendingManual, true);
assert.deepEqual(cleared.get("thread-5").itemIds, ["compact-5"]);

console.log("context compaction checks passed");
