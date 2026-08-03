const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "cross-platform-check.yml"), "utf8");
const packageMac = fs.readFileSync(path.join(root, "scripts", "package-mac.cjs"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");

assert.match(workflow, /^  package-windows:/m);
assert.match(workflow, /^  package-macos:/m);
assert.match(workflow, /runs-on: macos-15/);
assert.match(workflow, /test "\$\(uname -m\)" = "arm64"/);
assert.match(workflow, /CODEX_NPM_VERSION: "0\.146\.0-alpha\.3\.1"/);
assert.doesNotMatch(workflow, /CODEX_BUNDLE_SOURCE=\$codex_source/);
assert.match(workflow, /cua-driver-rs-\$CUA_DRIVER_VERSION-darwin-universal\.tar\.gz/);
assert.match(workflow, /shasum -a 256/);
assert.match(workflow, /npm run package:mac/);
assert.match(workflow, /release\/OnPeople-\*-macos-arm64\.zip/);
assert.match(workflow, /release\/OnPeople-\*-macos-arm64\.dmg/);
assert.match(workflow, /release\/OnPeople-\*-macos-x64\.zip/);
assert.match(workflow, /release\/OnPeople-\*-macos-x64\.dmg/);
assert.match(workflow, /^  publish-release:/m);
assert.match(workflow, /- package-windows\s+      - package-macos/);
assert.match(workflow, /actions\/download-artifact@v5/);
assert.match(workflow, /gh release (create|upload)/);
assert.match(workflow, /OnPeople-Setup-\*-win-x64\.exe/);
assert.match(workflow, /OnPeople-Setup-\*-win-x64\.exe\.blockmap/);
assert.match(workflow, /release\/windows\/latest\.yml/);
assert.match(workflow, /MS_STORE_IDENTITY_NAME/);
assert.match(workflow, /MS_STORE_PUBLISHER/);
assert.match(workflow, /MS_STORE_PUBLISHER_DISPLAY_NAME/);
assert.match(workflow, /Build Microsoft Store AppX package/);
assert.match(workflow, /node scripts\/package-win-store\.cjs/);
assert.match(workflow, /OnPeople-Windows-Store-x64/);
assert.match(workflow, /release\/store\/OnPeople-Store-\*-win-x64\.appx/);
assert.doesNotMatch(workflow, /DigiCert|DIGICERT|SM_API_KEY/);
assert.match(workflow, /windows_blockmap/);
assert.match(workflow, /windows_latest/);
assert.doesNotMatch(workflow, /release\/OnPeople-\*-win-x64\.zip/);
assert.doesNotMatch(workflow, /release\/windows\/win-unpacked/);
assert.doesNotMatch(workflow, /gh release (?:create|upload)[^\n]*OnPeople-Store/);
assert.match(packageMac, /ONPEOPLE_MAC_ARCHES \|\| "arm64,x64"/);
assert.match(packageMac, /notarytool/);
assert.match(packageMac, /--no-s3-acceleration/);
assert.match(packageMac, /attempt <= 3/);
assert.match(packageMac, /stapler/);
assert.match(packageMac, /function notarizeApp\(appPath\)/);
assert.match(packageMac, /function notarizeDmg\(dmgPath\)/);
assert.match(packageMac, /assets", "Logo\.icon/);
assert.match(packageMac, /"actool"/);
assert.match(packageMac, /"CFBundleIconName", "Logo"/);
assert.match(packageMac, /compileIconComposerBundle\(appPath\)/);
assert.ok(
  packageMac.indexOf("compileIconComposerBundle(appPath)") < packageMac.indexOf('path.join(__dirname, "sign-mac.cjs")'),
  "Icon Composer resources must be installed before code signing",
);
assert.ok(
  packageMac.lastIndexOf("notarizeApp(appPath)") < packageMac.lastIndexOf("createDmg(appPath, dmgPath)"),
  "The app must be notarized and stapled before it is copied into the DMG",
);
assert.ok(
  packageMac.lastIndexOf("notarizeDmg(dmgPath)") < packageMac.lastIndexOf("verifyDmgContents(dmgPath, publicRelease)"),
  "The final DMG contents must be verified after DMG notarization",
);
assert.match(mainSource, /process\.platform === "darwin" && !app\.isPackaged[^\n]+MAC_DOCK_ICON_PNG/);
assert.doesNotMatch(mainSource, /app\.dock\.setIcon\(APP_ICON_PNG\)/, "packaged Dock icon must not be replaced by the legacy PNG");
assert.match(packageMac, /OnPeople-\$\{version\}-macos-\$\{arch\}\$\{artifactSuffix\}\.dmg/);
assert.match(packageMac, /release\[\^\/\]\*\|output\|services/, "macOS packaging must exclude generated output");

console.log("release workflow checks passed");
