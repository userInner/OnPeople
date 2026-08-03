const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appPath = path.resolve(process.argv[2] || path.join(root, "release", "OnPeople-darwin-arm64", "OnPeople.app"));
const entitlementsPath = path.join(root, "build", "entitlements.mac.plist");

if (process.platform !== "darwin") throw new Error("macOS signing must run on macOS");
if (!fs.existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`);
if (!fs.existsSync(entitlementsPath)) throw new Error(`Entitlements file not found: ${entitlementsPath}`);

execFileSync("/usr/bin/xattr", ["-cr", appPath], { stdio: "inherit" });
try {
  execFileSync("/usr/bin/xattr", ["-d", "com.apple.FinderInfo", appPath], { stdio: "ignore" });
} catch {}

function findDeveloperIdIdentity() {
  const identities = execFileSync("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ], { encoding: "utf8" });
  const match = identities.match(/"((?:Developer ID Application):[^"]+)"/);
  return match?.[1] || null;
}

function isMachO(filePath) {
  const description = execFileSync("/usr/bin/file", ["-b", filePath], { encoding: "utf8" });
  return /\bMach-O\b|\buniversal binary\b/.test(description);
}

function collectCodeObjects(directory) {
  const codeObjects = [];

  function walk(currentPath) {
    const stat = fs.lstatSync(currentPath);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (isMachO(currentPath)) codeObjects.push(currentPath);
      return;
    }
    if (!stat.isDirectory()) return;

    for (const entry of fs.readdirSync(currentPath)) {
      walk(path.join(currentPath, entry));
    }
    if (currentPath !== appPath && [".app", ".framework", ".xpc", ".appex"].includes(path.extname(currentPath))) {
      codeObjects.push(currentPath);
    }
  }

  walk(directory);
  return codeObjects;
}

function signCodeObject(filePath, identity) {
  const args = [
    "--force",
    "--sign",
    identity,
    identity === "-" ? "--timestamp=none" : "--timestamp",
    "--options",
    "runtime",
    "--entitlements",
    entitlementsPath,
    filePath,
  ];
  execFileSync("/usr/bin/codesign", args, { stdio: "inherit" });
}

async function main() {
  const configuredIdentity = process.env.ONPEOPLE_MAC_SIGN_IDENTITY?.trim();
  const developerIdIdentity = configuredIdentity || findDeveloperIdIdentity();
  const allowAdhoc = process.env.ONPEOPLE_ALLOW_ADHOC_SIGNING === "1";
  const identity = developerIdIdentity || (allowAdhoc ? "-" : null);

  if (!identity) {
    throw new Error(
      "Developer ID Application identity was not found. Install the certificate or set "
      + "ONPEOPLE_ALLOW_ADHOC_SIGNING=1 for a local-only test build.",
    );
  }

  const codeObjects = collectCodeObjects(appPath);
  codeObjects.sort((left, right) => {
    const depthDifference = right.split(path.sep).length - left.split(path.sep).length;
    return depthDifference || right.length - left.length;
  });
  console.log(`Signing ${codeObjects.length + 1} macOS code objects`);
  for (const codeObject of codeObjects) {
    signCodeObject(codeObject, identity);
  }
  signCodeObject(appPath, identity);

  execFileSync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ], { stdio: "inherit" });

  const details = spawnSync("/usr/bin/codesign", [
    "--display",
    "--verbose=4",
    appPath,
  ], { encoding: "utf8" });
  const diagnostic = `${details.stdout || ""}\n${details.stderr || ""}`;
  if (identity !== "-") {
    if (!diagnostic.includes("runtime")) {
      throw new Error("Hardened Runtime flag is missing from the app signature");
    }
  }

  console.log(`Signed and verified with ${identity === "-" ? "ad hoc identity" : identity}: ${appPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
