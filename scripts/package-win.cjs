const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const AdmZip = require("adm-zip");

if (process.platform !== "win32") {
  throw new Error("Windows packages must be built on Windows so node-pty and Electron native modules target win32.");
}

const root = path.resolve(__dirname, "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-package-"));
const packager = path.join(root, "node_modules", ".bin", "electron-packager.cmd");
const releaseRoot = path.join(root, "release");
const version = require("../package.json").version;
const architecture = process.env.ONPEOPLE_TARGET_ARCH || "x64";
const outputName = `OnPeople-win32-${architecture}`;
const packagerArgs = [
  ".",
  "OnPeople",
  "--platform=win32",
  `--arch=${architecture}`,
  `--out=${temporaryRoot}`,
  "--overwrite",
  "--app-version=" + version,
  "--win32metadata.CompanyName=OnPeople",
  "--win32metadata.FileDescription=OnPeople Agent Workbench",
  "--win32metadata.ProductName=OnPeople",
  "--icon=assets/OnPeople.ico",
  "--protocol=onpeople",
  "--protocol-name=OnPeople",
  "--ignore=^/(dist[^/]*|release[^/]*|\\.git|work)(/|$)",
];

fs.mkdirSync(releaseRoot, { recursive: true });
execFileSync(packager, packagerArgs, { cwd: root, stdio: "inherit", windowsHide: true });

const appPath = path.join(temporaryRoot, outputName);
execFileSync(process.execPath, [path.join(__dirname, "check-packaged-app.cjs"), appPath], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

const archive = path.join(releaseRoot, `OnPeople-${version}-win-${architecture}.zip`);
fs.rmSync(archive, { force: true });
const zip = new AdmZip();
zip.addLocalFolder(appPath, outputName);
zip.writeZip(archive);
console.log(`Packaged Windows release: ${archive}`);
