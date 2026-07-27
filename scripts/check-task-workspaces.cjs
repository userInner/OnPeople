const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isolatedWorkspaceDestination,
  materializeTaskWorkspace,
  normalizeTaskWorkspaceMode,
  taskWorkspaceSlug,
} = require("../src/task-workspaces.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-task-workspaces-"));

async function run() {
  const local = path.join(root, "local");
  const isolatedRoot = path.join(root, "isolated");
  fs.mkdirSync(local, { recursive: true });
  fs.mkdirSync(isolatedRoot, { recursive: true });

  assert.equal(normalizeTaskWorkspaceMode("", ""), "isolated");
  assert.equal(normalizeTaskWorkspaceMode("", local), "local");
  assert.equal(normalizeTaskWorkspaceMode("worktree", local), "worktree");
  assert.equal(taskWorkspaceSlug("  制作 中文 PDF / 报告  "), "report-pdf");
  assert.equal(taskWorkspaceSlug("你好"), "conversation");
  assert.equal(taskWorkspaceSlug("优化登录页面"), "login-improve");
  assert.equal(
    isolatedWorkspaceDestination(isolatedRoot, "Build UI", {
      now: new Date(2026, 6, 27, 15, 49, 22),
      randomId: "ABCDEF12-3456",
    }),
    path.join(isolatedRoot, "2026-07-27", "154922-build-ui-abcdef12"),
  );

  const localResult = await materializeTaskWorkspace({ mode: "local", cwd: local });
  assert.deepEqual(localResult, {
    cwd: local,
    workspaceMode: "local",
    workspaceBaseCwd: local,
    created: false,
  });

  const isolated = await materializeTaskWorkspace({
    mode: "isolated",
    workspaceRoot: isolatedRoot,
    prompt: "新任务",
    now: new Date(2026, 6, 27, 15, 49, 22),
    randomId: "11223344",
  });
  assert.equal(isolated.workspaceMode, "isolated");
  assert.equal(isolated.cwd, path.join(isolatedRoot, "2026-07-27", "154922-task-11223344"));
  assert.equal(fs.statSync(isolated.cwd).isDirectory(), true);

  let worktreeRequest = null;
  const worktreePath = path.join(root, "worktree");
  const worktree = await materializeTaskWorkspace({
    mode: "worktree",
    cwd: local,
    prompt: "Review release",
    createWorktree: async (request) => {
      worktreeRequest = request;
      fs.mkdirSync(worktreePath);
      return { root: local, path: worktreePath, branch: "detached" };
    },
  });
  assert.equal(worktreeRequest.detached, true);
  assert.equal(worktreeRequest.ref, "HEAD");
  assert.equal(worktree.workspaceMode, "worktree");
  assert.equal(worktree.workspaceBaseCwd, local);
  assert.equal(worktree.cwd, worktreePath);

  await assert.rejects(
    materializeTaskWorkspace({ mode: "local", cwd: path.join(root, "missing") }),
    /不存在或不可读取/,
  );
  console.log("task workspace checks passed");
}

run().finally(() => fs.rmSync(root, { recursive: true, force: true }));
