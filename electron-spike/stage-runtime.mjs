import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const spikeRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(spikeRoot, "..");
const output = path.join(spikeRoot, "runtime");
const outputBin = path.join(output, "bin");
const sourceRuntime = path.resolve(
  process.env.ONPEOPLE_ELECTRON_RUNTIME_SOURCE ||
    path.join(repositoryRoot, ".embedded-runtime"),
);
const targetPlatform =
  process.env.ONPEOPLE_TARGET_PLATFORM ||
  (process.platform === "win32" ? "win32" : "darwin");
const targetTriple =
  process.env.ONPEOPLE_ELECTRON_TARGET_TRIPLE ||
  (targetPlatform === "win32" ? "x86_64-pc-windows-msvc" : null);
const executableSuffix = targetPlatform === "win32" ? ".exe" : "";
const desktopHost = path.join(
  repositoryRoot,
  "target",
  ...(targetTriple ? [targetTriple] : []),
  "release",
  `onpeople-desktop-host${executableSuffix}`,
);

await rm(output, { recursive: true, force: true });
await cp(sourceRuntime, output, { recursive: true });
await mkdir(outputBin, { recursive: true });
await copyFile(
  desktopHost,
  path.join(outputBin, `onpeople-desktop-host${executableSuffix}`),
);

console.log(
  `Staged Electron runtime for ${targetPlatform}: ${output}`,
);
