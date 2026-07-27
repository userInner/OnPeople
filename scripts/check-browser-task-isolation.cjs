const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "renderer.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const browserMcp = fs.readFileSync(path.join(root, "src", "browser-mcp.cjs"), "utf8");

assert.ok(main.includes("new BrowserTargetRegistry()"), "main process must keep a route-indexed browser target registry");
assert.ok(main.includes("new AsyncLocalStorage()"), "concurrent browser commands must carry independent async route context");
assert.ok(main.includes("INTERNAL_BROWSER_ROUTE_ID"), "each task MCP server must receive its browser route");
assert.ok(browserMcp.includes("x-internal-browser-route-id"), "browser MCP calls must send the task route");
assert.ok(renderer.includes("const browserTabs = new Map()"), "renderer must retain route-indexed browser pages");
assert.ok(renderer.includes("const browserTaskGroups = new Map()"), "renderer must group multiple browser tabs by task");
assert.ok(renderer.includes("async function promoteBrowserTab"), "a draft browser page must promote into the newly created task");
assert.ok(renderer.includes("state.routeId !== activeBrowserRouteId"), "background task navigation must not replace the visible address state");
assert.ok(preload.includes("attachBrowser: (webContentsId, routeId)"), "browser attachment must include its task route");
assert.ok(styles.includes(".browser-slot webview[hidden]"), "inactive task browser pages must remain hidden but alive");

assert.ok(main.includes("openWorkspacePreview"), "workspace artifacts must support embedded preview");
assert.ok(main.includes("watchWorkspacePreview"), "embedded workspace previews must refresh after edits");
assert.ok(main.includes("pdfPreviewHtml"), "PDF previews must use the polished embedded PDF viewer");
assert.ok(renderer.includes("await openWorkspacePreview(target)"), "artifact links must open in the current task browser");

process.stdout.write("Browser task isolation checks passed.\n");
