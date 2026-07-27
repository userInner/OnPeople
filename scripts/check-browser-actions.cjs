const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "browser-mcp.cjs")], {
  env: {
    ...process.env,
    INTERNAL_BROWSER_BRIDGE_URL: "http://127.0.0.1:9",
    INTERNAL_BROWSER_BRIDGE_TOKEN: "test",
    INTERNAL_BROWSER_ROUTE_ID: "test-route",
  },
  stdio: ["pipe", "pipe", "inherit"],
});
let buffer = "";
let checked = false;
const timeout = setTimeout(() => {
  child.kill();
  console.error("browser action check timed out before receiving tools/list");
  process.exitCode = 1;
}, 5_000);
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const boundary = buffer.indexOf("\n");
  if (boundary < 0) return;
  const response = JSON.parse(buffer.slice(0, boundary));
  const names = new Set(response.result.tools.map((tool) => tool.name));
  for (const name of [
    "browser_click",
    "browser_fill",
    "browser_press_key",
    "browser_select",
    "browser_scroll",
    "browser_hover",
    "browser_wait",
    "browser_upload",
  ]) assert.equal(names.has(name), true, `${name} missing`);
  checked = true;
  clearTimeout(timeout);
  child.kill();
  console.log("browser action checks passed");
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  clearTimeout(timeout);
  if (!checked) {
    console.error(`browser MCP exited before assertions (code=${code}, signal=${signal || "none"})`);
    process.exitCode = 1;
  }
});
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
