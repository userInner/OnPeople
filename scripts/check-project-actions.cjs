const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discoverProjectActions } = require("../src/project-actions.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-actions-"));
try {
  fs.mkdirSync(path.join(root, ".onpeople"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite", test: "node --test", hidden: "secret" } }));
  fs.writeFileSync(path.join(root, ".onpeople", "actions.json"), JSON.stringify({ setup: { darwin: "npm install" }, actions: [{ id: "dev", label: "启动网页", command: "npm run dev -- --host" }, { id: "smoke", label: "冒烟", command: "npm test" }] }));
  const result = discoverProjectActions(root, "darwin");
  assert.equal(result.setup.command, "npm install");
  assert.deepEqual(result.actions.map((item) => item.id), ["dev", "smoke", "test"]);
  assert.equal(result.actions[0].source, ".onpeople/actions.json");
  assert.equal(result.actions[0].fingerprint.length, 12);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("Project action checks passed.");
