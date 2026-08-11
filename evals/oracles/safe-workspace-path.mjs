import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const workspace = process.argv[2];
const { resolveWorkspacePath } = await import(
  pathToFileURL(resolve(workspace, "src/safe-path.js"))
);
const root = resolve(workspace, "project");

assert.equal(
  resolveWorkspacePath(root, "src/../src/app.js"),
  join(root, "src/app.js"),
);
assert.equal(resolveWorkspacePath(`${root}/`, "a"), join(root, "a"));
for (const value of [
  "",
  ".",
  "..",
  "../project-evil/file",
  "../../etc/passwd",
  root,
  `${root}/file`,
]) {
  assert.throws(() => resolveWorkspacePath(root, value), RangeError);
}
for (const value of [null, undefined, 1, {}]) {
  assert.throws(() => resolveWorkspacePath(root, value), TypeError);
}
