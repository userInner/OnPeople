const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const config = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
const installer = fs.readFileSync(path.join(root, "scripts", "package-win-installer.cjs"), "utf8");
const packageCheck = fs.readFileSync(path.join(root, "scripts", "check-packaged-app.cjs"), "utf8");

assert.equal(manifest.devDependencies["electron-builder"], "^26.0.12");
assert.match(manifest.scripts["package:win"], /package-win-installer\.cjs/);
assert.match(manifest.scripts["package:win:portable"], /package-win\.cjs/);
assert.match(config, /target:\s*nsis/);
assert.match(config, /artifactName:\s*OnPeople-Setup-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/);
assert.match(config, /publish:\s*[\s\S]*provider:\s*github[\s\S]*owner:\s*userInner[\s\S]*repo:\s*OnPeople/);
assert.match(config, /from:\s*\.embedded-runtime[\s\S]*to:\s*\.embedded-runtime/);
assert.match(config, /node_modules\/node-pty/);
assert.match(config, /allowToChangeInstallationDirectory:\s*true/);
assert.match(config, /createDesktopShortcut:\s*true/);
assert.match(config, /createStartMenuShortcut:\s*true/);
assert.match(config, /deleteAppDataOnUninstall:\s*false/);
assert.match(config, /differentialPackage:\s*true/);
assert.match(main, /path\.join\(process\.resourcesPath,\s*"\.embedded-runtime"\)/);
assert.match(installer, /check-packaged-app\.cjs/);
assert.match(installer, /bin\\\\codex\.exe/);
assert.match(installer, /bin\\\\cua-driver\.exe/);
assert.match(installer, /NSIS installer was not produced/);
assert.match(installer, /Differential update blockmap was not produced/);
assert.match(installer, /Update manifest was not produced/);
assert.match(packageCheck, /app\.asar/);
assert.match(packageCheck, /asar\.extractFile/);
assert.match(packageCheck, /ELECTRON_RUN_AS_NODE/);

console.log("Windows installer checks passed.");
