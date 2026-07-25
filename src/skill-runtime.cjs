const path = require("node:path");

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function flattenSkillsResponse(result) {
  return (result?.data || []).flatMap((entry) => (entry.skills || []).map((skill) => ({
    ...skill,
    cwd: entry.cwd || null,
  })));
}

function skillFilePath(skill) {
  const candidate = String(skill?.path || "").trim();
  if (!candidate) return null;
  return path.basename(candidate) === "SKILL.md" ? candidate : path.join(candidate, "SKILL.md");
}

function mentionedSkillNames(text) {
  const names = [];
  const seen = new Set();
  const expression = /\$([a-z0-9][a-z0-9-]{0,63})/gi;
  for (const match of String(text || "").matchAll(expression)) {
    const name = match[1].toLowerCase();
    if (!SKILL_NAME_PATTERN.test(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function buildSkillInputItems(text, skills) {
  const byName = new Map();
  for (const skill of skills || []) {
    const name = String(skill?.name || "").trim().toLowerCase();
    const skillPath = skillFilePath(skill);
    if (!SKILL_NAME_PATTERN.test(name) || !skillPath || skill?.enabled === false || byName.has(name)) continue;
    byName.set(name, { type: "skill", name: skill.name, path: skillPath });
  }
  return mentionedSkillNames(text).map((name) => byName.get(name)).filter(Boolean);
}

module.exports = {
  buildSkillInputItems,
  flattenSkillsResponse,
  mentionedSkillNames,
  skillFilePath,
};
