const assert = require("node:assert/strict");
const { ThreadContextRegistry } = require("../src/thread-contexts.cjs");

const registry = new ThreadContextRegistry();
registry.bindWindow(10, "thread-a");
registry.bindWindow(11, "thread-b");
registry.update("thread-a", { model: "model-a", cwd: "/tmp/a" });
registry.update("thread-b", { model: "model-b", cwd: "/tmp/b" });
registry.startTurn("thread-a", "turn-a");
registry.startTurn("thread-b", "turn-b");

assert.equal(registry.contextForWindow(10).turnId, "turn-a");
assert.equal(registry.contextForWindow(11).turnId, "turn-b");
assert.equal(registry.contextForWindow(10).model, "model-a");
assert.equal(registry.contextForWindow(11).model, "model-b");

registry.completeTurn("thread-a", "different-turn");
assert.equal(registry.get("thread-a").turnId, "turn-a");
registry.completeTurn("thread-a", "turn-a", "completed");
assert.equal(registry.get("thread-a").turnId, null);
assert.equal(registry.get("thread-b").turnId, "turn-b");

registry.setProvider("thread-a", { type: "deepseek", model: "deepseek-chat" });
registry.setProvider("thread-b", { type: "openai", model: "gpt-5.6" });
assert.equal(registry.get("thread-a").provider.type, "deepseek");
assert.equal(registry.get("thread-b").provider.type, "openai");

registry.unbindWindow(10);
assert.equal(registry.threadIdForWindow(10), null);
assert.equal(registry.threadIdForWindow(11), "thread-b");

console.log("thread context checks passed");
