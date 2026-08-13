import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
const execFileAsync = promisify(execFile);

await rm(output, { recursive: true, force: true });
await cp(sourceRuntime, output, { recursive: true });
await mkdir(outputBin, { recursive: true });
await copyFile(
  desktopHost,
  path.join(outputBin, `onpeople-desktop-host${executableSuffix}`),
);

if (targetPlatform === "darwin") {
  await signDarwinRuntime(output);
}

console.log(`Staged Electron runtime for ${targetPlatform}: ${output}`);

async function signDarwinRuntime(runtimeRoot) {
  const identity = await resolveDarwinSigningIdentity();
  const signedBinaries = [
    path.join(runtimeRoot, "bin", "cua-driver"),
    path.join(runtimeRoot, "bin", "onpeople-mcp-host"),
    path.join(runtimeRoot, "bin", "onpeople"),
    path.join(runtimeRoot, "bin", "onpeople-desktop-host"),
  ];
  for (const binary of signedBinaries) {
    await execFileAsync("codesign", [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--sign",
      identity,
      binary,
    ]);
  }

  const manifestPath = path.join(runtimeRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const components = new Map(
    manifest.components.map((component) => [component.name, component]),
  );
  for (const name of ["cua-driver", "mcp-host", "headless"]) {
    const component = components.get(name);
    if (!component?.target) {
      throw new Error(`Electron runtime manifest 缺少 ${name}`);
    }
    component.sha256 = await sha256(path.join(runtimeRoot, component.target));
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function resolveDarwinSigningIdentity() {
  const configured =
    process.env.APPLE_SIGNING_IDENTITY ||
    process.env.ONPEOPLE_CODESIGN_IDENTITY;
  if (configured?.trim()) return configured.trim();

  const { stdout } = await execFileAsync("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const match = stdout.match(
    /\"(Developer ID Application: [^\"]+ \(6K4S66PVRQ\))\"/,
  );
  if (!match) {
    throw new Error(
      "未找到 OnPeople Developer ID；请设置 APPLE_SIGNING_IDENTITY",
    );
  }
  return match[1];
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}
