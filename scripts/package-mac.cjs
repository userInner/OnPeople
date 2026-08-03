const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packager = path.join(root, "node_modules", ".bin", "electron-packager");
const releaseRoot = path.join(root, "release");
const version = require("../package.json").version;
const electronVersion = require("electron/package.json").version;
const requestedArchitectures = (process.env.ONPEOPLE_MAC_ARCHES || "arm64,x64")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedArchitectures = new Set(["arm64", "x64"]);
const notaryProfile = process.env.ONPEOPLE_NOTARY_PROFILE?.trim() || "";
const allowAdhoc = process.env.ONPEOPLE_ALLOW_ADHOC_SIGNING === "1";
const iconComposerSource = path.join(root, "assets", "Logo.icon");

for (const arch of requestedArchitectures) {
  if (!allowedArchitectures.has(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`);
}
if (requestedArchitectures.length === 0) throw new Error("At least one macOS architecture is required");

function findElectronZipDirectory(arch) {
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "electron");
  if (!fs.existsSync(cacheRoot)) return null;
  const expected = `electron-v${electronVersion}-darwin-${arch}.zip`;
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(cacheRoot, entry.name, expected);
    if (fs.existsSync(candidate)) return path.dirname(candidate);
  }
  return null;
}

fs.mkdirSync(releaseRoot, { recursive: true });

function command(file, args, options = {}) {
  return execFileSync(file, args, { cwd: root, stdio: "inherit", ...options });
}

function setPlistString(plistPath, key, value) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :${key} ${value}`,
      plistPath,
    ], { stdio: "ignore" });
  } catch {
    command("/usr/libexec/PlistBuddy", [
      "-c",
      `Add :${key} string ${value}`,
      plistPath,
    ]);
  }
}

