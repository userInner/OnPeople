const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "renderer.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

assert.ok(html.includes('id="browser-tab-strip"'), "browser panel must render a visible tab strip");
assert.ok(html.includes('id="browser-new-tab"'), "browser panel must expose an explicit new-tab control");
assert.ok(renderer.includes("MAX_BROWSER_TABS_PER_TASK = 8"), "each task must have a bounded tab collection");
assert.ok(renderer.includes("function ensureBrowserTaskGroup"), "task tab groups must be restored lazily");
assert.ok(renderer.includes("function createBrowserTab"), "the renderer must create independent browser guests");
assert.ok(renderer.includes("function closeBrowserTab"), "browser tabs must be closeable");
assert.ok(renderer.includes("function renderBrowserTabStrip"), "browser tab state must have a visible representation");
assert.ok(renderer.includes("BROWSER_TAB_STORAGE_KEY"), "tab URLs and active selection must persist across restarts");
assert.ok(renderer.includes("window.workbench.activateBrowserTab(currentThreadId, routeId)"), "task Agent routing must follow the active tab");
assert.ok(preload.includes('ipcRenderer.invoke("browser:tab:activate"'), "active-tab routing must cross the preload boundary");
assert.ok(preload.includes('ipcRenderer.invoke("browser:tab:detach"'), "closed tabs must detach from the route registry");
assert.ok(main.includes('ipcMain.handle("browser:tab:activate"'), "main process must rebind task and gateway aliases to the active tab");
assert.ok(main.includes('"browser:new-tab-requested"'), "target=_blank navigation must create an OnPeople tab");
assert.ok(styles.includes(".browser-tab-chip.active"), "active browser tabs must be visually distinct");

process.stdout.write("Browser multi-tab checks passed.\n");
