const path = require("node:path");
const crypto = require("node:crypto");

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function parsePorcelainV1Z(raw) {
  const records = String(raw || "").split("\0");
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const code = record.slice(0, 2);
    const filePath = record.slice(3);
    if (!filePath) continue;
    let originalPath = null;
    if (code.includes("R") || code.includes("C")) originalPath = records[++index] || null;
    const indexStatus = code[0];
    const worktreeStatus = code[1];
    files.push({
      path: filePath,
      originalPath,
      code,
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== " " && indexStatus !== "?",
      unstaged: worktreeStatus !== " ",
      untracked: code === "??",
      conflicted: CONFLICT_CODES.has(code),
    });
  }
  return files;
}

function safeRepoPath(root, filePath) {
  const value = String(filePath || "");
  if (!value || value.includes("\0") || path.isAbsolute(value)) throw new Error("无效的 Git 文件路径");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, value);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("只能操作当前 Git 仓库中的文件");
  return relative.split(path.sep).join("/");
}

function normalizeCommitMessage(message) {
  const value = String(message || "").replace(/\r\n/g, "\n").trim();
  if (!value) throw new Error("请输入提交说明");
  if (value.length > 500) throw new Error("提交说明不能超过 500 个字符");
  return value;
}

function githubRepositoryFromRemote(remoteUrl) {
  const value = String(remoteUrl || "").trim().replace(/\.git$/, "");
  const match = value.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i);
  return match ? { owner: match[1], repository: match[2] } : null;
}

function githubCompareUrl(remoteUrl, base, branch) {
  const repository = githubRepositoryFromRemote(remoteUrl);
  if (!repository) throw new Error("当前远程地址不是可识别的 GitHub 仓库");
  const baseName = String(base || "main").replace(/^origin\//, "");
  if (!baseName || !branch) throw new Error("缺少 PR 的基础分支或当前分支");
  return `https://github.com/${repository.owner}/${repository.repository}/compare/${encodeURIComponent(baseName)}...${encodeURIComponent(branch)}?expand=1`;
}

function parseUnifiedDiff(diff, area = "unstaged") {
  const lines = String(diff || "").split("\n");
  const header = [];
  const hunks = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const patch = [...header, ...current, ""].join("\n");
    const title = current[0];
    hunks.push({
      id: crypto.createHash("sha256").update(`${area}\0${patch}`).digest("hex").slice(0, 20),
      area,
      title,
      detail: title.replace(/^@@[^@]*@@\s*/, "") || "代码块",
      additions: current.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
      deletions: current.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
      lines: current,
      patch,
    });
    current = null;
  };
  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      current = [line];
    } else if (current) current.push(line);
    else if (line || header.length) header.push(line);
  }
  flush();
  return hunks;
}

module.exports = { githubCompareUrl, githubRepositoryFromRemote, normalizeCommitMessage, parsePorcelainV1Z, parseUnifiedDiff, safeRepoPath };
