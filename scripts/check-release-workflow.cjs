const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "cross-platform-check.yml"), "utf8");
const packageMac = fs.readFileSync(path.join(root, "scripts", "package-mac.cjs"), "utf8");

assert.match(workflow, /^  package-windows:/m);
assert.match(workflow, /^  package-macos:/m);
assert.match(workflow, /runs-on: macos-15/);
assert.match(workflow, /test "\$\(uname -m\)" = "arm64"/);
assert.match(workflow, /CODEX_NPM_VERSION: "0\.146\.0-alpha\.3\.1"/);
assert.doesNotMatch(workflow, /CODEX_BUNDLE_SOURCE=\$codex_source/);
assert.match(workflow, /cua-driver-rs-\$CUA_DRIVER_VERSION-darwin-arm64\.tar\.gz/);
assert.match(workflow, /shasum -a 256/);
assert.match(workflow, /npm run package:mac/);
assert.match(workflow, /release\/OnPeople-\*-macos-arm64\.zip/);
assert.match(workflow, /^  publish-release:/m);
assert.match(workflow, /- package-windows\s+      - package-macos/);
assert.match(workflow, /actions\/download-artifact@v5/);
assert.match(workflow, /gh release (create|upload)/);
assert.match(packageMac, /OnPeople-\$\{version\}-macos-arm64\.zip/);

console.log("release workflow checks passed");
