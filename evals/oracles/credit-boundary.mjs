import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
if (!workspace) throw new Error("workspace argument is required");
const { applyCredit } = await import(
  pathToFileURL(resolve(workspace, "src/credit.js"))
);

assert.deepEqual(applyCredit(10, 0), { previous: 10, amount: 0, balance: 10 });
assert.deepEqual(applyCredit(10, 7), { previous: 10, amount: 7, balance: 17 });
assert.throws(() => applyCredit(10, -1), RangeError);
for (const value of [1.5, "2", Number.NaN, undefined, null]) {
  assert.throws(() => applyCredit(10, value), TypeError);
}
