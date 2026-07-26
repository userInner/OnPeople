const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const config = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const storeConfig = fs.readFileSync(path.join(root, "electron-builder-store.yml"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
const installer = fs.readFileSync(path.join(root, "scripts", "package-win-installer.cjs"), "utf8");
const storePackager = fs.readFileSync(path.join(root, "scripts", "package-win-store.cjs"), "utf8");
const packageCheck = fs.readFileSync(path.join(root, "scripts", "check-packaged-app.cjs"), "utf8");

assert.equal(manifest.devDependencies["electron-builder"], "^26.0.12");
assert.match(manifest.scripts["package:win"], /package-win-installer\.cjs/);
assert.match(manifest.scripts["package:win:store"], /package-win-store\.cjs/);
assert.match(manifest.scripts["package:win:portable"], /package-win\.cjs/);
assert.match(config, /target:\s*nsis/);
assert.match(config, /artifactName:\s*OnPeople-Setup-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/);
assert.match(config, /publish:\s*[\s\S]*provider:\s*generic[\s\S]*url:\s*https:\/\/aibro\.vip\/onpeople\/update\/windows\//);
assert.doesNotMatch(config, /provider:\s*github/);
assert.match(fs.readFileSync(path.join(root, "src", "app-updater.cjs"), "utf8"), /setFeedURL\(\{ provider: "generic", url: this\.updateFeedUrl \}\)/);
assert.match(config, /from:\s*\.embedded-runtime[\s\S]*to:\s*\.embedded-runtime/);
assert.match(config, /node_modules\/node-pty/);
assert.match(config, /allowToChangeInstallationDirectory:\s*true/);
assert.match(config, /createDesktopShortcut:\s*true/);
assert.match(config, /createStartMenuShortcut:\s*true/);
assert.match(config, /deleteAppDataOnUninstall:\s*false/);
assert.match(config, /differentialPackage:\s*true/);
assert.match(storeConfig, /target:\s*appx/);
assert.match(storeConfig, /artifactName:\s*OnPeople-Store-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/);
assert.match(storeConfig, /electronUpdaterAware:\s*false/);
assert.match(storePackager, /ONPEOPLE_STORE_IDENTITY_NAME/);
assert.match(storePackager, /ONPEOPLE_STORE_PUBLISHER/);
assert.match(storePackager, /ONPEOPLE_STORE_PUBLISHER_DISPLAY_NAME/);
assert.match(storePackager, /AppxManifest\.xml/);
assert.match(storePackager, /\.embedded-runtime\/bin\/codex\.exe/);
assert.match(storePackager, /\.embedded-runtime\/bin\/cua-driver\.exe/);
for (const asset of ["StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png", "Wide310x150Logo.png"]) {
  assert.ok(fs.existsSync(path.join(root, "build", "appx", asset)), `Missing AppX asset: ${asset}`);
}
assert.match(main, /path\.join\(process\.resourcesPath,\s*"\.embedded-runtime"\)/);
assert.match(main, /isWindowsStore:\s*process\.windowsStore/);
assert.match(main, /ms-windows-store:\/\/downloadsandupdates/);
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
