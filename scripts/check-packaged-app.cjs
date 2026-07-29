const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");

const root = path.resolve(__dirname, "..");
const appPath = path.resolve(process.argv[2] || path.join(root, "release", "OnPeople-darwin-arm64", "OnPeople.app"));
const isMacBundle = appPath.endsWith(".app");
const resourcesRoot = isMacBundle
  ? path.join(appPath, "Contents", "Resources")
  : path.join(appPath, "resources");
const unpackedAppRoot = path.join(resourcesRoot, "app");
const asarPath = path.join(resourcesRoot, "app.asar");
const usesAsar = fs.existsSync(asarPath);
const appRoot = usesAsar ? asarPath : unpackedAppRoot;
const packagePath = path.join(unpackedAppRoot, "package.json");

assert.ok(usesAsar || fs.existsSync(packagePath), `Packaged application payload is missing under: ${resourcesRoot}`);
const manifest = usesAsar
  ? JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"))
  : JSON.parse(fs.readFileSync(packagePath, "utf8"));
const packageEntries = usesAsar
  ? asar.listPackage(asarPath).map((entry) => entry.replace(/^\/+/, "").split("/")[0]).filter(Boolean)
  : fs.readdirSync(appRoot);
const accidentalBuildTrees = [...new Set(packageEntries)].filter((name) => /^(dist|release)(?:-|$)/.test(name));
assert.deepEqual(accidentalBuildTrees, [], `Previous build trees leaked into the app: ${accidentalBuildTrees.join(", ")}`);

const executablePath = isMacBundle
  ? path.join(appPath, "Contents", "MacOS", "OnPeople")
  : path.join(appPath, "OnPeople.exe");
const dependencyProbe = `
  const path = require("node:path");
  const appRoot = ${JSON.stringify(appRoot)};
  const dependencies = ${JSON.stringify(Object.keys(manifest.dependencies || {}))};
  for (const dependency of dependencies) require.resolve(dependency, { paths: [appRoot] });
  require(require.resolve("rrule", { paths: [appRoot] }));
  require(require.resolve("node-pty", { paths: [appRoot] }));
`;
execFileSync(executablePath, [
  "-e",
  dependencyProbe,
], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "ignore",
  windowsHide: true,
});

if (isMacBundle) {
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  const readPlistValue = (key) => {
    try {
      return execFileSync("/usr/libexec/PlistBuddy", [
        "-c",
        `Print :${key}`,
        infoPlist,
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  assert.equal(
    readPlistValue("CFBundleIdentifier"),
    "com.userinner.onpeople",
    "macOS package must use the canonical OnPeople bundle identifier",
  );
  assert.equal(readPlistValue("LSBackgroundOnly"), null, "OnPeople must not be packaged as a background-only app");
  assert.equal(readPlistValue("LSUIElement"), null, "OnPeople must keep a normal Dock/window presence");
  execFileSync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ], { stdio: "ignore" });
}

console.log(`Packaged app checks passed: ${manifest.version} · ${usesAsar ? "ASAR" : "directory"}`);
