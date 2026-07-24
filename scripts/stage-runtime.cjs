const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  executableName,
  findOnPath,
  isExecutable,
} = require("../src/platform-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const stageRoot = path.join(projectRoot, ".embedded-runtime");
const targetPlatform = process.env.ONPEOPLE_TARGET_PLATFORM || process.platform;
const targetArch = process.env.ONPEOPLE_TARGET_ARCH || process.arch;
const codexTarget = path.join(stageRoot, "bin", executableName("codex", targetPlatform));

function firstExecutable(candidates) {
  return candidates.filter(Boolean).find((candidate) => isExecutable(candidate)) || null;
}

function resolveCodex() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [process.env.CODEX_BUNDLE_SOURCE, process.env.CODEX_BIN];
  if (targetPlatform === "darwin") {
    candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex");
  } else if (targetPlatform === "win32") {
    candidates.push(
      path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(localAppData, "Programs", "ChatGPT", "resources", "codex.exe"),
    );
  }
  return firstExecutable(candidates)
    || findOnPath(executableName("codex", targetPlatform), targetPlatform)
    || null;
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
  ]) || findOnPath(executableName("cua-driver", targetPlatform), targetPlatform);
  return source ? { kind: "binary", source } : null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const codexSource = resolveCodex();
const cuaRuntime = resolveCuaRuntime();
if (!codexSource) {
  throw new Error(`Codex runtime for ${targetPlatform}-${targetArch} was not found. Set CODEX_BUNDLE_SOURCE.`);
}
if (!cuaRuntime) {
  const variable = targetPlatform === "darwin" ? "CUA_DRIVER_APP_SOURCE" : "CUA_DRIVER_BINARY_SOURCE";
  throw new Error(`Cua Driver runtime for ${targetPlatform}-${targetArch} was not found. Set ${variable}.`);
}

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
    codex: { source: codexSource, target: path.relative(stageRoot, codexTarget), sha256: sha256(codexTarget) },
    cuaDriver: { source: cuaRuntime.source, target: path.relative(stageRoot, cuaTarget), sha256: sha256(cuaExecutable) },
  },
  notice: "These separately licensed runtimes are staged for an authorized internal build and are not committed to this repository.",
};
fs.writeFileSync(path.join(stageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Staged ${targetPlatform}-${targetArch} Codex: ${codexTarget}`);
console.log(`Staged ${targetPlatform}-${targetArch} Cua Driver: ${cuaTarget}`);
