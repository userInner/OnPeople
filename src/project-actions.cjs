const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const COMMON_SCRIPTS = ["dev", "start", "test", "lint", "build", "check", "format"];

function boundedCommand(value) {
  const command = String(value || "").trim();
  if (!command || command.length > 1_000 || command.includes("\0")) return null;
  return command;
}

function actionRecord(value, source) {
  const command = boundedCommand(value.command);
  if (!command) return null;
  const label = String(value.label || value.id || "运行").trim().slice(0, 32) || "运行";
  const id = String(value.id || label).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "action";
  return { id, label, command, source, fingerprint: crypto.createHash("sha256").update(command).digest("hex").slice(0, 12) };
}

function readJson(file, maxBytes = 256_000) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`${path.basename(file)} 无法读取或文件过大`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function discoverProjectActions(cwd, platform = process.platform) {
  const root = path.resolve(String(cwd || ""));
  if (!fs.statSync(root).isDirectory()) throw new Error("工作目录不存在");
  const actions = [];
  let setup = null;
  const configFile = path.join(root, ".onpeople", "actions.json");
  if (fs.existsSync(configFile)) {
    const config = readJson(configFile);
    const setupValue = typeof config.setup === "string" ? config.setup : config.setup?.[platform] || config.setup?.default;
    const setupCommand = boundedCommand(setupValue);
    if (setupCommand) setup = actionRecord({ id: "setup", label: "设置环境", command: setupCommand }, ".onpeople/actions.json");
    for (const value of Array.isArray(config.actions) ? config.actions : []) {
      const action = actionRecord(value, ".onpeople/actions.json");
      if (action) actions.push(action);
    }
  }
  const packageFile = path.join(root, "package.json");
  if (fs.existsSync(packageFile)) {
    const scripts = readJson(packageFile).scripts || {};
    for (const name of COMMON_SCRIPTS) {
      if (!boundedCommand(scripts[name]) || actions.some((item) => item.id === name)) continue;
      actions.push(actionRecord({ id: name, label: name === "dev" ? "开发" : name === "start" ? "启动" : name, command: `npm run ${name}` }, "package.json"));
    }
  }
  return { root, configFile: fs.existsSync(configFile) ? configFile : null, setup, actions: actions.filter(Boolean).slice(0, 12) };
}

module.exports = { actionRecord, boundedCommand, discoverProjectActions };
