const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  codexCandidates,
  computerUseMcpArgs,
  editorCandidates,
  embeddedBinaryPath,
  executableName,
  findCodexBinary,
  findCuaDriverApp,
  findCuaDriverBinary,
  resolveTerminalShell,
  workbenchWindowOptions,
} = require("../src/platform-runtime.cjs");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-platform-"));
const runtimeRoot = path.join(temporaryRoot, ".embedded-runtime");
const binRoot = path.join(runtimeRoot, "bin");
fs.mkdirSync(binRoot, { recursive: true });

assert.equal(executableName("codex", "darwin"), "codex");
assert.equal(executableName("codex", "win32"), "codex.exe");
assert.equal(embeddedBinaryPath(runtimeRoot, "codex", "win32"), path.join(binRoot, "codex.exe"));
assert.equal(embeddedBinaryPath(runtimeRoot, "cua-driver", "darwin"), path.join(binRoot, "cua-driver"));

const windowsCodex = path.join(binRoot, "codex.exe");
const windowsCua = path.join(binRoot, "cua-driver.exe");
for (const executable of [windowsCodex, windowsCua]) {
  fs.writeFileSync(executable, "test");
  fs.chmodSync(executable, 0o755);
}
assert.equal(findCodexBinary({ runtimeRoot, platform: "win32", env: {}, homeDir: temporaryRoot }), windowsCodex);
assert.equal(findCuaDriverBinary({ runtimeRoot, platform: "win32", env: {}, homeDir: temporaryRoot }), windowsCua);
assert.equal(findCuaDriverApp({ runtimeRoot, platform: "win32", env: {} }), null);
assert.ok(codexCandidates({ runtimeRoot, platform: "win32", env: {}, homeDir: temporaryRoot }).some((item) => item.endsWith("codex.exe")));

assert.deepEqual(resolveTerminalShell({
  platform: "darwin",
  env: { SHELL: "/bin/zsh" },
}), { command: "/bin/zsh", args: ["-l"], kind: "posix" });
assert.deepEqual(resolveTerminalShell({
  platform: "win32",
  env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  findCommand: (command) => command === "pwsh.exe" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : null,
}), { command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", args: ["-NoLogo"], kind: "powershell" });
assert.deepEqual(resolveTerminalShell({
  platform: "win32",
  env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  findCommand: () => null,
}), { command: "C:\\Windows\\System32\\cmd.exe", args: ["/Q"], kind: "cmd" });

assert.deepEqual(workbenchWindowOptions("win32"), {});
assert.equal(workbenchWindowOptions("darwin").titleBarStyle, "hiddenInset");
assert.deepEqual(computerUseMcpArgs("darwin"), ["mcp", "--host-bundle-id", "com.userinner.onpeople"]);
assert.deepEqual(computerUseMcpArgs("win32"), ["mcp"]);

const windowsEditors = editorCandidates({
  platform: "win32",
  env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
  file: "C:\\repo\\src\\app.js",
  line: 14,
  column: 3,
  findCommand: (command) => command === "Code.exe" ? "C:\\bin\\Code.exe" : null,
});
assert.ok(windowsEditors.some((item) => item.binary === "C:\\bin\\Code.exe"));
assert.ok(windowsEditors.every((item) => item.args.includes("--goto")));

fs.rmSync(temporaryRoot, { recursive: true, force: true });
console.log("Cross-platform runtime checks passed.");
