import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
if (!workspace) throw new Error("workspace argument is required");
const { uniqueSlug } = await import(
  pathToFileURL(resolve(workspace, "src/slug.js"))
);

assert.equal(uniqueSlug(" Hello,   WORLD! ", []), "hello-world");
assert.equal(
  uniqueSlug("Hello world", new Set(["hello-world"])),
  "hello-world-2",
);
assert.equal(
  uniqueSlug("Hello world", ["hello-world", "hello-world-2", "hello-world-4"]),
  "hello-world-3",
);
assert.equal(uniqueSlug("---", []), "item");
assert.equal(uniqueSlug("Crème brûlée", []), "creme-brulee");
const used = ["stable"];
assert.equal(uniqueSlug("Stable", used), "stable-2");
assert.deepEqual(used, ["stable"]);
