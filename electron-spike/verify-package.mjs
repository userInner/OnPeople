import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listPackage } from "@electron/asar";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "..");
const archivePath = path.join(
  repositoryRoot,
  "dist-electron",
  "mac-arm64",
  "OnPeople.app",
  "Contents",
  "Resources",
  "app.asar",
);
const sourceEntries = [
  path.join(moduleRoot, "main.mjs"),
  path.join(moduleRoot, "preload.cjs"),
];

if (!existsSync(archivePath)) {
  throw new Error(`Electron package archive does not exist: ${archivePath}`);
}

const packagedFiles = new Set(
  listPackage(archivePath).map((entry) => entry.replace(/^\//, "")),
);
const visited = new Set();
const missing = [];

function resolveLocalModule(importer, specifier) {
  const candidate = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.mjs`, `${candidate}.cjs`, `${candidate}.js`];
  return candidates.find((entry) => existsSync(entry));
}

function verifyModule(sourcePath) {
  if (visited.has(sourcePath)) return;
  visited.add(sourcePath);

  const archiveEntry = path.relative(repositoryRoot, sourcePath);
  if (!packagedFiles.has(archiveEntry)) {
    missing.push(archiveEntry);
  }

  const source = readFileSync(sourcePath, "utf8");
  const relativeImports = [
    ...source.matchAll(
      /(?:from\s+|import\s*\(|require\s*\()\s*["'](\.[^"']+)["']/g,
    ),
  ];
  for (const match of relativeImports) {
    const dependency = resolveLocalModule(sourcePath, match[1]);
    if (!dependency) {
      throw new Error(
        `Cannot resolve local Electron dependency ${match[1]} from ${sourcePath}`,
      );
    }
    verifyModule(dependency);
  }
}

for (const sourceEntry of sourceEntries) verifyModule(sourceEntry);

if (missing.length > 0) {
  throw new Error(
    `Electron package is missing local runtime modules:\n${missing
      .sort()
      .map((entry) => `- ${entry}`)
      .join("\n")}`,
  );
}

await verifyPackagedRuntime();

console.log(
  `Electron package module verification passed (${visited.size} local modules).`,
);

async function verifyPackagedRuntime() {
  const runtimeRoot = path.join(path.dirname(archivePath), ".embedded-runtime");
  const manifest = JSON.parse(
    readFileSync(path.join(runtimeRoot, "manifest.json"), "utf8"),
  );
  for (const component of manifest.components ?? []) {
    if (!component.target || !component.sha256) continue;
    const target = path.join(runtimeRoot, component.target);
    const actual = await sha256(target);
    if (actual !== component.sha256) {
      throw new Error(
        `Packaged runtime hash mismatch for ${component.name}: ${component.target}`,
      );
    }
  }

  if (process.platform !== "darwin") return;
  for (const executable of [
    "cua-driver",
    "onpeople-mcp-host",
    "onpeople",
    "onpeople-desktop-host",
  ]) {
    const target = path.join(runtimeRoot, "bin", executable);
    execFileSync("codesign", ["--verify", "--strict", target]);
    const inspection = spawnSync("codesign", ["-dv", target], {
      encoding: "utf8",
    });
    if (inspection.status !== 0) {
      throw new Error(
        `Unable to inspect packaged runtime signature: ${executable}`,
      );
    }
    const details = `${inspection.stdout}${inspection.stderr}`;
    if (!details.includes("TeamIdentifier=6K4S66PVRQ")) {
      throw new Error(
        `Packaged runtime is not signed by the OnPeople team: ${executable}`,
      );
    }
  }
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
