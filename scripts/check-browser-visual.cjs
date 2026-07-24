const assert = require("node:assert/strict");
const { annotationRecord, boundedPush, consoleRecord, logRecord, networkRecord } = require("../src/browser-visual.cjs");

const consoleEntry = consoleRecord({ type: "warning", args: [{ value: "Layout" }, { value: { width: 42 } }], timestamp: 10 });
assert.equal(consoleEntry.level, "warning");
assert.match(consoleEntry.text, /Layout.*42/);

const logEntry = logRecord({ level: "error", text: "  Failed\n hard  ", url: "https://example.com/a.js", lineNumber: 8 });
assert.equal(logEntry.text, "Failed hard");
assert.equal(logEntry.line, 8);

const request = networkRecord("Network.requestWillBeSent", { requestId: "r1", request: { method: "POST", url: "https://example.com/api" }, type: "Fetch", timestamp: 4 });
const response = networkRecord("Network.responseReceived", { requestId: "r1", response: { status: 201, mimeType: "application/json" }, type: "Fetch" }, request);
assert.equal(response.status, 201);
assert.equal(response.method, "POST");
assert.equal(networkRecord("Network.loadingFailed", { requestId: "r1", errorText: "blocked" }, response).error, "blocked");

const annotation = annotationRecord({ note: "  Fix spacing ", selector: "#hero", element: "section", text: "Hero", rect: { x: -4, y: 2, width: 80, height: 30 } }, { url: "https://example.com", title: "Example" });
assert.equal(annotation.note, "Fix spacing");
assert.equal(annotation.rect.x, 0);
assert.throws(() => annotationRecord({ note: " " }, {}), /required/);

const values = [];
boundedPush(values, 1, 2); boundedPush(values, 2, 2); boundedPush(values, 3, 2);
assert.deepEqual(values, [2, 3]);
process.stdout.write("Browser visual checks passed.\n");