function compileIconComposerBundle(appPath) {
  if (!fs.existsSync(path.join(iconComposerSource, "icon.json"))) {
    throw new Error(`Icon Composer source is missing: ${iconComposerSource}`);
  }

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-icon-composer-"));
  const compiledRoot = path.join(outputRoot, "compiled");
  const partialPlist = path.join(outputRoot, "partial.plist");
  const resourcesRoot = path.join(appPath, "Contents", "Resources");
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  try {
    fs.mkdirSync(compiledRoot, { recursive: true });
    command("/usr/bin/xcrun", [
      "actool",
      iconComposerSource,
      "--compile",
      compiledRoot,
      "--output-partial-info-plist",
      partialPlist,
      "--app-icon",
      "Logo",
      "--platform",
      "macosx",
      "--minimum-deployment-target",
      "12.0",
      "--target-device",
      "mac",
      "--standalone-icon-behavior",
      "all",
      "--output-format",
      "human-readable-text",
      "--warnings",
      "--errors",
      "--notices",
    ]);

    for (const fileName of ["Assets.car", "Logo.icns"]) {
      const source = path.join(compiledRoot, fileName);
      if (!fs.existsSync(source)) throw new Error(`Icon Composer did not produce ${fileName}`);
      fs.copyFileSync(source, path.join(resourcesRoot, fileName));
    }

    setPlistString(infoPlist, "CFBundleIconFile", "Logo");
    setPlistString(infoPlist, "CFBundleIconName", "Logo");
    fs.rmSync(path.join(resourcesRoot, "electron.icns"), { force: true });
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

function findDeveloperIdIdentity() {
  const identities = execFileSync("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ], { encoding: "utf8" });
  return identities.match(/"((?:Developer ID Application):[^"]+)"/)?.[1] || null;
}

function signDiskImage(dmgPath, identity) {
  const args = ["--force", "--timestamp", "--sign", identity, dmgPath];
  command("/usr/bin/codesign", args);
  command("/usr/bin/codesign", ["--verify", "--verbose=2", dmgPath]);
}

function createDmg(appPath, dmgPath) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-dmg-"));
  try {
    fs.cpSync(appPath, path.join(stagingRoot, "OnPeople.app"), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    fs.symlinkSync("/Applications", path.join(stagingRoot, "Applications"));
    fs.rmSync(dmgPath, { force: true });
    command("/usr/bin/hdiutil", [
      "create",
      "-volname",
      "OnPeople",
      "-srcfolder",
      stagingRoot,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ]);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function verifyDmgContents(dmgPath, requireStapledApp = false) {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-dmg-verify-"));
  let attached = false;
  try {
    command("/usr/bin/hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mountPoint,
      dmgPath,
    ]);
    attached = true;
    const mountedAppPath = path.join(mountPoint, "OnPeople.app");
    command("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      mountedAppPath,
    ]);
    if (requireStapledApp) {
      command("/usr/bin/xcrun", ["stapler", "validate", mountedAppPath]);
      command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", mountedAppPath]);
    }
  } finally {
    if (attached) command("/usr/bin/hdiutil", ["detach", mountPoint]);
    fs.rmSync(mountPoint, { recursive: true, force: true });
  }
}

function prepareNativeDependencies(appPath, arch) {
  const appNodeModules = path.join(appPath, "Contents", "Resources", "app", "node_modules");
  fs.rmSync(path.join(appNodeModules, "mammoth", "test"), { recursive: true, force: true });
  const nodePtyRoot = path.join(appNodeModules, "node-pty");
  fs.rmSync(path.join(nodePtyRoot, "build"), { recursive: true, force: true });
  fs.rmSync(path.join(nodePtyRoot, "bin"), { recursive: true, force: true });
  const nodePtyPrebuilds = path.join(nodePtyRoot, "prebuilds");
  if (fs.existsSync(nodePtyPrebuilds)) {
    for (const entry of fs.readdirSync(nodePtyPrebuilds)) {
      if (entry !== `darwin-${arch}`) {
        fs.rmSync(path.join(nodePtyPrebuilds, entry), { recursive: true, force: true });
      }
    }
  }

  const canvasPackage = `@napi-rs/canvas-darwin-${arch}`;
  const canvasScopeRoot = path.join(appNodeModules, "@napi-rs");
  const canvasTarget = path.join(canvasScopeRoot, `canvas-darwin-${arch}`);
  for (const entry of fs.readdirSync(canvasScopeRoot)) {
    if (entry.startsWith("canvas-darwin-") && entry !== `canvas-darwin-${arch}`) {
      fs.rmSync(path.join(canvasScopeRoot, entry), { recursive: true, force: true });
    }
  }
  if (fs.existsSync(canvasTarget)) return;

  const canvasManifest = require(path.join(root, "node_modules", "@napi-rs", "canvas", "package.json"));
  const canvasVersion = canvasManifest.optionalDependencies?.[canvasPackage];
  if (!canvasVersion) throw new Error(`Missing optional dependency version for ${canvasPackage}`);

  const sourcePackage = path.join(root, "node_modules", "@napi-rs", `canvas-darwin-${arch}`);
  if (fs.existsSync(sourcePackage)) {
    fs.cpSync(sourcePackage, canvasTarget, { recursive: true, preserveTimestamps: true });
    return;
  }

  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), `onpeople-canvas-${arch}-`));
  try {
    const archiveName = execFileSync("npm", [
      "pack",
      `${canvasPackage}@${canvasVersion}`,
      "--pack-destination",
      downloadRoot,
      "--silent",
    ], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).pop();
    if (!archiveName) throw new Error(`npm pack did not return an archive for ${canvasPackage}`);
    fs.mkdirSync(canvasTarget, { recursive: true });
    command("/usr/bin/tar", [
      "-xzf",
      path.join(downloadRoot, archiveName),
      "-C",
      canvasTarget,
      "--strip-components=1",
    ]);
  } finally {
    fs.rmSync(downloadRoot, { recursive: true, force: true });
  }
}

function submitForNotarization(artifactPath) {
  const args = [
    "notarytool",
    "submit",
    artifactPath,
    "--keychain-profile",
    notaryProfile,
    "--no-s3-acceleration",
    "--wait",
  ];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      command("/usr/bin/xcrun", args);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(`Notarization upload failed (attempt ${attempt}/3); retrying in ${attempt * 10}s`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 10_000);
    }
  }
}

