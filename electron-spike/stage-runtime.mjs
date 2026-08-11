import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const spikeRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(spikeRoot, "..");
const output = path.join(spikeRoot, "runtime");
const outputBin = path.join(output, "bin");
const sourceRuntime = path.join(repositoryRoot, ".embedded-runtime");

await rm(output, { recursive: true, force: true });
await mkdir(outputBin, { recursive: true });

const runtimeBinaries = [
  "codex",
  "cua-driver",
  "onpeople",
  "onpeople-mcp-host",
];
for (const name of runtimeBinaries) {
  await copyFile(
    path.join(sourceRuntime, "bin", name),
    path.join(outputBin, name),
  );
}
await copyFile(
  path.join(repositoryRoot, "target", "release", "onpeople-desktop-host"),
  path.join(outputBin, "onpeople-desktop-host"),
);

for (const name of ["plugins", "manifest.json"]) {
  const source = path.join(sourceRuntime, name);
  const target = path.join(output, name);
  if (name === "plugins") {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      await copyDirectory(
        path.join(source, entry.name),
        path.join(target, entry.name),
      );
    }
  } else {
    await copyFile(source, target);
  }
}

async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}
