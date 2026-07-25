const fs = require("node:fs");
const path = require("node:path");

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

function unquote(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && new Set(['"', "'"]).has(text[0]) && text.at(-1) === text[0]) {
    return text.slice(1, -1);
  }
  return text;
}

function parseFrontmatter(content) {
  const match = String(content || "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.md 缺少有效的 YAML frontmatter");
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const field = line.match(/^([a-z][a-z0-9-]*):\s*(.*)$/);
    if (!field) throw new Error(`无法解析 frontmatter：${line}`);
    result[field[1]] = unquote(field[2]);
  }
  return result;
}

function validateSkillDirectory(inputPath) {
  const skillDir = path.resolve(String(inputPath || ""));
  const errors = [];
  const warnings = [];
  const skillFile = path.join(skillDir, "SKILL.md");
  const metadataFile = path.join(skillDir, "agents", "openai.yaml");
  if (!fs.existsSync(skillFile)) {
    errors.push("缺少 SKILL.md");
    return { valid: false, skillDir, errors, warnings };
  }

  let frontmatter;
  try {
    frontmatter = parseFrontmatter(fs.readFileSync(skillFile, "utf8"));
  } catch (error) {
    errors.push(error.message);
    return { valid: false, skillDir, errors, warnings };
  }
  const unexpected = Object.keys(frontmatter).filter((key) => !new Set(["name", "description"]).has(key));
  if (unexpected.length) errors.push(`frontmatter 只能包含 name 和 description：${unexpected.join(", ")}`);
  if (!frontmatter.name) errors.push("frontmatter 缺少 name");
  if (!frontmatter.description) errors.push("frontmatter 缺少 description");
  if (frontmatter.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name)) errors.push("name 必须使用小写 hyphen-case");
  if (frontmatter.name && frontmatter.name.length > MAX_NAME_LENGTH) errors.push(`name 不能超过 ${MAX_NAME_LENGTH} 个字符`);
  if (frontmatter.description && frontmatter.description.length > MAX_DESCRIPTION_LENGTH) errors.push(`description 不能超过 ${MAX_DESCRIPTION_LENGTH} 个字符`);
  if (frontmatter.name && path.basename(skillDir) !== frontmatter.name) errors.push("Skill 目录名必须与 frontmatter name 相同");

  if (!fs.existsSync(metadataFile)) {
    errors.push("缺少 agents/openai.yaml");
  } else {
    const metadata = fs.readFileSync(metadataFile, "utf8");
    for (const field of ["display_name", "short_description", "default_prompt"]) {
      if (!new RegExp(`^\\s{2}${field}:\\s*\\S`, "m").test(metadata)) errors.push(`agents/openai.yaml 缺少 ${field}`);
    }
  }
  const lineCount = fs.readFileSync(skillFile, "utf8").split(/\r?\n/).length;
  if (lineCount > 500) warnings.push(`SKILL.md 有 ${lineCount} 行，建议使用 references/ 做渐进披露`);
  return {
    valid: errors.length === 0,
    skillDir,
    name: frontmatter.name || null,
    errors,
    warnings,
  };
}

if (require.main === module) {
  const result = validateSkillDirectory(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

module.exports = { parseFrontmatter, validateSkillDirectory };
