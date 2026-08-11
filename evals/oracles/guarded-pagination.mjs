import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
const { collectPages } = await import(
  pathToFileURL(resolve(workspace, "src/pagination.js"))
);

const seen = [];
const pages = new Map([
  [null, { items: [1, 2], nextCursor: "a" }],
  ["a", { items: [3], nextCursor: "b" }],
  ["b", { items: [], nextCursor: null }],
]);
const signal = {
  aborted: false,
  throwIfAborted() {
    if (this.aborted) throw new Error("aborted");
  },
};
const values = await collectPages(
  async ({ cursor, signal: passed }) => {
    seen.push(cursor);
    assert.strictEqual(passed, signal);
    return pages.get(cursor);
  },
  { signal },
);
assert.deepEqual(values, [1, 2, 3]);
assert.deepEqual(seen, [null, "a", "b"]);

let cycleCalls = 0;
await assert.rejects(
  () =>
    collectPages(async ({ cursor }) => {
      cycleCalls += 1;
      return { items: [], nextCursor: cursor === null ? "x" : "x" };
    }),
  /cursor|cycle|repeat/i,
);
assert.equal(cycleCalls, 2);

let limitedCalls = 0;
await assert.rejects(
  () =>
    collectPages(
      async () => {
        limitedCalls += 1;
        return { items: [], nextCursor: String(limitedCalls) };
      },
      { maxPages: 1 },
    ),
  RangeError,
);
assert.equal(limitedCalls, 1);
for (const maxPages of [0, -1, 1.5])
  await assert.rejects(
    () => collectPages(async () => ({ items: [] }), { maxPages }),
    RangeError,
  );
await assert.rejects(
  () => collectPages(async () => ({ items: "bad" })),
  TypeError,
);

let abortedCalls = 0;
const aborted = { aborted: true, reason: new Error("stop") };
await assert.rejects(
  () =>
    collectPages(
      async () => {
        abortedCalls += 1;
      },
      { signal: aborted },
    ),
  /stop/,
);
assert.equal(abortedCalls, 0);
