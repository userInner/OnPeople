const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateSkillDirectory } = require("../src/onpeople-skill-validator.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-skill-validator-"));
try {
  const skillDir = path.join(root, "frontend-design");
  fs.mkdirSync(path.join(skillDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: frontend-design",
    "description: Create distinctive interfaces when frontend design work is requested.",
    "---",
    "",
    "# Frontend Design",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(skillDir, "agents", "openai.yaml"), [
    "interface:",
    '  display_name: "Frontend Design"',
    '  short_description: "Design distinctive frontend interfaces"',
    '  default_prompt: "Use $frontend-design for this interface."',
    "",
  ].join("\n"));
  assert.equal(validateSkillDirectory(skillDir).valid, true);
  fs.rmSync(path.join(skillDir, "agents", "openai.yaml"));
  const incomplete = validateSkillDirectory(skillDir);
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.errors.join("\n"), /openai\.yaml/);
  process.stdout.write("OnPeople dependency-free Skill validator checks passed.\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
