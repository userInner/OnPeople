const fs = require("node:fs");
const path = require("node:path");

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function workspacePaths(root, candidate) {
  const rootPath = path.resolve(String(root || ""));
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new Error("工作目录不存在");
  }
  const rootRealPath = fs.realpathSync(rootPath);
  const value = String(candidate || "").trim();
  if (!value || value.includes("\0")) throw new Error("文件路径无效");
  const lexicalPath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootPath, value);
  if (!isWithin(rootPath, lexicalPath)) throw new Error("文件路径超出当前工作目录");
  return {
    rootPath,
    rootRealPath,
    candidatePath: path.resolve(rootRealPath, path.relative(rootPath, lexicalPath)),
  };
}

function resolveWorkspaceInput(root, candidate) {
  const { rootRealPath, candidatePath } = workspacePaths(root, candidate);
  if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
    throw new Error("输入文件不存在");
  }
  const realPath = fs.realpathSync(candidatePath);
  if (!isWithin(rootRealPath, realPath)) throw new Error("文件路径超出当前工作目录");
  return realPath;
}

function rejectSymlinkSegments(rootRealPath, candidatePath) {
  const relative = path.relative(rootRealPath, candidatePath);
  if (!isWithin(rootRealPath, candidatePath)) throw new Error("文件路径超出当前工作目录");
  let current = rootRealPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("输出路径不能包含符号链接");
  }
}

function resolveWorkspaceOutput(root, candidate, { createParent = true } = {}) {
  const { rootRealPath, candidatePath } = workspacePaths(root, candidate);
  rejectSymlinkSegments(rootRealPath, candidatePath);
  if (createParent) {
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true, mode: 0o700 });
    rejectSymlinkSegments(rootRealPath, path.dirname(candidatePath));
  }
  if (fs.existsSync(candidatePath) && fs.lstatSync(candidatePath).isSymbolicLink()) {
    throw new Error("输出文件不能是符号链接");
  }
  return candidatePath;
}

module.exports = {
  isWithin,
  resolveWorkspaceInput,
  resolveWorkspaceOutput,
  workspacePaths,
};
