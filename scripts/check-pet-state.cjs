const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PET_ANIMATIONS, PET_FRAME, PetStateStore, animationForStatus, normalizePetStatus } = require("../src/pet-state.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-pet-"));
const store = new PetStateStore(path.join(root, "pet.json"));

assert.deepEqual(PET_FRAME, { width: 192, height: 208, columns: 8, rows: 9 });
assert.equal(PET_ANIMATIONS.running.row, 7);
assert.equal(normalizePetStatus("waiting-approval"), "needs-input");
assert.equal(normalizePetStatus("paused"), "blocked");
assert.equal(animationForStatus("ready"), "jumping");

store.updateTask({ threadId: "running", title: "运行任务", status: "working" });
store.updateTask({ threadId: "ready", title: "已完成", status: "completed" });
store.updateTask({ threadId: "blocked", title: "失败任务", status: "failed" });
store.updateTask({ threadId: "input", title: "需要确认", status: "waiting-input" });
assert.equal(store.snapshot().activeThreadId, "input");
assert.deepEqual(store.snapshot().tasks.map((item) => item.threadId), ["input", "blocked", "running", "ready"]);
store.tasks.get("ready").expiresAt = Date.now() - 1;
assert.equal(store.snapshot().tasks.some((item) => item.threadId === "ready"), false);

store.saveSettings({
  visible: true,
  position: { x: 12, y: 34 },
  skinId: "custom-example",
  customSkins: [{ id: "custom-example", name: "测试皮肤", path: "/tmp/example.png" }],
});
const restored = new PetStateStore(path.join(root, "pet.json"));
assert.equal(restored.snapshot().visible, true);
assert.deepEqual(restored.snapshot().position, { x: 12, y: 34 });
assert.equal(restored.snapshot().skinId, "custom-example");
assert.equal(restored.snapshot().customSkins[0].name, "测试皮肤");

console.log("Pet state checks passed.");
