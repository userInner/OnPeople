import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
const { TTLCache } = await import(
  pathToFileURL(resolve(workspace, "src/cache.js"))
);
for (const capacity of [0, -1, 1.5, Infinity])
  assert.throws(() => new TTLCache(capacity, 1), RangeError);
for (const ttl of [-1, Infinity, Number.NaN])
  assert.throws(() => new TTLCache(1, ttl), RangeError);
assert.throws(() => new TTLCache(1, 1, 4), TypeError);

let time = 0;
const cache = new TTLCache(2, 100, () => time);
cache.set("a", 1);
cache.set("b", 2);
assert.equal(cache.get("a"), 1);
cache.set("c", 3);
assert.equal(cache.has("b"), false);
assert.equal(cache.has("a"), true);
assert.equal(cache.size, 2);
time = 50;
cache.set("a", 10);
time = 100;
assert.equal(cache.get("c"), undefined);
assert.equal(cache.get("a"), 10);
assert.equal(cache.delete("a"), true);
assert.equal(cache.delete("a"), false);
cache.set("z", 9);
cache.clear();
assert.equal(cache.size, 0);

const immediate = new TTLCache(1, 0, () => 5);
immediate.set("x", 1);
assert.equal(immediate.has("x"), false);
assert.equal(immediate.size, 0);

const hasDoesNotRefresh = new TTLCache(2, 100, () => 0);
hasDoesNotRefresh.set("a", 1);
hasDoesNotRefresh.set("b", 2);
assert.equal(hasDoesNotRefresh.has("a"), true);
hasDoesNotRefresh.set("c", 3);
assert.equal(hasDoesNotRefresh.has("a"), false);
assert.equal(hasDoesNotRefresh.has("b"), true);
