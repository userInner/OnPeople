import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
const { createRequestDeduper } = await import(
  pathToFileURL(resolve(workspace, "src/dedupe.js"))
);

let calls = 0;
let release;
const gate = new Promise((resolveGate) => {
  release = resolveGate;
});
const request = createRequestDeduper(async (key) => {
  const ordinal = ++calls;
  await gate;
  return `${key}:${ordinal}`;
});
const first = request("a");
const same = request("a");
const other = request("b");
assert.strictEqual(first, same);
assert.notStrictEqual(first, other);
release();
assert.equal(await first, "a:1");
assert.equal(await other, "b:2");
assert.equal(calls, 2);
assert.notStrictEqual(request("a"), first);

let attempts = 0;
const flaky = createRequestDeduper(() => {
  attempts += 1;
  if (attempts === 1) throw new Error("boom");
  return Promise.resolve("ok");
});
const rejected = flaky("x");
assert.equal(typeof rejected?.then, "function");
await assert.rejects(rejected, /boom/);
assert.equal(await flaky("x"), "ok");
assert.equal(attempts, 2);
