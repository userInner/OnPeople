const assert = require("node:assert/strict");
const { BrowserTargetRegistry } = require("../src/browser-target-registry.cjs");

const registry = new BrowserTargetRegistry();
const first = { isDestroyed: () => false };
const second = { isDestroyed: () => false };

registry.attach("draft-1", first, 10);
registry.bind("pending-thread", "draft-1");
assert.equal(registry.get("pending-thread").target, first);
assert.equal(registry.owns("draft-1", 10), true);
assert.equal(registry.owns("draft-1", 11), false);

registry.attach("thread-1", first, 10);
assert.equal(registry.get("pending-thread").routeId, "thread-1");
assert.equal(registry.get("draft-1"), null);

registry.attach("thread-2", second, 11);
assert.equal(registry.get("thread-1").target, first);
assert.equal(registry.get("thread-2").target, second);

registry.bind("agent-thread-2", "thread-2");
assert.equal(registry.get("agent-thread-2").target, second);
assert.equal(registry.detach("thread-2"), true);
assert.equal(registry.get("thread-2"), null);
assert.equal(registry.aliases.has("agent-thread-2"), false);
registry.attach("thread-2", second, 11);

registry.detachOwner(10);
assert.equal(registry.get("thread-1"), null);
assert.equal(registry.get("thread-2").target, second);

process.stdout.write("Browser target registry checks passed.\n");
