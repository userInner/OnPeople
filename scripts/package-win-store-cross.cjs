const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const AdmZip = require("adm-zip");

const root = path.resolve(__dirname, "..");
const releaseRoot = path.join(root, "release", "store");
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const stageRoot = path.join(releaseRoot, "msix-stage");
const assetsRoot = path.join(stageRoot, "assets");
const appRoot = path.join(stageRoot, "app");
const metadata = require("../package.json");
const version = metadata.version;
const description = metadata.description;
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(root, ".embedded-runtime", "manifest.json"), "utf8"));

function requireValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the Microsoft Store package`);
  return value;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

const makemsix = path.resolve(requireValue("ONPEOPLE_MAKEMSIX_BINARY"));
const identityName = requireValue("ONPEOPLE_STORE_IDENTITY_NAME");
const publisher = requireValue("ONPEOPLE_STORE_PUBLISHER");
const publisherDisplayName = requireValue("ONPEOPLE_STORE_PUBLISHER_DISPLAY_NAME");
const applicationId = String(process.env.ONPEOPLE_STORE_APPLICATION_ID || "OnPeople").trim();
const packagePath = path.join(releaseRoot, `OnPeople-Store-${version}-win-x64.msix`);
const packageVersion = `${version}.0`;

assert.notEqual(process.platform, "win32", "Use package-win-store.cjs on Windows");
assert.ok(fs.existsSync(makemsix), `Microsoft makemsix was not found: ${makemsix}`);
assert.ok(fs.existsSync(unpackedRoot), `Windows app directory was not found: ${unpackedRoot}`);
assert.match(identityName, /^[A-Za-z0-9.-]{3,50}$/, "Store identity name is not valid");
assert.match(applicationId, /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/, "Store application id is not valid");
assert.match(version, /^\d+\.\d+\.\d+$/, "App version must contain three numeric components");
assert.equal(runtimeManifest.target?.platform, "win32", "Staged runtimes must target Windows");
assert.equal(runtimeManifest.target?.arch, "x64", "Staged runtimes must target x64");

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity
    Name="${xml(identityName)}"
    ProcessorArchitecture="x64"
    Publisher="${xml(publisher)}"
    Version="${xml(packageVersion)}" />
  <Properties>
    <DisplayName>OnPeople</DisplayName>
    <PublisherDisplayName>${xml(publisherDisplayName)}</PublisherDisplayName>
    <Description>${xml(description || "OnPeople")}</Description>
    <Logo>assets\\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-US" />
    <Resource Language="zh-CN" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application Id="${xml(applicationId)}" Executable="app\\OnPeople.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        BackgroundColor="#FFFFFF"
        DisplayName="OnPeople"
        Square150x150Logo="assets\\Square150x150Logo.png"
        Square44x44Logo="assets\\Square44x44Logo.png"
        Description="${xml(description || "OnPeople")}">
        <uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png">
          <uap:ShowNameOnTiles>
            <uap:ShowOn Tile="wide310x150Logo" />
            <uap:ShowOn Tile="square150x150Logo" />
          </uap:ShowNameOnTiles>
        </uap:DefaultTile>
      </uap:VisualElements>
      <Extensions>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="onpeople">
            <uap:DisplayName>OnPeople</uap:DisplayName>
          </uap:Protocol>
        </uap:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
`;

fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(assetsRoot, { recursive: true });
fs.cpSync(unpackedRoot, appRoot, { recursive: true });
for (const asset of ["StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png", "Wide310x150Logo.png"]) {
  fs.copyFileSync(path.join(root, "build", "appx", asset), path.join(assetsRoot, asset));
}
fs.writeFileSync(path.join(stageRoot, "AppxManifest.xml"), manifest);
fs.rmSync(packagePath, { force: true });

execFileSync(makemsix, ["pack", "-d", stageRoot, "-p", packagePath], {
  cwd: root,
  stdio: "inherit",
});

assert.ok(fs.existsSync(packagePath), `Microsoft Store package was not produced: ${packagePath}`);
assert.ok(fs.statSync(packagePath).size > 1_000_000, "Microsoft Store package is unexpectedly small");

const archive = new AdmZip(packagePath);
const manifestEntry = archive.getEntry("AppxManifest.xml");
assert.ok(manifestEntry, "AppxManifest.xml is missing");
const appxManifest = manifestEntry.getData().toString("utf8");
assert.ok(appxManifest.includes(`Name="${identityName}"`), "Store identity was not written to AppxManifest.xml");
assert.ok(appxManifest.includes(`Publisher="${publisher}"`), "Store publisher was not written to AppxManifest.xml");
assert.ok(appxManifest.includes(`Application Id="${applicationId}"`), "Application id was not written to AppxManifest.xml");

for (const entry of [
  "AppxBlockMap.xml",
  "[Content_Types].xml",
  "app/resources/app.asar",
  "app/resources/.embedded-runtime/bin/codex.exe",
  "app/resources/.embedded-runtime/bin/cua-driver.exe",
  "assets/StoreLogo.png",
  "assets/Square150x150Logo.png",
  "assets/Square44x44Logo.png",
  "assets/Wide310x150Logo.png",
]) {
  assert.ok(archive.getEntry(entry), `Microsoft Store package is missing: ${entry}`);
}

fs.rmSync(stageRoot, { recursive: true, force: true });
console.log(`Packaged unsigned Microsoft Store submission artifact: ${packagePath}`);
