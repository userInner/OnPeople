import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const triple = "x86_64-pc-windows-msvc";
const releaseDir = path.join(root, "target", triple, "release");
const cacheDir = path.resolve(
  process.env.ONPEOPLE_WINDOWS_CROSS_CACHE ||
    path.join(os.homedir(), "Library", "Caches", "OnPeople", "windows-cross"),
);
const codexVersion = process.env.CODEX_VERSION || "0.146.0-alpha.3.1";
const cuaVersion = process.env.CUA_DRIVER_VERSION || "0.12.4";
const cefArchiveName =
  "cef_binary_151.3.14+g5d67476+chromium-151.0.7922.72_windows64_minimal.tar.bz2";
const cefArchiveSha1 = "96abc7e46d7dfe31756be682e1c0d423807b498e";
const cefArchiveUrl = `https://cef-builds.spotifycdn.com/${encodeURIComponent(cefArchiveName)}`;
const signScript = path.join(root, "scripts", "sign-windows-cross.mjs");
const hasCertificate = Boolean(process.env.ONPEOPLE_WINDOWS_CERTIFICATE);

if (process.platform !== "darwin") {
  throw new Error("package:win:cross must run on macOS");
}

const llvmBins = [
  "/opt/homebrew/opt/llvm/bin",
  "/opt/homebrew/opt/lld/bin",
  "/usr/local/opt/llvm/bin",
  "/usr/local/opt/lld/bin",
].filter((entry) =>
  fs.statSync(entry, { throwIfNoEntry: false })?.isDirectory(),
);
const env = {
  ...process.env,
  PATH: [...llvmBins, process.env.PATH].filter(Boolean).join(path.delimiter),
  ONPEOPLE_ALLOW_CROSS_WINDOWS_BUILD: "1",
  ONPEOPLE_RELEASE_DIR: releaseDir,
  ONPEOPLE_TARGET_PLATFORM: "win32",
  ONPEOPLE_TARGET_ARCH: "x64",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env || env,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function commandPath(command) {
  const result = spawnSync("/usr/bin/which", [command], {
    env,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function requireCommand(command, installation) {
  const found = commandPath(command);
  if (!found)
    throw new Error(`${command} is required. Install it with: ${installation}`);
  return found;
}

function validateWindowsPe(binary) {
  const description = run("file", [binary], { capture: true });
  if (
    !description.includes("PE32+ executable") ||
    !description.includes("x86-64")
  ) {
    throw new Error(`Expected an x86-64 Windows PE binary: ${binary}`);
  }
}

function validateMsix(makeMsix, packagePath) {
  const verifyDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "onpeople-msix-verify-"),
  );
  try {
    run(makeMsix, ["unpack", "-ss", "-p", packagePath, "-d", verifyDir]);
    for (const relative of [
      "AppxManifest.xml",
      "OnPeople.exe",
      ".embedded-runtime/manifest.json",
      ".embedded-runtime/bin/onpeople-browser-host.exe",
      ".embedded-runtime/bin/onpeople-mcp-host.exe",
      ".embedded-runtime/bin/onpeople.exe",
      ".embedded-runtime/bin/libcef.dll",
    ]) {
      const expected = path.join(verifyDir, relative);
      if (!fs.statSync(expected, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`MSIX verification is missing ${relative}`);
      }
    }
  } finally {
    fs.rmSync(verifyDir, { recursive: true, force: true });
  }
}

function findFile(directory, name) {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory())
    return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return candidate;
    if (entry.isDirectory()) {
      const nested = findFile(candidate, name);
      if (nested) return nested;
    }
  }
  return null;
}

function findDirectory(directory, name) {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory())
    return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.name === name) return candidate;
    const nested = findDirectory(candidate, name);
    if (nested) return nested;
  }
  return null;
}

function digest(file, algorithm) {
  return crypto
    .createHash(algorithm)
    .update(fs.readFileSync(file))
    .digest("hex");
}

function sha256(file) {
  return digest(file, "sha256");
}

