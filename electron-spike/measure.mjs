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
  path.join(os.tmpdir(), "onpeople-electron-webcontentsview-metrics-"),
);
const metricsPath = path.join(temporaryRoot, "metrics.json");
const appBundle = path.join(
  repositoryRoot,
  "dist-electron",
  `mac-${process.arch === "arm64" ? "arm64" : "x64"}`,
  "OnPeople.app",
);
const packagedBinary = path.join(
  appBundle,
  "Contents",
  "MacOS",
  "OnPeople",
);
const developmentBinary = path.join(repositoryRoot, "node_modules", ".bin", "electron");
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
      ONPEOPLE_ELECTRON_AUTO_QUIT_MS: "240000",
      ONPEOPLE_ELECTRON_ACCEPTANCE: "1",
      ONPEOPLE_BROWSER_IDLE_DESTROY_MS: "750",
    },
  },
  (error, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (error) process.stderr.write(`${error.message}\n`);
  },
);
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
if (exitCode !== 0) throw new Error(`Electron candidate exited with code ${exitCode}`);

const metrics = JSON.parse(await readFile(metricsPath, "utf8"));
const archive = path.join(
  repositoryRoot,
  "dist-electron",
  `onpeople-0.30.0-${process.arch}.zip`,
);
const archiveBytes = (await exists(archive)) ? (await stat(archive)).size : null;
const installedBytes = (await exists(appBundle))
  ? await directorySizeBytes(appBundle)
  : null;
const idleKb = metrics.memorySnapshots.idle?.totalWorkingSetKb ?? null;
const openKb = metrics.memorySnapshots.browserOpen?.totalWorkingSetKb ?? null;
const suspendedKb =
  metrics.memorySnapshots.browserSuspended?.totalWorkingSetKb ?? null;
const destroyedKb =
  metrics.memorySnapshots.browserDestroyed?.totalWorkingSetKb ?? null;
const browserIncrementKb =
  idleKb !== null && openKb !== null ? Math.max(0, openKb - idleKb) : null;
const recoveredIncrementRatio =
  browserIncrementKb && destroyedKb !== null
    ? Math.max(0, Math.min(1, (openKb - destroyedKb) / browserIncrementKb))
    : null;

const baselines = {
  tauriArchiveBytes: 303 * 1024 * 1024,
  tauriInstalledBytes: 731 * 1024 * 1024,
  tauriBrowserWorkingSetKb: 438.7 * 1024,
  previousElectronBrowserWorkingSetKb: 604.7 * 1024,
};
const gates = {
  archiveNoLargerThanTauri:
    archiveBytes !== null && archiveBytes <= baselines.tauriArchiveBytes,
  installedNoLargerThanTauri:
    installedBytes !== null && installedBytes <= baselines.tauriInstalledBytes,
  rendererReadyUnder1500Ms:
    metrics.rendererReadyMs !== null && metrics.rendererReadyMs <= 1_500,
  idleMemoryWithin20PercentOfTauriBrowser:
    idleKb !== null && idleKb <= baselines.tauriBrowserWorkingSetKb * 1.2,
  openBrowserNoWorseThanPreviousElectron:
    openKb !== null && openKb <= baselines.previousElectronBrowserWorkingSetKb,
  destroysAtLeast60PercentOfBrowserIncrement:
    recoveredIncrementRatio !== null && recoveredIncrementRatio >= 0.6,
  lifecycle30Cycles:
    metrics.acceptance.lifecycleCycles === 30 &&
    metrics.acceptance.lifecycleFailures === 0,
  desktopApi154Methods:
    metrics.acceptance.desktopMethodCount === 154 &&
    metrics.acceptance.uniqueDesktopMethodCount === 154,
  loginDownloadUploadPopup:
    metrics.acceptance.loginPersistence === true &&
    metrics.acceptance.download === true &&
    metrics.acceptance.upload === true &&
    metrics.acceptance.popup === true,
  crashRecovery:
    metrics.acceptance.crashRecovery === true &&
    metrics.acceptance.unrecoveredCrashes === 0 &&
    metrics.windowCrashCount === 0,
  rustHostStable: metrics.rustHostRestartCount === 0,
};

process.stdout.write(
  `${JSON.stringify(
    {
      ...metrics,
      packaged: usePackaged,
      archiveBytes,
      installedBytes,
      memorySummary: {
        idleKb,
        openKb,
        suspendedKb,
        destroyedKb,
        browserIncrementKb,
        recoveredIncrementRatio,
      },
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
