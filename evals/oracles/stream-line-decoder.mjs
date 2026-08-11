import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
const { LineDecoder } = await import(
  pathToFileURL(resolve(workspace, "src/line-decoder.js"))
);

const decoder = new LineDecoder();
assert.deepEqual(decoder.push("one\r"), []);
assert.deepEqual(decoder.push("\ntwo\n\nthree"), ["one", "two", ""]);
assert.deepEqual(decoder.end(), ["three"]);
assert.throws(() => decoder.push("x"));
assert.throws(() => decoder.end());

const utf8 = Buffer.from("你🙂好\n尾");
const binary = new LineDecoder();
const output = [];
for (const byte of utf8) output.push(...binary.push(Uint8Array.of(byte)));
output.push(...binary.end());
assert.deepEqual(output, ["你🙂好", "尾"]);

const trailing = new LineDecoder();
assert.deepEqual(trailing.push(Buffer.from("a\n")), ["a"]);
assert.deepEqual(trailing.end(), []);
const empty = new LineDecoder();
assert.deepEqual(empty.push("\n"), [""]);
assert.deepEqual(empty.end(), []);
assert.throws(() => new LineDecoder().push(123), TypeError);
