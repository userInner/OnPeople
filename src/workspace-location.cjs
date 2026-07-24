const fs = require("node:fs");
const path = require("node:path");

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspaceFile(cwd, candidate) {
  const root = path.resolve(String(cwd || ""));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("工作目录不存在");

  const value = String(candidate || "").trim();
  if (!value || value.includes("\0")) throw new Error("文件路径无效");

  const requested = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  if (!isWithin(root, requested)) throw new Error("只能打开当前工作目录中的文件");

  const candidates = [requested];
  if (!path.isAbsolute(value)) {
    candidates.push(path.resolve(root, ".onpeople", "generated-images", value));
  }

  const rootRealPath = fs.realpathSync(root);
  for (const file of [...new Set(candidates)]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const realFile = fs.realpathSync(file);
    if (!isWithin(rootRealPath, realFile)) throw new Error("文件路径超出当前工作目录");
    return realFile;
  }
  throw new Error(`找不到文件：${value}`);
}

function shouldUseSystemPreview(file) {
  return new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".heic", ".svg",
    ".pdf", ".mp4", ".mov", ".m4v", ".mp3", ".wav", ".m4a",
  ]).has(path.extname(String(file || "")).toLowerCase());
}

module.exports = { isWithin, resolveWorkspaceFile, shouldUseSystemPreview };