function prepareCodex() {
  if (process.env.CODEX_BUNDLE_SOURCE)
    return path.resolve(process.env.CODEX_BUNDLE_SOURCE);
  const extractDir = path.join(cacheDir, `codex-${codexVersion}`);
  const binary = path.join(
    extractDir,
    "package",
    "vendor",
    triple,
    "bin",
    "codex.exe",
  );
  if (fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) return binary;
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const archiveName = run(
    "npm",
    [
      "pack",
      `@openai/codex@${codexVersion}-win32-x64`,
      "--silent",
      "--pack-destination",
      cacheDir,
    ],
    { capture: true },
  )
    .split(/\r?\n/)
    .at(-1);
  run("tar", ["-xzf", path.join(cacheDir, archiveName), "-C", extractDir]);
  if (!fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      `Codex Windows runtime is missing after extraction: ${binary}`,
    );
  }
  return binary;
}

function prepareCuaDriver() {
  if (process.env.CUA_DRIVER_BINARY_SOURCE) {
    return path.resolve(process.env.CUA_DRIVER_BINARY_SOURCE);
  }
  const asset = `cua-driver-rs-${cuaVersion}-windows-x86_64-binary.zip`;
  const release = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${cuaVersion}`;
  const archive = path.join(cacheDir, asset);
  const checksums = path.join(
    cacheDir,
    `cua-driver-rs-${cuaVersion}-checksums.txt`,
  );
  const extractDir = path.join(
    cacheDir,
    `cua-driver-rs-${cuaVersion}-windows-x86_64`,
  );
  let binary = findFile(extractDir, "cua-driver.exe");
  if (binary) return binary;
  run("curl", [
    "--fail",
    "--location",
    "--retry",
    "3",
    `${release}/${asset}`,
    "--output",
    archive,
  ]);
  run("curl", [
    "--fail",
    "--location",
    "--retry",
    "3",
    `${release}/checksums.txt`,
    "--output",
    checksums,
  ]);
  const checksumLine = fs
    .readFileSync(checksums, "utf8")
    .split(/\r?\n/)
    .find((line) => line.includes(asset));
  if (!checksumLine)
    throw new Error(`Published checksum is missing for ${asset}`);
  const expected = checksumLine.trim().split(/\s+/)[0].toLowerCase();
  const actual = sha256(archive);
  if (actual !== expected)
    throw new Error(`Cua Driver checksum mismatch for ${asset}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  run("unzip", ["-q", "-o", archive, "-d", extractDir]);
  binary = findFile(extractDir, "cua-driver.exe");
  if (!binary)
    throw new Error("Cua Driver Windows runtime is missing after extraction");
  return binary;
}

function writeCefArchiveMetadata(cefDir) {
  fs.writeFileSync(
    path.join(cefDir, "archive.json"),
    `${JSON.stringify(
      {
        type: "minimal",
        name: cefArchiveName,
        sha1: cefArchiveSha1,
      },
      null,
      2,
    )}\n`,
  );
}

function patchCefForCargoXwin(cefDir) {
  const variables = path.join(cefDir, "cmake", "cef_variables.cmake");
  if (!fs.statSync(variables, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`CEF CMake configuration is missing: ${variables}`);
  }
  const source = fs.readFileSync(variables, "utf8");
  let patched = source.replace(
    /^\s*\/MP\s+# Multiprocess compilation\r?\n/m,
    "",
  );
  patched = patched.replace(
    /\s*# When using the Ninja generator clear the CMake defaults to avoid excessive\r?\n\s*# console warnings \(see issue #2120\)\.\r?\n\s*set\(CMAKE_CXX_FLAGS ""\)\r?\n\s*set\(CMAKE_CXX_FLAGS_DEBUG ""\)\r?\n\s*set\(CMAKE_CXX_FLAGS_RELEASE ""\)\r?\n/,
    "\n    # Preserve cargo-xwin's Windows SDK and C++ standard library flags.\n",
  );
  if (source === patched && source.includes("/MP")) {
    throw new Error("Unable to remove CEF /MP flag for clang-cl");
  }
  if (patched.includes('set(CMAKE_CXX_FLAGS "")')) {
    throw new Error("Unable to preserve cargo-xwin CMake C++ flags");
  }
  if (source !== patched) fs.writeFileSync(variables, patched);
}

