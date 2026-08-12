import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const triple = "x86_64-pc-windows-msvc";
const releaseDir = path.join(root, "target", triple, "release");
const cacheDir = path.join(
  os.homedir(),
  "Library",
  "Caches",
  "OnPeople",
  "windows-cross",
);
const codex = path.join(
  cacheDir,
  "codex-0.146.0-alpha.3.1",
  "package",
  "vendor",
  triple,
  "bin",
  "codex.exe",
);
const cua = path.join(
  cacheDir,
  "cua-driver-rs-0.12.4-windows-x86_64",
  "cua-driver.exe",
);
const embeddedRuntime = path.join(root, ".embedded-runtime");
const backupRoot = mkdtempSync(path.join(os.tmpdir(), "onpeople-runtime-"));
const runtimeBackup = path.join(backupRoot, ".embedded-runtime");

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

for (const required of [codex, cua]) {
  if (!existsSync(required)) {
    throw new Error(
      `Windows runtime cache is missing: ${required}. Run npm run package:win:cross once to populate it.`,
    );
  }
}

cpSync(embeddedRuntime, runtimeBackup, { recursive: true });
const env = {
  ...process.env,
  ONPEOPLE_ALLOW_CROSS_WINDOWS_BUILD: "1",
  ONPEOPLE_RELEASE_DIR: releaseDir,
  ONPEOPLE_TARGET_PLATFORM: "win32",
  ONPEOPLE_TARGET_ARCH: "x64",
  ONPEOPLE_ELECTRON_TARGET_TRIPLE: triple,
  CODEX_BUNDLE_SOURCE: codex,
  CUA_DRIVER_BINARY_SOURCE: cua,
  ONPEOPLE_MCP_HOST_SOURCE: path.join(releaseDir, "onpeople-mcp-host.exe"),
  ONPEOPLE_CLI_SOURCE: path.join(releaseDir, "onpeople.exe"),
};

try {
  run("cargo", [
    "xwin",
    "build",
    "--release",
    "--target",
    triple,
    "-p",
    "onpeople-desktop-host",
    "-p",
    "onpeople-mcp-host",
    "-p",
    "onpeople-cli",
  ], env);
  run("cargo", [
    "run",
    "-p",
    "xtask",
    "--",
    "stage-runtime",
    "--platform",
    "win32",
    "--arch",
    "x64",
  ], env);
  run("npm", ["run", "build"], env);
  run("node", ["electron-spike/stage-runtime.mjs"], env);
  run(
    path.join(root, "node_modules", ".bin", "electron-builder"),
    [
      "--config",
      "electron-spike/electron-builder.yml",
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
    ],
    env,
  );
} finally {
  rmSync(embeddedRuntime, { recursive: true, force: true });
  cpSync(runtimeBackup, embeddedRuntime, { recursive: true });
  rmSync(backupRoot, { recursive: true, force: true });
}
