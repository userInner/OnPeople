const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

if (process.platform !== "win32") {
  throw new Error("The NSIS installer must be built on Windows so Electron and node-pty target win32.");
}

const root = path.resolve(__dirname, "..");
const builderCli = require.resolve("electron-builder/out/cli/cli.js");
const releaseRoot = path.join(root, "release", "windows");
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const runtimeManifestPath = path.join(root, ".embedded-runtime", "manifest.json");
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
const version = require("../package.json").version;

assert.equal(runtimeManifest.target?.platform, "win32", "Staged Codex/Cua Driver runtimes must target Windows");
assert.equal(runtimeManifest.target?.arch, "x64", "Staged Codex/Cua Driver runtimes must target x64");

function runBuilder(args) {
  execFileSync(process.execPath, [builderCli, "--config", "electron-builder.yml", ...args, "--publish", "never"], {
    cwd: root,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || "false" },
    stdio: "inherit",
    windowsHide: true,
  });
}

fs.rmSync(releaseRoot, { recursive: true, force: true });
runBuilder(["--win", "--x64", "--dir"]);
execFileSync(process.execPath, [path.join(__dirname, "check-packaged-app.cjs"), unpackedRoot], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

const installedRuntimeRoot = path.join(unpackedRoot, "resources", ".embedded-runtime");
for (const file of ["bin\\codex.exe", "bin\\cua-driver.exe", "manifest.json"]) {
  assert.ok(fs.existsSync(path.join(installedRuntimeRoot, file)), `Embedded Windows runtime is missing: ${file}`);
}

runBuilder(["--win", "nsis", "--x64"]);
const installerName = `OnPeople-Setup-${version}-win-x64.exe`;
const installerPath = path.join(releaseRoot, installerName);
assert.ok(fs.existsSync(installerPath), `NSIS installer was not produced: ${installerPath}`);
assert.ok(fs.statSync(installerPath).size > 1_000_000, "NSIS installer is unexpectedly small");

console.log(`Packaged Windows installer: ${installerPath}`);
