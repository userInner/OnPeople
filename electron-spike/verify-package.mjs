import { existsSync, readFileSync } from "node:fs";
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
  path.join(moduleRoot, "browser-page-preload.cjs"),
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

console.log(
  `Electron package module verification passed (${visited.size} local modules).`,
);
