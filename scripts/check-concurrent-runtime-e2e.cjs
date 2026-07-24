const assert = require("node:assert/strict");
const { ThreadContextRegistry } = require("../src/thread-contexts.cjs");
const { ThreadRecoveryCoordinator } = require("../src/thread-recovery.cjs");

async function main() {
  const contexts = new ThreadContextRegistry();
  const recovery = new ThreadRecoveryCoordinator();
  contexts.bindWindow(101, "thread-a");
  contexts.bindWindow(202, "thread-b");
  contexts.ensure("thread-a", { model: "model-a", provider: { type: "openai" } });
  contexts.ensure("thread-b", { model: "model-b", provider: { type: "deepseek" } });

  const restore = (threadId, turnId, delay) => {
    recovery.begin(threadId);
    return new Promise((resolve) => setTimeout(() => {
      contexts.startTurn(threadId, turnId);
      recovery.ready(threadId, "notification");
      resolve(contexts.snapshot(threadId));
    }, delay));
  };
  const [a, b] = await Promise.all([
    restore("thread-a", "turn-a", 20),
    restore("thread-b", "turn-b", 5),
  ]);

  assert.equal(a.turnId, "turn-a");
  assert.equal(b.turnId, "turn-b");
  assert.equal(contexts.contextForWindow(101).model, "model-a");
  assert.equal(contexts.contextForWindow(202).model, "model-b");
  assert.equal(recovery.state("thread-a").phase, "ready");
  assert.equal(recovery.state("thread-b").phase, "ready");

  contexts.completeTurn("thread-a", "turn-a");
  assert.equal(contexts.contextForWindow(101).turnId, null);
  assert.equal(contexts.contextForWindow(202).turnId, "turn-b");
  console.log("concurrent runtime e2e checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
