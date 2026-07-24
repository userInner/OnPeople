const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { githubCompareUrl, githubRepositoryFromRemote, normalizeCommitMessage, parsePorcelainV1Z, parseUnifiedDiff, safeRepoPath } = require("../src/git-workflow.cjs");

const files = parsePorcelainV1Z(" M src/a.js\0A  src/new.js\0?? notes.txt\0R  src/new-name.js\0src/old-name.js\0UU src/conflict.js\0");
assert.deepEqual(files.map((item) => [item.path, item.staged, item.unstaged, item.untracked, item.conflicted]), [
  ["src/a.js", false, true, false, false],
  ["src/new.js", true, false, false, false],
  ["notes.txt", false, true, true, false],
  ["src/new-name.js", true, false, false, false],
  ["src/conflict.js", true, true, false, true],
]);
assert.equal(files[3].originalPath, "src/old-name.js");
assert.equal(safeRepoPath("/tmp/project", "src/a.js"), "src/a.js");
assert.throws(() => safeRepoPath("/tmp/project", "../secret"), /当前 Git 仓库/);
assert.throws(() => safeRepoPath("/tmp/project", "/etc/passwd"), /无效/);
assert.equal(normalizeCommitMessage("  feat: ship it  "), "feat: ship it");
assert.throws(() => normalizeCommitMessage("  "), /提交说明/);
assert.deepEqual(githubRepositoryFromRemote("git@github.com:userInner/OnPeople.git"), { owner: "userInner", repository: "OnPeople" });
assert.equal(githubCompareUrl("https://github.com/userInner/OnPeople.git", "origin/main", "feature/git ui"), "https://github.com/userInner/OnPeople/compare/main...feature%2Fgit%20ui?expand=1");
assert.throws(() => githubCompareUrl("git@example.com:team/repo.git", "main", "feature"), /GitHub/);
const hunks = parseUnifiedDiff("diff --git a/a.txt b/a.txt\nindex 111..222 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@ first\n-old\n+new\n@@ -8,0 +9 @@ second\n+next\n", "unstaged");
assert.equal(hunks.length, 2);
assert.deepEqual(hunks.map((item) => [item.detail, item.additions, item.deletions]), [["first", 1, 1], ["second", 1, 0]]);
assert.ok(hunks[0].patch.includes("diff --git a/a.txt b/a.txt"));
assert.notEqual(hunks[0].id, hunks[1].id);

const repository = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-hunks-"));
const git = (...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" });
try {
  git("init", "-q");
  git("config", "user.name", "OnPeople Test");
  git("config", "user.email", "test@onpeople.local");
  const source = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  fs.writeFileSync(path.join(repository, "sample.txt"), `${source.join("\n")}\n`);
  git("add", "sample.txt");
  git("commit", "-qm", "initial");
  source[0] = "changed first";
  source[10] = "changed last";
  fs.writeFileSync(path.join(repository, "sample.txt"), `${source.join("\n")}\n`);
  const liveHunks = parseUnifiedDiff(git("diff", "--unified=1", "--", "sample.txt"));
  assert.equal(liveHunks.length, 2);
  const applied = spawnSync("git", ["-C", repository, "apply", "--cached", "-"], { input: liveHunks[0].patch, encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(git("diff", "--cached"), /changed first/);
  assert.doesNotMatch(git("diff", "--cached"), /changed last/);
  assert.match(git("diff"), /changed last/);
} finally { fs.rmSync(repository, { recursive: true, force: true }); }

const rendererSource = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "../src/preload.cjs"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
assert.match(rendererSource, /function showGitEmptyState\(error\)/);
assert.match(rendererSource, /这个项目还没有 Git 仓库/);
assert.match(rendererSource, /git-error-detail/);
assert.match(rendererSource, /initGitRepository\(cwd\)/);
assert.match(mainSource, /ipcMain\.handle\("git:init"/);
assert.match(preloadSource, /initGitRepository: \(cwd\) => ipcRenderer\.invoke\("git:init", cwd\)/);
assert.match(htmlSource, /id="git-empty-state"/);
assert.match(htmlSource, /id="git-choose-project"/);
assert.match(htmlSource, /id="git-init-repository"/);
console.log("Git workflow checks passed.");
