const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  executableName,
  isExecutable,
} = require("../src/platform-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const stageRoot = path.join(projectRoot, ".embedded-runtime");
const targetPlatform = process.env.ONPEOPLE_TARGET_PLATFORM || process.platform;
const targetArch = process.env.ONPEOPLE_TARGET_ARCH || process.arch;
const codexTarget = path.join(stageRoot, "bin", executableName("codex", targetPlatform));
const defaultCodexVersion = "0.146.0-alpha.3.1";

function firstExecutable(candidates) {
  return candidates.filter(Boolean).find((candidate) => isExecutable(candidate)) || null;
}

function codexTargetTriple() {
  if (targetPlatform === "darwin" && targetArch === "arm64") return "aarch64-apple-darwin";
  if (targetPlatform === "darwin" && targetArch === "x64") return "x86_64-apple-darwin";
  if (targetPlatform === "win32" && targetArch === "x64") return "x86_64-pc-windows-msvc";
  if (targetPlatform === "win32" && targetArch === "arm64") return "aarch64-pc-windows-msvc";
  if (targetPlatform === "linux" && targetArch === "x64") return "x86_64-unknown-linux-musl";
  if (targetPlatform === "linux" && targetArch === "arm64") return "aarch64-unknown-linux-musl";
  throw new Error(`No public Codex package mapping for ${targetPlatform}-${targetArch}`);
}

function explicitCodexSource() {
  const source = firstExecutable([process.env.CODEX_BUNDLE_SOURCE, process.env.CODEX_BIN]);
  return source ? {
    path: source,
    provenance: { kind: "file", source },
    cleanupRoot: null,
  } : null;
}

function downloadPublicCodex() {
  const version = process.env.CODEX_NPM_VERSION || process.env.CODEX_VERSION || defaultCodexVersion;
  const packageVersion = `${version}-${targetPlatform}-${targetArch}`;
  const packageSpec = `@openai/codex@${packageVersion}`;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-codex-"));
  // Spawning npm.cmd without a shell throws EINVAL on Node >= 22
  // (CVE-2024-27980 hardening); quote shell args that may contain spaces.
  const useShell = process.platform === "win32";
  const npmCommand = useShell ? "npm.cmd" : "npm";
  const shellArg = (value) => useShell && /\s/.test(value) ? `"${value}"` : value;
  try {
    const packed = JSON.parse(execFileSync(npmCommand, [
      "pack",
      packageSpec,
      "--json",
      "--pack-destination",
      shellArg(temporaryRoot),
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: useShell }))[0];
    if (!packed?.filename) throw new Error(`npm did not return an archive for ${packageSpec}`);
    execFileSync("tar", [
      "-xzf",
      path.join(temporaryRoot, packed.filename),
      "-C",
      temporaryRoot,
    ], { stdio: "inherit" });
    const source = path.join(
      temporaryRoot,
      "package",
      "vendor",
      codexTargetTriple(),
      "bin",
      executableName("codex", targetPlatform),
    );
    if (!isExecutable(source)) throw new Error(`Public Codex package did not contain ${source}`);
    return {
      path: source,
      provenance: {
        kind: "npm",
        source: `npm:${packageSpec}`,
        version,
        packageVersion,
        integrity: packed.integrity || null,
        shasum: packed.shasum || null,
      },
      cleanupRoot: temporaryRoot,
    };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function resolveCuaRuntime() {
  if (targetPlatform === "darwin") {
    const appCandidates = [
      process.env.CUA_DRIVER_APP_SOURCE,
      process.env.CUA_DRIVER_APP_PATH,
      "/Applications/CuaDriver.app",
    ].filter(Boolean);
    const appBundle = appCandidates.find((candidate) => (
      isExecutable(path.join(candidate, "Contents", "MacOS", "cua-driver"))
    ));
    return appBundle ? { kind: "app", source: appBundle } : null;
  }
  const source = firstExecutable([
    process.env.CUA_DRIVER_BINARY_SOURCE,
    process.env.CUA_DRIVER_PATH,
  ]);
  return source ? { kind: "binary", source } : null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const cuaRuntime = resolveCuaRuntime();
if (!cuaRuntime) {
  const variable = targetPlatform === "darwin" ? "CUA_DRIVER_APP_SOURCE" : "CUA_DRIVER_BINARY_SOURCE";
  throw new Error(`Cua Driver runtime for ${targetPlatform}-${targetArch} was not found. Set ${variable}.`);
}

const codexRuntime = explicitCodexSource() || downloadPublicCodex();
const codexSource = codexRuntime.path;

try {
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(codexTarget), { recursive: true });
  fs.copyFileSync(codexSource, codexTarget);
  if (targetPlatform !== "win32") fs.chmodSync(codexTarget, 0o755);

  let cuaTarget;
  if (cuaRuntime.kind === "app") {
    cuaTarget = path.join(stageRoot, "CuaDriver.app");
    fs.cpSync(cuaRuntime.source, cuaTarget, { recursive: true, preserveTimestamps: true });
  } else {
    cuaTarget = path.join(stageRoot, "bin", executableName("cua-driver", targetPlatform));
    fs.copyFileSync(cuaRuntime.source, cuaTarget);
    if (targetPlatform !== "win32") fs.chmodSync(cuaTarget, 0o755);
  }

  const cuaExecutable = cuaRuntime.kind === "app"
    ? path.join(cuaTarget, "Contents", "MacOS", "cua-driver")
    : cuaTarget;
  const manifest = {
    createdAt: new Date().toISOString(),
    target: { platform: targetPlatform, arch: targetArch },
    components: {
      codex: {
        ...codexRuntime.provenance,
        target: path.relative(stageRoot, codexTarget),
        sha256: sha256(codexTarget),
      },
      cuaDriver: {
        kind: cuaRuntime.kind,
        source: cuaRuntime.source,
        target: path.relative(stageRoot, cuaTarget),
        sha256: sha256(cuaExecutable),
      },
    },
    notice: "These separately licensed runtimes are staged for an authorized internal build and are not committed to this repository.",
  };
  fs.writeFileSync(path.join(stageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Staged ${targetPlatform}-${targetArch} Codex: ${codexTarget}`);
  console.log(`Staged ${targetPlatform}-${targetArch} Cua Driver: ${cuaTarget}`);
} finally {
  if (codexRuntime.cleanupRoot) {
    fs.rmSync(codexRuntime.cleanupRoot, { recursive: true, force: true });
  }
}
