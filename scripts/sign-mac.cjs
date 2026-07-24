const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appPath = path.resolve(process.argv[2] || path.join(root, "release", "OnPeople-darwin-arm64", "OnPeople.app"));

if (process.platform !== "darwin") throw new Error("macOS signing must run on macOS");
if (!fs.existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`);

execFileSync("/usr/bin/xattr", ["-cr", appPath], { stdio: "inherit" });
try {
  execFileSync("/usr/bin/xattr", ["-d", "com.apple.FinderInfo", appPath], { stdio: "ignore" });
} catch {}

execFileSync("/usr/bin/codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  "--timestamp=none",
  appPath,
], { stdio: "inherit" });

execFileSync("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  appPath,
], { stdio: "inherit" });

console.log(`Signed and verified: ${appPath}`);
