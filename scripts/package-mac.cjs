const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-package-"));
const packager = path.join(root, "node_modules", ".bin", "electron-packager");
const releaseRoot = path.join(root, "release");
const version = require("../package.json").version;
const electronVersion = require("electron/package.json").version;

function findElectronZipDirectory() {
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "electron");
  if (!fs.existsSync(cacheRoot)) return null;
  const expected = `electron-v${electronVersion}-darwin-arm64.zip`;
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(cacheRoot, entry.name, expected);
    if (fs.existsSync(candidate)) return path.dirname(candidate);
  }
  return null;
}

fs.mkdirSync(releaseRoot, { recursive: true });
const packagerArgs = [
  ".",
  "OnPeople",
  "--platform=darwin",
  "--arch=arm64",
  `--out=${temporaryRoot}`,
  "--overwrite",
  "--app-bundle-id=com.userinner.onpeople",
  "--icon=assets/OnPeople.icns",
  "--protocol=onpeople",
  "--protocol-name=OnPeople",
  "--ignore=^/(dist[^/]*|release[^/]*|output|services|\\.git|work)(/|$)",
];
const electronZipDirectory = findElectronZipDirectory();
if (electronZipDirectory) packagerArgs.push(`--electron-zip-dir=${electronZipDirectory}`);
execFileSync(packager, packagerArgs, { cwd: root, stdio: "inherit" });

const appPath = path.join(temporaryRoot, "OnPeople-darwin-arm64", "OnPeople.app");
execFileSync("/usr/libexec/PlistBuddy", [
  "-c",
  "Set :NSMicrophoneUsageDescription OnPeople uses the microphone only while you are in a GPT-Live voice conversation.",
  path.join(appPath, "Contents", "Info.plist"),
], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "sign-mac.cjs"), appPath], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "check-packaged-app.cjs"), appPath], { cwd: root, stdio: "inherit" });

const archive = path.join(releaseRoot, `OnPeople-${version}-macos-arm64.zip`);
fs.rmSync(archive, { force: true });
execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, archive], { stdio: "inherit" });
console.log(`Packaged release: ${archive}`);
