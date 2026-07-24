const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { listProjectDirectory, searchProjectFiles } = require("../src/project-files.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-files-"));
try {
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "README.md"), "hello");
  fs.writeFileSync(path.join(root, "src", "index.js"), "console.log('ok')");
  fs.writeFileSync(path.join(root, "node_modules", "hidden.js"), "hidden");
  const listed = listProjectDirectory(root);
  assert.deepEqual(listed.entries.map((item) => item.name), ["src", "README.md"]);
  assert.equal(listProjectDirectory(root, "src").parent, "");
  assert.deepEqual(searchProjectFiles(root, "index").entries.map((item) => item.path), [path.join("src", "index.js")]);
  assert.equal(searchProjectFiles(root, "hidden").entries.length, 0);
  assert.throws(() => listProjectDirectory(root, "../"), /工作区/);
} finally { fs.rmSync(root, { recursive: true, force: true }); }

console.log("project files checks passed");
