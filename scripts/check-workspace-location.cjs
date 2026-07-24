const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveWorkspaceFile, shouldUseSystemPreview } = require("../src/workspace-location.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-workspace-location-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-workspace-outside-"));
try {
  fs.writeFileSync(path.join(root, "README.md"), "workspace");
  const generatedRoot = path.join(root, ".onpeople", "generated-images");
  fs.mkdirSync(generatedRoot, { recursive: true });
  fs.writeFileSync(path.join(generatedRoot, "generated.png"), "png");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside");

  assert.equal(resolveWorkspaceFile(root, "README.md"), fs.realpathSync(path.join(root, "README.md")));
  assert.equal(resolveWorkspaceFile(root, path.join(root, "README.md")), fs.realpathSync(path.join(root, "README.md")));
  assert.equal(resolveWorkspaceFile(root, "generated.png"), fs.realpathSync(path.join(generatedRoot, "generated.png")));
  assert.equal(resolveWorkspaceFile(root, ".onpeople/generated-images/generated.png"), fs.realpathSync(path.join(generatedRoot, "generated.png")));
  assert.throws(() => resolveWorkspaceFile(root, "../outside.txt"), /当前工作目录/);
  assert.throws(() => resolveWorkspaceFile(root, path.join(outside, "secret.txt")), /当前工作目录/);
  assert.throws(() => resolveWorkspaceFile(root, "missing.txt"), /找不到文件/);
  assert.equal(shouldUseSystemPreview("generated.PNG"), true);
  assert.equal(shouldUseSystemPreview("src/main.cjs"), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

console.log("workspace location checks passed");
