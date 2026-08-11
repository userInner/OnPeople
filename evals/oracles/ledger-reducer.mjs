import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
const { summarizeLedger } = await import(
  pathToFileURL(resolve(workspace, "src/ledger.js"))
);
const { validateAmount } = await import(
  pathToFileURL(resolve(workspace, "src/validation.js"))
);
const events = [
  { id: "a", type: "credit", amount: 50 },
  { id: "b", type: "debit", amount: 30 },
  { id: "a", type: "credit", amount: 999 },
];
assert.deepEqual(summarizeLedger(100, events), {
  openingBalance: 100,
  balance: 120,
  appliedIds: ["a", "b"],
});
assert.deepEqual(events[0], { id: "a", type: "credit", amount: 50 });
assert.equal(validateAmount(1), true);
for (const amount of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, Number.NaN, "1"])
  assert.equal(validateAmount(amount), false);
for (const opening of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, "0"])
  assert.throws(() => summarizeLedger(opening, []), TypeError);
for (const event of [
  null,
  {},
  { id: "", type: "credit", amount: 1 },
  { id: "x", type: "other", amount: 1 },
  { id: "x", type: "credit", amount: 0 },
]) {
  assert.throws(() => summarizeLedger(0, [event]), TypeError);
}
assert.throws(
  () => summarizeLedger(0, [{ id: "x", type: "debit", amount: 1 }]),
  RangeError,
);
assert.throws(
  () =>
    summarizeLedger(0, [
      { id: "x", type: "credit", amount: 1 },
      { id: "x", type: "credit", amount: 0 },
    ]),
  TypeError,
);
