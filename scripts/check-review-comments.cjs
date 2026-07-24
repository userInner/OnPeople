const assert = require("node:assert/strict");
const { annotateDiffLines, formatReviewPrompt } = require("../src/review-comments.cjs");

const lines = annotateDiffLines(["@@ -10,3 +20,4 @@ sample", " same", "-old", "+new", "+extra"]);
assert.deepEqual([lines[1].oldLine, lines[1].newLine], [10, 20]);
assert.deepEqual([lines[2].oldLine, lines[2].newLine, lines[2].side], [11, null, "old"]);
assert.deepEqual([lines[3].oldLine, lines[3].newLine, lines[3].side], [null, 21, "new"]);
assert.equal(lines[4].newLine, 22);
const prompt = formatReviewPrompt([{ path: "src/app.js", line: 21, side: "new", code: "+new", body: "处理空值" }]);
assert.match(prompt, /src\/app\.js:21/);
assert.match(prompt, /处理空值/);
assert.throws(() => formatReviewPrompt([]), /没有可提交/);
console.log("review comments checks passed");
