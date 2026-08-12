import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "..");
const electronRoot = path.join(
  repositoryRoot,
  "node_modules",
  "electron",
  "dist",
);
const sourceApp = path.join(electronRoot, "Electron.app");
const developmentRoot = path.join(repositoryRoot, "dist-electron-dev");
const developmentApp = path.join(developmentRoot, "OnPeople Dev.app");
const sourceVersion = (
  await readFile(
    path.join(repositoryRoot, "node_modules", "electron", "package.json"),
    "utf8",
  )
).match(/"version"\s*:\s*"([^"]+)"/)?.[1];
const markerPath = path.join(developmentRoot, ".electron-version");
const currentVersion = await readFile(markerPath, "utf8").catch(() => "");
const developmentVersion = `${sourceVersion}:onpeople-dev-v2`;

const developmentExecutable = path.join(
  developmentApp,
  "Contents",
  "MacOS",
  "Electron",
);
const executableReady = await access(developmentExecutable)
  .then(() => true)
  .catch(() => false);

const requiresRebuild =
  currentVersion.trim() !== developmentVersion || !executableReady;

if (requiresRebuild) {
  await rm(developmentRoot, { recursive: true, force: true });
  await mkdir(developmentRoot, { recursive: true });
  await cp(sourceApp, developmentApp, {
    recursive: true,
    verbatimSymlinks: true,
  });

  const plistPath = path.join(developmentApp, "Contents", "Info.plist");
  let plist = await readFile(plistPath, "utf8");
  plist = plist
    .replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1OnPeople Dev$2",
    )
    .replace(
      /(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1OnPeople Dev$2",
    )
    .replace(
      /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1com.userinner.onpeople.dev$2",
    )
    .replace(
      /(<key>CFBundleExecutable<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1Electron$2",
    );
  await writeFile(plistPath, plist);
  await writeFile(markerPath, `${developmentVersion}\n`);
}

process.stdout.write(`${developmentExecutable}\n`);
