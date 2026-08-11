import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
const { retryDelayMs } = await import(
  pathToFileURL(resolve(workspace, "src/retry-after.js"))
);
const now = Date.parse("2026-01-01T00:00:00Z");

assert.equal(retryDelayMs(2, now), 2000);
assert.equal(retryDelayMs(" 1.25 ", now), 1250);
assert.equal(retryDelayMs("0.0001", now), 1);
assert.equal(retryDelayMs("Thu, 01 Jan 2026 00:00:05 GMT", now), 5000);
assert.equal(retryDelayMs("Wed, 31 Dec 2025 23:59:59 GMT", now), 0);
for (const value of [
  "",
  "-1",
  -1,
  Number.NaN,
  Infinity,
  "soon",
  null,
  undefined,
  {},
]) {
  assert.equal(retryDelayMs(value, now), null);
}
