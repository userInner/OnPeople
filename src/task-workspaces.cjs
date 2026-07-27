const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TASK_WORKSPACE_MODES = new Set(["isolated", "local", "worktree"]);
const WORKSPACE_TERM_TRANSLATIONS = new Map([
  ["落地页", "landing-page"],
  ["工作空间", "workspace"],
  ["浏览器", "browser"],
  ["终端", "terminal"],
  ["登录", "login"],
  ["注册", "signup"],
  ["邮件", "email"],
  ["支付", "payment"],
  ["模型", "model"],
  ["图片", "image"],
  ["网站", "website"],
  ["设计", "design"],
  ["优化", "improve"],
  ["修复", "fix"],
  ["测试", "test"],
  ["任务", "task"],
  ["报告", "report"],
]);

function normalizeTaskWorkspaceMode(value, cwd = "") {
  const mode = String(value || "").trim();
  if (TASK_WORKSPACE_MODES.has(mode)) return mode;
  return String(cwd || "").trim() ? "local" : "isolated";
}

function taskWorkspaceSlug(value) {
  let source = String(value || "").normalize("NFKD").toLowerCase();
  const translated = [];
  for (const [term, replacement] of WORKSPACE_TERM_TRANSLATIONS) {
    if (!source.includes(term)) continue;
    translated.push(replacement);
    source = source.replaceAll(term, " ");
  }
  const asciiWords = source
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) || [];
  const normalized = [...translated, ...asciiWords]
    .join("-")
    .replace(/-+/g, "-")
    .slice(0, 42)
    .replace(/-+$/g, "");
  return normalized || "conversation";
}

function assertDirectory(candidate, label = "工作目录") {
  const selected = String(candidate || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error(`${label}无效，请重新选择`);
  const resolved = path.resolve(selected);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${label}不存在或不可读取`);
  }
  return resolved;
}

function isolatedWorkspaceDestination(workspaceRoot, prompt, options = {}) {
  const root = path.resolve(String(workspaceRoot || ""));
  const now = options.now instanceof Date ? options.now : new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const randomId = String(options.randomId || crypto.randomUUID()).replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return path.join(root, date, `${time}-${taskWorkspaceSlug(prompt)}-${randomId || "workspace"}`);
}

async function materializeTaskWorkspace(options = {}) {
  const requestedCwd = String(options.cwd || "").trim();
  const mode = normalizeTaskWorkspaceMode(options.mode, requestedCwd);
  if (mode === "local") {
    const cwd = assertDirectory(requestedCwd, "本地项目目录");
    return { cwd, workspaceMode: mode, workspaceBaseCwd: cwd, created: false };
  }
  if (mode === "worktree") {
    const baseCwd = assertDirectory(requestedCwd, "Worktree 起点目录");
    if (typeof options.createWorktree !== "function") throw new Error("Worktree 创建器不可用");
    const created = await options.createWorktree({
      cwd: baseCwd,
      name: taskWorkspaceSlug(options.prompt),
      ref: options.ref || "HEAD",
      detached: true,
    });
    const cwd = assertDirectory(created?.path, "新建 Worktree");
    return {
      cwd,
      workspaceMode: mode,
      workspaceBaseCwd: baseCwd,
      created: true,
      worktree: { path: cwd, branch: created.branch || "detached", root: created.root || baseCwd },
    };
  }
  const root = path.resolve(String(options.workspaceRoot || ""));
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const destination = isolatedWorkspaceDestination(root, options.prompt, options);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
  return {
    cwd: destination,
    workspaceMode: "isolated",
    workspaceBaseCwd: null,
    created: true,
  };
}

module.exports = {
  TASK_WORKSPACE_MODES,
  assertDirectory,
  isolatedWorkspaceDestination,
  materializeTaskWorkspace,
  normalizeTaskWorkspaceMode,
  taskWorkspaceSlug,
};
