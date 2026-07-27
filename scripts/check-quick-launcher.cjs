const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectWorkspaceSuggestions, resolveWorkspaceFile, urlCandidates } = require("../src/quick-launcher.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-launcher-"));
try {
  fs.writeFileSync(path.join(root, "README.md"), "Preview at http://localhost:3000 and localhost:11434/v1.");
  fs.writeFileSync(path.join(root, "index.html"), "<title>Demo</title>");
  const result = collectWorkspaceSuggestions(root);
  assert.deepEqual(result.files.map((item) => item.label), ["README.md", "index.html"]);
  assert.deepEqual(result.urls.map((item) => item.label), ["localhost:3000", "localhost:11434/v1"]);
  assert.equal(
    fs.realpathSync(resolveWorkspaceFile(root, "README.md").candidate),
    fs.realpathSync(path.join(root, "README.md")),
  );
  assert.throws(() => resolveWorkspaceFile(root, "../outside.txt"), /当前工作(?:区|目录)/);
  assert.equal(urlCandidates("localhost:8080/test")[0].url, "http://localhost:8080/test");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Quick launcher checks passed.");