function notarizeApp(appPath) {
  if (!notaryProfile) return;
  const submissionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-app-notary-"));
  const archivePath = path.join(submissionRoot, "OnPeople.zip");
  try {
    command("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, archivePath]);
    submitForNotarization(archivePath);
  } finally {
    fs.rmSync(submissionRoot, { recursive: true, force: true });
  }
  command("/usr/bin/xcrun", ["stapler", "staple", appPath]);
  command("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
}

function notarizeDmg(dmgPath) {
  if (!notaryProfile) return;
  submitForNotarization(dmgPath);
  command("/usr/bin/xcrun", ["stapler", "staple", dmgPath]);
  command("/usr/bin/xcrun", ["stapler", "validate", dmgPath]);
}

function packageArchitecture(arch, developerIdIdentity) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `onpeople-package-${arch}-`));
  try {
    command(process.execPath, [path.join(__dirname, "stage-runtime.cjs")], {
      env: {
        ...process.env,
        ONPEOPLE_TARGET_PLATFORM: "darwin",
        ONPEOPLE_TARGET_ARCH: arch,
      },
    });

    const packagerArgs = [
      ".",
      "OnPeople",
      "--platform=darwin",
      `--arch=${arch}`,
      `--out=${temporaryRoot}`,
      "--overwrite",
      "--app-bundle-id=com.userinner.onpeople",
      "--icon=assets/OnPeople.icns",
      "--protocol=onpeople",
      "--protocol-name=OnPeople",
      "--ignore=^/(dist[^/]*|release[^/]*|output|services|\\.git|work)(/|$)",
    ];
    const electronZipDirectory = findElectronZipDirectory(arch);
    if (electronZipDirectory) packagerArgs.push(`--electron-zip-dir=${electronZipDirectory}`);
    command(packager, packagerArgs);

    const appPath = path.join(temporaryRoot, `OnPeople-darwin-${arch}`, "OnPeople.app");
    command("/usr/libexec/PlistBuddy", [
      "-c",
      "Set :NSMicrophoneUsageDescription OnPeople uses the microphone only while you are in a GPT-Live voice conversation.",
      path.join(appPath, "Contents", "Info.plist"),
    ]);
    prepareNativeDependencies(appPath, arch);
    compileIconComposerBundle(appPath);
    command(process.execPath, [path.join(__dirname, "sign-mac.cjs"), appPath]);
    command(process.execPath, [path.join(__dirname, "check-packaged-app.cjs"), appPath]);

    const publicRelease = Boolean(developerIdIdentity && notaryProfile);
    const artifactSuffix = publicRelease
      ? ""
      : developerIdIdentity
        ? "-signed-unnotarized"
        : "-unsigned-test";
    const dmgPath = path.join(releaseRoot, `OnPeople-${version}-macos-${arch}${artifactSuffix}.dmg`);
    const archivePath = path.join(releaseRoot, `OnPeople-${version}-macos-${arch}${artifactSuffix}.zip`);
    notarizeApp(appPath);
    createDmg(appPath, dmgPath);
    if (developerIdIdentity) signDiskImage(dmgPath, developerIdIdentity);
    notarizeDmg(dmgPath);
    verifyDmgContents(dmgPath, publicRelease);

    fs.rmSync(archivePath, { force: true });
    command("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, archivePath]);
    command("/usr/bin/file", [path.join(appPath, "Contents", "MacOS", "OnPeople")]);
    if (publicRelease) {
      command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
      command("/usr/sbin/spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmgPath]);
    }
    console.log(`Packaged release: ${dmgPath}`);
    console.log(`Packaged release: ${archivePath}`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const developerIdIdentity = process.env.ONPEOPLE_MAC_SIGN_IDENTITY?.trim() || findDeveloperIdIdentity();
if (!developerIdIdentity && !allowAdhoc) {
  throw new Error(
    "Developer ID Application identity was not found. Install it before creating public macOS artifacts, "
    + "or set ONPEOPLE_ALLOW_ADHOC_SIGNING=1 for architecture-only test packages.",
  );
}
if (notaryProfile && !developerIdIdentity) {
  throw new Error("Notarization requires a Developer ID Application identity");
}

for (const arch of requestedArchitectures) packageArchitecture(arch, developerIdIdentity);
