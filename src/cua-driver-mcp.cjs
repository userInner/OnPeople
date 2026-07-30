const { spawn } = require("node:child_process");

const binary = String(process.env.ONPEOPLE_CUA_DRIVER_BINARY || "").trim();
if (!binary) {
  process.stderr.write("ONPEOPLE_CUA_DRIVER_BINARY is required\n");
  process.exitCode = 1;
} else {
  let args = ["mcp", "--embedded"];
  try {
    const configured = JSON.parse(process.env.ONPEOPLE_CUA_DRIVER_ARGS || "null");
    if (Array.isArray(configured) && configured.every((value) => typeof value === "string")) args = configured;
  } catch {}

  const child = spawn(binary, args, {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.once("error", (error) => {
    process.stderr.write(`Unable to start Cua Driver MCP: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = Number.isInteger(code) ? code : 1;
  });
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  process.once("SIGINT", () => child.kill("SIGINT"));
}
