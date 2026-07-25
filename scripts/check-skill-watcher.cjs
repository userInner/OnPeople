const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { watchSkillRoot } = require("../src/skill-watcher.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-skill-watcher-"));
let watcher;

(async () => {
  const changed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Skill watcher did not detect a new Skill")), 5_000);
    watcher = watchSkillRoot(root, (event) => {
      clearTimeout(timer);
      resolve(event);
    }, { debounceMs: 40 });
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const skillDir = path.join(root, "frontend-design");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: frontend-design\ndescription: Test\n---\n");
  const event = await changed;
  assert.equal(event.root, root);

  const nestedChanged = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Skill watcher did not detect a nested edit")), 5_000);
    watcher.close();
    watcher = watchSkillRoot(root, (nestedEvent) => {
      clearTimeout(timer);
      resolve(nestedEvent);
    }, { debounceMs: 40 });
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  fs.appendFileSync(path.join(skillDir, "SKILL.md"), "\n# Updated\n");
  const nestedEvent = await nestedChanged;
  if (process.platform === "win32") {
    assert.equal(nestedEvent.filename, null);
  } else {
    assert.match(String(nestedEvent.filename || ""), /SKILL\.md$/);
  }
  process.stdout.write("OnPeople Skill filesystem watcher checks passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  watcher?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const pollingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-skill-polling-"));
let pollingWatcher;
(async () => {
  const changed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Windows Skill polling did not detect a change")), 5_000);
    pollingWatcher = watchSkillRoot(pollingRoot, (event) => {
      clearTimeout(timer);
      resolve(event);
    }, { debounceMs: 40, platform: "win32", pollMs: 100 });
  });
  await new Promise((resolve) => setTimeout(resolve, 160));
  const skillDir = path.join(pollingRoot, "frontend-design");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: frontend-design\ndescription: Test\n---\n");
  const event = await changed;
  assert.equal(event.root, pollingRoot);
  process.stdout.write("OnPeople Windows Skill polling checks passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  pollingWatcher?.close();
  fs.rmSync(pollingRoot, { recursive: true, force: true });
});
