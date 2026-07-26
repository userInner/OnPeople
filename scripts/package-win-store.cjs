const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const AdmZip = require("adm-zip");

if (process.platform !== "win32") {
  throw new Error("The Microsoft Store package must be built on Windows.");
}

const root = path.resolve(__dirname, "..");
const builderCli = require.resolve("electron-builder/out/cli/cli.js");
const releaseRoot = path.join(root, "release", "store");
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(root, ".embedded-runtime", "manifest.json"), "utf8"));
const version = require("../package.json").version;

function requireStoreValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the Microsoft Store package`);
  return value;
}

const identityName = requireStoreValue("ONPEOPLE_STORE_IDENTITY_NAME");
const publisher = requireStoreValue("ONPEOPLE_STORE_PUBLISHER");
const publisherDisplayName = requireStoreValue("ONPEOPLE_STORE_PUBLISHER_DISPLAY_NAME");
const applicationId = String(process.env.ONPEOPLE_STORE_APPLICATION_ID || "OnPeople").trim();

assert.match(identityName, /^[A-Za-z0-9.-]{3,50}$/, "Store identity name is not valid");
assert.match(applicationId, /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/, "Store application id is not valid");
assert.equal(runtimeManifest.target?.platform, "win32", "Staged runtimes must target Windows");
assert.equal(runtimeManifest.target?.arch, "x64", "Staged runtimes must target x64");

fs.rmSync(releaseRoot, { recursive: true, force: true });
execFileSync(process.execPath, [
  builderCli,
  "--config",
  "electron-builder-store.yml",
  "--win",
  "appx",
  "--x64",
  `--config.appx.identityName=${identityName}`,
  `--config.appx.publisher=${publisher}`,
  `--config.appx.publisherDisplayName=${publisherDisplayName}`,
  `--config.appx.applicationId=${applicationId}`,
  "--publish",
  "never",
], {
  cwd: root,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  stdio: "inherit",
  windowsHide: true,
});

const packagePath = path.join(releaseRoot, `OnPeople-Store-${version}-win-x64.appx`);
assert.ok(fs.existsSync(packagePath), `Microsoft Store package was not produced: ${packagePath}`);
assert.ok(fs.statSync(packagePath).size > 1_000_000, "Microsoft Store package is unexpectedly small");

const archive = new AdmZip(packagePath);
const manifestEntry = archive.getEntry("AppxManifest.xml");
assert.ok(manifestEntry, "AppxManifest.xml is missing");
const appxManifest = manifestEntry.getData().toString("utf8");
assert.ok(appxManifest.includes(`Name=\"${identityName}\"`), "Store identity was not written to AppxManifest.xml");
assert.ok(appxManifest.includes(`Publisher='${publisher}'`), "Store publisher was not written to AppxManifest.xml");
assert.ok(appxManifest.includes(`Application Id=\"${applicationId}\"`), "Application id was not written to AppxManifest.xml");

for (const entry of [
  "app/resources/app.asar",
  "app/resources/.embedded-runtime/bin/codex.exe",
  "app/resources/.embedded-runtime/bin/cua-driver.exe",
  "assets/StoreLogo.png",
  "assets/Square150x150Logo.png",
  "assets/Square44x44Logo.png",
  "assets/Wide310x150Logo.png",
]) {
  assert.ok(archive.getEntry(entry), `Microsoft Store package is missing: ${entry}`);
}

console.log(`Packaged unsigned Microsoft Store submission artifact: ${packagePath}`);
