import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const spikeRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(spikeRoot, "..");
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "onpeople-electron-webcontentsview-metrics-"),
);
const metricsPath = path.join(temporaryRoot, "metrics.json");
const appBundle = path.join(
  repositoryRoot,
  "dist-electron-spike",
  `mac-${process.arch === "arm64" ? "arm64" : "x64"}`,
  "OnPeople Electron Spike.app",
);
const packagedBinary = path.join(
  appBundle,
  "Contents",
  "MacOS",
  "OnPeople Electron Spike",
);
const developmentBinary = path.join(
  repositoryRoot,
  "node_modules",
  ".bin",
  "electron",
);
const usePackaged = await exists(packagedBinary);
const executable = usePackaged ? packagedBinary : developmentBinary;
const args = usePackaged ? [] : [path.join(spikeRoot, "main.mjs")];

const child = execFile(
  executable,
  args,
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ONPEOPLE_SPIKE_METRICS_FILE: metricsPath,
      ONPEOPLE_SPIKE_AUTO_QUIT_MS: "60000",
      ONPEOPLE_SPIKE_STABILITY: "1",
    },
  },
  (error, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (error) process.stderr.write(`${error.message}\n`);
  },
);
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
if (exitCode !== 0) {
  throw new Error(`Electron spike exited with code ${exitCode}`);
}

const metrics = JSON.parse(await readFile(metricsPath, "utf8"));
const archive = path.join(
  repositoryRoot,
  "dist-electron-spike",
  `onpeople-electron-spike-0.30.0-${process.arch}.zip`,
);
const archiveBytes = (await exists(archive))
  ? (await stat(archive)).size
  : null;
const installedBytes = (await exists(appBundle))
  ? await directorySizeBytes(appBundle)
  : null;

const baselines = {
  tauriArchiveBytes: 303 * 1024 * 1024,
  tauriInstalledBytes: 731 * 1024 * 1024,
  tauriBrowserWorkingSetKb: 438.7 * 1024,
};
const gates = {
  archiveNoLargerThanTauri:
    archiveBytes !== null && archiveBytes <= baselines.tauriArchiveBytes,
  installedNoLargerThanTauri:
    installedBytes !== null && installedBytes <= baselines.tauriInstalledBytes,
  rendererReadyUnder1500Ms:
    metrics.rendererReadyMs !== null && metrics.rendererReadyMs <= 1_500,
  memoryWithin20Percent:
    metrics.totalWorkingSetKb <= baselines.tauriBrowserWorkingSetKb * 1.2,
  stability30Cycles:
    metrics.stabilityCycles === 30 &&
    metrics.stabilityFailures === 0 &&
    metrics.windowCrashCount === 0 &&
    metrics.browserViewCrashCount === 0 &&
    metrics.rustHostRestartCount === 0,
};

process.stdout.write(
  `${JSON.stringify(
    {
      ...metrics,
      packaged: usePackaged,
      archiveBytes,
      installedBytes,
      baselines,
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
