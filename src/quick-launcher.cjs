const fs = require("node:fs");
const path = require("node:path");
const { resolveWorkspaceInput } = require("./workspace-boundary.cjs");

const PREVIEW_EXTENSIONS = new Set([".md", ".txt", ".json", ".html", ".css", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".toml", ".yaml", ".yml"]);
const PRIORITY_FILES = ["README.md", "AGENTS.md", "package.json", "index.html", "THIRD_PARTY_NOTICES.md"];

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspaceFile(cwd, filePath) {
  const root = path.resolve(String(cwd || ""));
  const candidate = resolveWorkspaceInput(root, filePath);
  const stat = fs.statSync(candidate);
  if (!stat.isFile()) throw new Error("所选项目不是文件");
  if (stat.size > 1_000_000) throw new Error("文件超过 1 MB，无法在快速预览中打开");
  return { root, candidate, stat };
}

function urlCandidates(text) {
  const matches = String(text || "").match(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?/gi) || [];
  return matches.map((value) => {
    const clean = value.replace(/[),.;!?]+$/, "");
    const url = /^https?:\/\//i.test(clean) ? clean : `http://${clean}`;
    return { label: url.replace(/^https?:\/\//i, "").replace(/\/$/, ""), url };
  });
}

function collectWorkspaceSuggestions(cwd, currentUrl = "") {
  const root = path.resolve(String(cwd || ""));
  if (!fs.statSync(root).isDirectory()) throw new Error("工作目录不存在");
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && PREVIEW_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  entries.sort((a, b) => {
    const left = PRIORITY_FILES.indexOf(a.name);
    const right = PRIORITY_FILES.indexOf(b.name);
    if (left !== -1 || right !== -1) return (left === -1 ? 999 : left) - (right === -1 ? 999 : right);
    return a.name.localeCompare(b.name);
  });
  const files = entries.slice(0, 6).map((entry) => ({ kind: "file", label: entry.name, path: entry.name }));
  const urls = [];
  const seen = new Set();
  const addUrl = (item) => {
    if (!item?.url || seen.has(item.url) || urls.length >= 5) return;
    seen.add(item.url);
    urls.push({ kind: "url", ...item });
  };
  if (/^https?:\/\//i.test(currentUrl) && !/^https?:\/\/(?:www\.)?(?:google\.|bing\.)/i.test(currentUrl)) {
    try { const parsed = new URL(currentUrl); addUrl({ label: `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`, url: currentUrl }); } catch {}
  }
  for (const entry of entries.slice(0, 12)) {
    if (urls.length >= 5) break;
    const file = path.join(root, entry.name);
    const stat = fs.statSync(file);
    if (stat.size > 256_000) continue;
    for (const item of urlCandidates(fs.readFileSync(file, "utf8"))) addUrl(item);
  }
  return { root, files, urls };
}

module.exports = { collectWorkspaceSuggestions, insideRoot, resolveWorkspaceFile, urlCandidates };
