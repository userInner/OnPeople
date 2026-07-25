const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { AGENT_BEHAVIOR_CONTRACT } = require("../src/agent-instructions.cjs");

assert.match(AGENT_BEHAVIOR_CONTRACT, /application-specific CODEX_HOME/);
assert.match(AGENT_BEHAVIOR_CONTRACT, /OnPeople Skills/);
assert.match(AGENT_BEHAVIOR_CONTRACT, /\$CODEX_HOME\/skills/);
assert.match(AGENT_BEHAVIOR_CONTRACT, /agents\/openai\.yaml/);
assert.match(AGENT_BEHAVIOR_CONTRACT, /OnPeople Skill UI metadata/);
assert.match(AGENT_BEHAVIOR_CONTRACT, /Do not claim installation or validation succeeded/);
assert.match(AGENT_BEHAVIOR_CONTRACT, /dynamically reloads valid Skill changes/);
assert.match(AGENT_BEHAVIOR_CONTRACT, /never tell the user to restart the app or open a new session/);

const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
assert.match(main, /ONPEOPLE_SKILLS_HOME/);
assert.match(main, /ONPEOPLE_SKILL_VALIDATOR/);
assert.match(main, /originLabel: isOnPeopleSkill \? "OnPeople 独立 Skills"/);

const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
assert.match(renderer, /不会写入本机 Codex 的个人 Skills/);
assert.match(renderer, /缺少 Skill UI 元数据/);

process.stdout.write("OnPeople agent identity and Skills isolation checks passed.\n");
