const fs = require("node:fs");
const path = require("node:path");

const IGNORED = new Set([".git", "node_modules", "dist", ".embedded-runtime", ".DS_Store"]);

function securePath(root, relative = "") {
  const base = path.resolve(String(root || ""));
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error("工作目录不存在");
  const target = path.resolve(base, String(relative || ""));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("路径必须位于当前工作区内");
  return { base, target };
}

function listProjectDirectory(root, relative = "") {
  const { base, target } = securePath(root, relative);
  if (!fs.statSync(target).isDirectory()) throw new Error("目标不是目录");
  const entries = fs.readdirSync(target, { withFileTypes: true }).filter((entry) => !IGNORED.has(entry.name)).slice(0, 500).map((entry) => {
    const absolute = path.join(target, entry.name);
    const itemPath = path.relative(base, absolute);
    let size = 0;
    try { if (entry.isFile()) size = fs.statSync(absolute).size; } catch {}
    return { name: entry.name, path: itemPath, kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other", size };
  }).filter((entry) => entry.kind !== "other").sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  return { root: base, path: path.relative(base, target), parent: target === base ? null : path.relative(base, path.dirname(target)), entries };
}

function searchProjectFiles(root, query) {
  const { base } = securePath(root);
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return { root: base, query: needle, entries: [] };
  const results = []; const queue = [base]; let scanned = 0;
  while (queue.length && results.length < 100 && scanned < 5_000) {
    const directory = queue.shift();
    let entries = []; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name); const relative = path.relative(base, absolute); scanned += 1;
      if (entry.isDirectory()) queue.push(absolute);
      else if (entry.isFile() && relative.toLowerCase().includes(needle)) {
        let size = 0; try { size = fs.statSync(absolute).size; } catch {}
        results.push({ name: entry.name, path: relative, kind: "file", size });
        if (results.length >= 100) break;
      }
      if (scanned >= 5_000) break;
    }
  }
  return { root: base, query: needle, entries: results, scanned, truncated: queue.length > 0 };
}

module.exports = { listProjectDirectory, searchProjectFiles, securePath };
