const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const crossBuild = process.platform === "darwin" && process.env.ONPEOPLE_ALLOW_CROSS_WINDOWS_BUILD === "1";
if (process.platform !== "win32" && !crossBuild) {
  throw new Error("The NSIS installer must be built on Windows, or on macOS with the explicit package:win:cross workflow.");
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
if (crossBuild) {
  for (const file of [
    "node_modules/node-pty/prebuilds/win32-x64/pty.node",
    "node_modules/node-pty/prebuilds/win32-x64/conpty.node",
    "node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe",
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `Cross-build requires the Windows node-pty prebuild: ${file}`);
  }
}

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
for (const file of [["bin", "codex.exe"], ["bin", "cua-driver.exe"], ["manifest.json"]]) {
  const installedFile = path.join(installedRuntimeRoot, ...file);
  assert.ok(fs.existsSync(installedFile), `Embedded Windows runtime is missing: ${file.join("/")}`);
}

runBuilder(["--win", "nsis", "--x64"]);
const installerName = `OnPeople-Setup-${version}-win-x64.exe`;
const installerPath = path.join(releaseRoot, installerName);
const blockmapPath = `${installerPath}.blockmap`;
const updateManifestPath = path.join(releaseRoot, "latest.yml");
assert.ok(fs.existsSync(installerPath), `NSIS installer was not produced: ${installerPath}`);
assert.ok(fs.statSync(installerPath).size > 1_000_000, "NSIS installer is unexpectedly small");
assert.ok(fs.existsSync(blockmapPath), `Differential update blockmap was not produced: ${blockmapPath}`);
assert.ok(fs.existsSync(updateManifestPath), `Update manifest was not produced: ${updateManifestPath}`);

console.log(`Packaged Windows installer and update metadata: ${installerPath}`);
