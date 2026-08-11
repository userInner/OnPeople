import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(electronRoot, "..");
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "onpeople-electron-metrics-"),
);
const metricsPath = path.join(temporaryRoot, "metrics.json");
const appBundle = path.join(
  repositoryRoot,
  "dist-electron",
  `mac-${process.arch === "arm64" ? "arm64" : "x64"}`,
  "OnPeople.app",
);
const packagedBinary = path.join(appBundle, "Contents", "MacOS", "OnPeople");
const developmentBinary = path.join(
  repositoryRoot,
  "node_modules",
  ".bin",
  "electron",
);
const usePackaged = await exists(packagedBinary);
const executable = usePackaged ? packagedBinary : developmentBinary;
const args = usePackaged ? [] : [path.join(electronRoot, "main.mjs")];

const child = execFile(
  executable,
  args,
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ONPEOPLE_ELECTRON_METRICS_FILE: metricsPath,
      ONPEOPLE_ELECTRON_AUTO_QUIT_MS: "5000",
    },
  },
  (error, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (error) process.stderr.write(`${error.message}\n`);
  },
);
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
if (exitCode !== 0)
  throw new Error(`Electron app exited with code ${exitCode}`);

const metrics = JSON.parse(await readFile(metricsPath, "utf8"));
const archive = path.join(
  repositoryRoot,
  "dist-electron",
  `onpeople-0.30.0-${process.arch}.zip`,
);
const archiveBytes = (await exists(archive))
  ? (await stat(archive)).size
  : null;
const installedBytes = (await exists(appBundle))
  ? await directorySizeBytes(appBundle)
  : null;
const gates = {
  rendererReadyUnder1500Ms:
    metrics.rendererReadyMs !== null && metrics.rendererReadyMs <= 1_500,
  rustHostStable: metrics.rustHostRestartCount === 0,
  rendererStable: metrics.windowCrashCount === 0,
};

process.stdout.write(
  `${JSON.stringify(
    {
      ...metrics,
      packaged: usePackaged,
      archiveBytes,
      installedBytes,
      gates,
      allGatesPassed: Object.values(gates).every(Boolean),
    },
    null,
    2,
  )}\n`,
);
await rm(temporaryRoot, { recursive: true, force: true });

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function directorySizeBytes(target) {
  const { stdout } = await execFileAsync("/usr/bin/du", ["-sk", target]);
  return Number.parseInt(stdout.trim().split(/\s+/)[0], 10) * 1024;
}
