const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function executableName(name, platform = process.platform) {
  return platform === "win32" && !name.toLowerCase().endsWith(".exe") ? `${name}.exe` : name;
}

function isExecutable(candidate, fsModule = fs) {
  if (!candidate) return false;
  try {
    fsModule.accessSync(candidate, fsModule.constants.X_OK);
    return fsModule.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function findOnPath(command, platform = process.platform, run = execFileSync) {
  const resolver = platform === "win32" ? "where.exe" : "which";
  try {
    const output = run(resolver, [command], { encoding: "utf8", windowsHide: true });
    return String(output).split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function embeddedBinaryPath(runtimeRoot, name, platform = process.platform) {
  return path.join(runtimeRoot, "bin", executableName(name, platform));
}

function codexCandidates({
  runtimeRoot,
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  const candidates = [
    env.CODEX_BIN,
    embeddedBinaryPath(runtimeRoot, "codex", platform),
  ];
  if (platform === "darwin") {
    candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex");
  } else if (platform === "win32") {
    candidates.push(
      path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "Programs", "ChatGPT", "resources", "codex.exe"),
    );
  }
  return candidates.filter(Boolean);
}

function findCodexBinary(options = {}) {
  const platform = options.platform || process.platform;
  for (const candidate of codexCandidates({ ...options, platform })) {
    if (isExecutable(candidate, options.fsModule || fs)) return candidate;
  }
  const fromPath = findOnPath(executableName("codex", platform), platform, options.execFileSync || execFileSync);
  if (fromPath) return fromPath;
  throw new Error("Codex CLI was not found. Set CODEX_BIN to an executable Codex CLI path.");
}

function cuaDriverCandidates({
  runtimeRoot,
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  const candidates = [env.CUA_DRIVER_PATH];
  if (platform === "darwin") {
    candidates.push(
      path.join(runtimeRoot, "CuaDriver.app", "Contents", "MacOS", "cua-driver"),
      path.join(homeDir, ".local", "bin", "cua-driver"),
    );
  } else {
    candidates.push(
      embeddedBinaryPath(runtimeRoot, "cua-driver", platform),
      path.join(homeDir, ".local", "bin", executableName("cua-driver", platform)),
    );
  }
  return candidates.filter(Boolean);
}

function findCuaDriverBinary(options = {}) {
  const platform = options.platform || process.platform;
  for (const candidate of cuaDriverCandidates({ ...options, platform })) {
    if (isExecutable(candidate, options.fsModule || fs)) return candidate;
  }
  return findOnPath(executableName("cua-driver", platform), platform, options.execFileSync || execFileSync);
}

function findCuaDriverApp({
  runtimeRoot,
  platform = process.platform,
  env = process.env,
  fsModule = fs,
} = {}) {
  if (platform !== "darwin") return null;
  const candidates = [
    env.CUA_DRIVER_APP_PATH,
    path.join(runtimeRoot, "CuaDriver.app"),
    "/Applications/CuaDriver.app",
  ].filter(Boolean);
  return candidates.find((candidate) => (
    isExecutable(path.join(candidate, "Contents", "MacOS", "cua-driver"), fsModule)
  )) || null;
}

function resolveTerminalShell({
  platform = process.platform,
  env = process.env,
  findCommand = (command) => findOnPath(command, platform),
} = {}) {
  if (platform === "win32") {
    const powershell = findCommand("pwsh.exe") || findCommand("powershell.exe");
    if (powershell) return { command: powershell, args: ["-NoLogo"], kind: "powershell" };
    return {
      command: env.ComSpec || path.join(env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
      args: ["/Q"],
      kind: "cmd",
    };
  }
  return {
    command: env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
    args: ["-l"],
    kind: "posix",
  };
}

function workbenchWindowOptions(platform = process.platform) {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
    };
  }
  if (platform === "win32") {
    return {
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#ffffff",
        symbolColor: "#69717a",
        height: 42,
      },
    };
  }
  return { autoHideMenuBar: true };
}

function computerUseMcpArgs(platform = process.platform) {
  return platform === "darwin"
    ? ["mcp", "--host-bundle-id", "com.userinner.onpeople"]
    : ["mcp", "--embedded"];
}

function editorCandidates({
  platform = process.platform,
  env = process.env,
  file,
  line,
  column,
  findCommand = (command) => findOnPath(command, platform),
} = {}) {
  const location = `${file}:${line}:${column}`;
  if (platform === "darwin") {
    return [
      { binary: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor", args: ["--goto", location] },
      { binary: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", args: ["--goto", location] },
      { binary: "/Applications/Zed.app/Contents/MacOS/cli", args: [location] },
    ];
  }
  if (platform === "win32") {
    const localPrograms = path.join(env.LOCALAPPDATA || "", "Programs");
    return [
      { binary: findCommand("Cursor.exe") || path.join(localPrograms, "cursor", "Cursor.exe"), args: ["--goto", location] },
      { binary: findCommand("Code.exe") || path.join(localPrograms, "Microsoft VS Code", "Code.exe"), args: ["--goto", location] },
    ].filter((item) => item.binary);
  }
  return [
    { binary: findCommand("cursor"), args: ["--goto", location] },
    { binary: findCommand("code"), args: ["--goto", location] },
    { binary: findCommand("zed"), args: [location] },
  ].filter((item) => item.binary);
}

module.exports = {
  codexCandidates,
  computerUseMcpArgs,
  cuaDriverCandidates,
  editorCandidates,
  embeddedBinaryPath,
  executableName,
  findCodexBinary,
  findCuaDriverApp,
  findCuaDriverBinary,
  findOnPath,
  isExecutable,
  resolveTerminalShell,
  workbenchWindowOptions,
};
