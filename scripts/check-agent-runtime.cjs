const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AgentRuntimeCoordinator, publicTurnEvent } = require("../src/agent-runtime.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-runtime-"));
const stateFile = path.join(directory, "sessions.json");
const runtime = new AgentRuntimeCoordinator({ stateFile });

const started = runtime.observe({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
assert.equal(started.type, "turn-event");
assert.equal(started.threadId, "thread-1");
assert.equal(started.turnId, "turn-1");

runtime.observe({ method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "item-1", type: "mcpToolCall" } } });
assert.equal(runtime.snapshot().inFlight.length, 1);
runtime.observe({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "item-1", type: "mcpToolCall", status: "completed" } } });
assert.equal(runtime.snapshot().inFlight.length, 0);
runtime.observe({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });

const session = runtime.snapshot("thread-1");
assert.equal(session.status, "completed");
assert.equal(session.activeTurnId, null);
assert.equal(session.turns[0].items[0].type, "mcpToolCall");
runtime.close();
assert.equal(fs.existsSync(stateFile), true);

const restored = new AgentRuntimeCoordinator({ stateFile });
assert.equal(restored.snapshot("thread-1").turns.length, 1);
assert.equal(publicTurnEvent({ method: "warning", params: {} }).name, "warning");
restored.close();
fs.rmSync(directory, { recursive: true, force: true });
console.log("agent runtime checks passed");
