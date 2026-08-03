const assert = require("node:assert/strict");
const { markdownBody, renderMarkdownPreview, safeHref } = require("../src/markdown-preview.cjs");

const body = markdownBody(`# 标题

**重点**与[相对链接](notes/next.md)。

| 项目 | 结果 |
| --- | --- |
| 核验 | 通过 |

<script>alert("unsafe")</script>

[危险链接](javascript:alert(1))`);

assert.match(body, /<h1>标题<\/h1>/);
assert.match(body, /<strong>重点<\/strong>/);
assert.match(body, /<table>/);
assert.match(body, /href="notes\/next\.md"/);
assert.doesNotMatch(body, /<script>/);
assert.doesNotMatch(body, /javascript:/);
assert.equal(safeHref("https://example.com/paper"), "https://example.com/paper");
assert.equal(safeHref("javascript:alert(1)"), "");

const page = renderMarkdownPreview({ source: "# 成稿", name: "成稿.md", relativePath: "outputs/成稿.md", rawUrl: "/preview/id/output.md?raw=1" });
assert.match(page, /<title>成稿\.md<\/title>/);
assert.match(page, /查看原文/);
assert.match(page, /Content-Security-Policy/);
assert.match(page, /<h1>成稿<\/h1>/);

console.log("Markdown preview checks passed.");
