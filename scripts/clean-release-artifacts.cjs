const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release");

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function entrySize(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return stat.size;
  return fs.readdirSync(target).reduce((total, name) => total + entrySize(path.join(target, name)), 0);
}

function versionFromName(name) {
  const match = name.match(/OnPeople-(?:Setup-|Store-)?(\d+\.\d+\.\d+)/i);
  return match?.[1] || null;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] || 0) - (a[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function walk(root) {
  if (!fs.existsSync(root)) return [];
  const entries = [];
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, dirent.name);
    entries.push(target);
    if (dirent.isDirectory() && !dirent.isSymbolicLink()) entries.push(...walk(target));
  }
  return entries;
}

function addCandidate(candidates, target, reason) {
  const resolved = path.resolve(target);
  const existingParent = candidates.find((candidate) => resolved.startsWith(`${candidate.target}${path.sep}`));
  if (existingParent || !fs.existsSync(resolved)) return;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index].target.startsWith(`${resolved}${path.sep}`)) candidates.splice(index, 1);
  }
  candidates.push({ target: resolved, reason, size: entrySize(resolved) });
}

function planCleanup(root = projectRoot, options = {}) {
  const keep = Number.isInteger(options.keep) ? options.keep : 2;
  if (keep < 1) throw new Error("--keep must be at least 1");

  const rootRelease = path.join(root, "release");
  const candidates = [];
  const releaseEntries = walk(rootRelease);
  const versions = [...new Set(releaseEntries.map((target) => versionFromName(path.basename(target))).filter(Boolean))]
    .sort(compareVersions);
  const retainedVersions = new Set(versions.slice(0, keep));

  for (const target of releaseEntries) {
    const relative = path.relative(rootRelease, target);
    const basename = path.basename(target);
    const version = versionFromName(basename);
    const isTransientDirectory = /(^|[/\\])(win-unpacked(?: \d+)?|local-icon-preview)$/.test(relative);
    const isBuildMetadata = /^(builder-(?:debug|effective-config)\.(?:yml|yaml)|\.DS_Store)$/.test(basename);
    const isIntermediateArtifact = /signed-unnotarized/i.test(basename) || / \d+\.[^.]+$/.test(basename);

    if (isTransientDirectory) addCandidate(candidates, target, "temporary unpacked/preview directory");
    else if (isBuildMetadata) addCandidate(candidates, target, "temporary builder metadata");
    else if (isIntermediateArtifact) addCandidate(candidates, target, "intermediate or duplicate artifact");
    else if (version && !retainedVersions.has(version)) addCandidate(candidates, target, `release older than the newest ${keep} versions`);
  }

  if (options.includeRuntime) addCandidate(candidates, path.join(root, ".embedded-runtime"), "rebuildable embedded runtime");
  if (options.includeDependencies) addCandidate(candidates, path.join(root, "node_modules"), "reinstallable dependencies");

  return { candidates: candidates.sort((a, b) => a.target.localeCompare(b.target)), retainedVersions: [...retainedVersions] };
}

function assertSafeTarget(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  const allowedRoots = ["release", ".embedded-runtime", "node_modules"].map((name) => path.join(resolvedRoot, name));
  if (!allowedRoots.some((allowed) => resolved === allowed || resolved.startsWith(`${allowed}${path.sep}`))) {
    throw new Error(`Refusing to remove a path outside cleanup roots: ${resolved}`);
  }
}

function parseArgs(args) {
  const options = { apply: false, includeRuntime: false, includeDependencies: false, keep: 2 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--include-runtime") options.includeRuntime = true;
    else if (arg === "--include-dependencies") options.includeDependencies = true;
    else if (arg === "--keep") options.keep = Number.parseInt(args[++index], 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) throw new Error("--keep must be an integer of at least 1");
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = planCleanup(projectRoot, options);
  const total = plan.candidates.reduce((sum, candidate) => sum + candidate.size, 0);

  console.log(`Release cleanup ${options.apply ? "execution" : "preview"}`);
  console.log(`Keeping newest release versions: ${plan.retainedVersions.join(", ") || "none found"}`);
  for (const candidate of plan.candidates) {
    console.log(`- ${path.relative(projectRoot, candidate.target)} (${formatBytes(candidate.size)}): ${candidate.reason}`);
  }
  console.log(`${plan.candidates.length} target(s), approximately ${formatBytes(total)} reclaimable.`);

  if (!options.apply) {
    console.log("Nothing was removed. Re-run with --apply after reviewing this list.");
    return;
  }
  for (const candidate of plan.candidates) {
    assertSafeTarget(projectRoot, candidate.target);
    fs.rmSync(candidate.target, { recursive: true, force: true });
  }
  console.log("Cleanup complete.");
}

if (require.main === module) main();

module.exports = { assertSafeTarget, compareVersions, formatBytes, parseArgs, planCleanup, versionFromName };