function prepareCef() {
  if (process.env.ONPEOPLE_CEF_RUNTIME_SOURCE) {
    const configured = path.resolve(process.env.ONPEOPLE_CEF_RUNTIME_SOURCE);
    patchCefForCargoXwin(configured);
    return configured;
  }

  const cefRoot = path.join(cacheDir, "cef-151.3.14-windows-x86_64");
  const cefDir = path.join(cefRoot, "cef_windows_x86_64");
  if (
    !fs
      .statSync(path.join(cefDir, "archive.json"), {
        throwIfNoEntry: false,
      })
      ?.isFile()
  ) {
    fs.rmSync(cefRoot, { recursive: true, force: true });
    fs.mkdirSync(cefRoot, { recursive: true });

    // Reuse a verified Cargo build cache when present. A clean machine falls
    // back to the exact official CEF binary archive below.
    const cargoCached = findDirectory(
      path.join(releaseDir, "build"),
      "cef_windows_x86_64",
    );
    if (
      cargoCached &&
      fs
        .statSync(path.join(cargoCached, "archive.json"), {
          throwIfNoEntry: false,
        })
        ?.isFile()
    ) {
      fs.cpSync(cargoCached, cefDir, { recursive: true });
    } else {
      const archive = path.join(cefRoot, cefArchiveName);
      run("curl", [
        "--fail",
        "--location",
        "--retry",
        "3",
        cefArchiveUrl,
        "--output",
        archive,
      ]);
      const actualSha1 = digest(archive, "sha1");
      if (actualSha1 !== cefArchiveSha1) {
        throw new Error(`CEF SHA-1 mismatch for ${cefArchiveName}`);
      }
      run("tar", ["-xjf", archive, "-C", cefRoot]);
      const extracted = path.join(cefRoot, cefArchiveName.slice(0, -8));
      fs.renameSync(path.join(extracted, "Release"), cefDir);
      for (const entry of fs.readdirSync(path.join(extracted, "Resources"))) {
        fs.renameSync(
          path.join(extracted, "Resources", entry),
          path.join(cefDir, entry),
        );
      }
      for (const entry of [
        "CMakeLists.txt",
        "cmake",
        "include",
        "libcef_dll",
        "CREDITS.html",
      ]) {
        fs.renameSync(path.join(extracted, entry), path.join(cefDir, entry));
      }
      fs.rmSync(extracted, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
      writeCefArchiveMetadata(cefDir);
    }
  }
  if (
    !fs
      .statSync(path.join(cefDir, "libcef.dll"), {
        throwIfNoEntry: false,
      })
      ?.isFile()
  ) {
    throw new Error(`CEF Windows runtime is incomplete: ${cefDir}`);
  }
  patchCefForCargoXwin(cefDir);
  return cefDir;
}

fs.mkdirSync(cacheDir, { recursive: true });
requireCommand("cargo-xwin", "cargo install --locked cargo-xwin");
requireCommand("llvm-rc", "brew install llvm");
requireCommand("lld-link", "brew install lld");
requireCommand("makensis", "brew install makensis");
const makeMsix =
  process.env.ONPEOPLE_MAKEMSIX_BINARY ||
  [
    path.join(
      os.homedir(),
      "Library",
      "Caches",
      "OnPeople",
      "msix-packaging",
      ".vs",
      "bin",
      "makemsix",
    ),
    commandPath("makemsix"),
  ].find((candidate) =>
    candidate
      ? fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()
      : false,
  );
if (!makeMsix) {
  throw new Error(
    "makemsix is required. Build Microsoft msix-packaging or set ONPEOPLE_MAKEMSIX_BINARY",
  );
}
if (hasCertificate) requireCommand("osslsigncode", "brew install osslsigncode");

const codexBinary = prepareCodex();
const cuaBinary = prepareCuaDriver();
const cefDirectory = prepareCef();
const browserHost = path.join(releaseDir, "onpeople-browser-host.exe");
const mcpHost = path.join(releaseDir, "onpeople-mcp-host.exe");
const onpeopleCli = path.join(releaseDir, "onpeople.exe");
const buildEnv = {
  ...env,
  CEF_PATH: cefDirectory,
  CODEX_BUNDLE_SOURCE: codexBinary,
  CUA_DRIVER_BINARY_SOURCE: cuaBinary,
  ONPEOPLE_CEF_RUNTIME_SOURCE: cefDirectory,
  ONPEOPLE_BROWSER_HOST_SOURCE: browserHost,
  ONPEOPLE_MCP_HOST_SOURCE: mcpHost,
  ONPEOPLE_CLI_SOURCE: onpeopleCli,
};

run(
  "cargo",
  [
    "xwin",
    "build",
    "--release",
    "--target",
    triple,
    "-p",
    "onpeople-browser-host",
    "-p",
    "onpeople-mcp-host",
    "-p",
    "onpeople-cli",
  ],
  { env: buildEnv },
);

for (const binary of [browserHost, mcpHost, onpeopleCli]) {
  if (!fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Cross-compiled Windows sidecar is missing: ${binary}`);
  }
  if (hasCertificate) run(process.execPath, [signScript, binary]);
}

run(
  "cargo",
  [
    "run",
    "-p",
    "xtask",
    "--",
    "stage-runtime",
    "--platform",
    "win32",
    "--arch",
    "x64",
  ],
  {
    env: buildEnv,
  },
);
run("cargo", ["run", "-p", "xtask", "--", "package-contents"], {
  env: buildEnv,
});

const tauri = path.join(root, "node_modules", ".bin", "tauri");
if (!fs.statSync(tauri, { throwIfNoEntry: false })?.isFile()) {
  throw new Error("Tauri CLI is missing; run npm ci first");
}
const tauriArgs = [
  "build",
  "--runner",
  "cargo-xwin",
  "--target",
  triple,
  "--bundles",
  "nsis",
];
const tauriOverride = { bundle: {} };
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  tauriOverride.bundle.createUpdaterArtifacts = false;
}
if (hasCertificate) {
  tauriOverride.bundle.windows = {
    signCommand: `\"${process.execPath}\" \"${signScript}\" %1`,
  };
}
if (Object.keys(tauriOverride.bundle).length > 0) {
  const crossBuildConfig = path.join(
    root,
    "target",
    "windows-cross-build.conf.json",
  );
  fs.mkdirSync(path.dirname(crossBuildConfig), { recursive: true });
  fs.writeFileSync(
    crossBuildConfig,
    `${JSON.stringify(tauriOverride, null, 2)}\n`,
  );
  tauriArgs.push("--config", crossBuildConfig);
}
if (!hasCertificate) {
  console.warn(
    "Windows PFX is not configured; producing explicitly unsigned test artifacts.",
  );
}
run(tauri, tauriArgs, { env: buildEnv });

const msixEnv = {
  ...buildEnv,
  ONPEOPLE_MSIX_PUBLISHER: process.env.ONPEOPLE_MSIX_PUBLISHER || "",
  ONPEOPLE_MAKEMSIX_BINARY: makeMsix,
};
if (hasCertificate) {
  if (!msixEnv.ONPEOPLE_MSIX_PUBLISHER) {
    throw new Error(
      "ONPEOPLE_MSIX_PUBLISHER must match the subject of the Windows signing certificate",
    );
  }
  msixEnv.ONPEOPLE_MSIX_SIGN_SCRIPT = signScript;
} else {
  msixEnv.ONPEOPLE_MSIX_PUBLISHER = "CN=OnPeople Development";
  msixEnv.ONPEOPLE_MSIX_UNSIGNED = "1";
}
run("cargo", ["run", "-p", "xtask", "--", "package-msix"], { env: msixEnv });

const nsisDir = path.join(releaseDir, "bundle", "nsis");
const msix = fs
  .readdirSync(path.join(releaseDir, "bundle"), { withFileTypes: true })
  .find((entry) => entry.isFile() && entry.name.endsWith(".msix"));
if (!fs.statSync(nsisDir, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`NSIS output directory is missing: ${nsisDir}`);
}
const installers = fs
  .readdirSync(nsisDir)
  .filter((name) => name.endsWith(".exe"));
if (installers.length === 0) throw new Error("NSIS installer was not produced");
if (!msix) throw new Error("MSIX package was not produced");

for (const binary of [
  path.join(releaseDir, "onpeople-tauri.exe"),
  browserHost,
  mcpHost,
  onpeopleCli,
]) {
  validateWindowsPe(binary);
}
const msixPath = path.join(releaseDir, "bundle", msix.name);
validateMsix(makeMsix, msixPath);

console.log(`Windows NSIS: ${path.join(nsisDir, installers[0])}`);
console.log(`Windows MSIX: ${msixPath}`);
console.log(
  hasCertificate
    ? "Windows artifacts are Authenticode signed."
    : "Windows artifacts are unsigned test builds.",
);
