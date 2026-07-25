const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildSkillInputItems,
  flattenSkillsResponse,
  mentionedSkillNames,
  skillFilePath,
} = require("../src/skill-runtime.cjs");

const response = {
  data: [{
    cwd: "/workspace",
    skills: [
      { name: "frontend-design", description: "Design UI", enabled: true, path: "/skills/frontend-design/SKILL.md" },
      { name: "disabled-skill", enabled: false, path: "/skills/disabled-skill" },
    ],
  }],
};
const skills = flattenSkillsResponse(response);
assert.equal(skills.length, 2);
assert.equal(skills[0].cwd, "/workspace");
assert.deepEqual(mentionedSkillNames("Use $frontend-design, then $frontend-design again."), ["frontend-design"]);
assert.equal(skillFilePath(skills[1]), path.join("/skills/disabled-skill", "SKILL.md"));
assert.deepEqual(buildSkillInputItems("使用 $frontend-design 重做界面；不要使用 $disabled-skill。", skills), [{
  type: "skill",
  name: "frontend-design",
  path: "/skills/frontend-design/SKILL.md",
}]);

const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
assert.match(main, /message\.method === "skills\/changed"/);
assert.match(main, /watchSkillRoot\(onPeopleSkillsHome/);
assert.match(main, /skills\/list", \{ cwds: \[workdir\], forceReload: true \}/);
assert.match(main, /buildSkillInputItems\(prompt, await refreshSkillCatalog\(cwd\)\)/);
assert.match(main, /type: "text", text: turnText, text_elements: \[\] \},\s*\.\.\.skillInputs/);
assert.match(renderer, /event\.type === "skills-changed"/);
assert.match(renderer, /实时监控/);

process.stdout.write("Skill dynamic refresh checks passed.\n");
