const assert = require("node:assert/strict");
const { ThreadRecoveryCoordinator } = require("../src/thread-recovery.cjs");

const recovery = new ThreadRecoveryCoordinator();
const transitions = [];
recovery.on("transition", (state) => transitions.push(`${state.threadId}:${state.phase}`));

recovery.begin("thread-a");
recovery.begin("thread-b");
recovery.degraded("thread-a", "slow response");
recovery.ready("thread-b", "notification");
recovery.ready("thread-a", "response");

assert.deepEqual(transitions, [
  "thread-a:restoring",
  "thread-b:restoring",
  "thread-a:degraded",
  "thread-b:ready",
  "thread-a:ready",
]);
assert.equal(recovery.state("thread-a").attempt, 1);
assert.equal(recovery.state("thread-b").source, "notification");
assert.equal(recovery.isSettled("thread-a"), true);

recovery.begin("thread-a");
recovery.failed("thread-a", "not found");
assert.equal(recovery.state("thread-a").attempt, 2);
assert.equal(recovery.state("thread-a").phase, "failed");
console.log("thread recovery checks passed");
