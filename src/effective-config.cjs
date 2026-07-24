const fs = require("node:fs");
const path = require("node:path");

function boundedRead(file, maximum = 12_000) {
  try { return fs.readFileSync(file, "utf8").slice(0, maximum); } catch { return ""; }
}

function ancestorFiles(cwd, filename) {
  const files = [];
  let cursor = path.resolve(cwd);
  while (true) {
    const candidate = path.join(cursor, filename);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) files.push(candidate);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return files.reverse();
}

function inspectEffectiveConfig({ cwd, provider, policy, thread, model, appHome }) {
  const root = path.resolve(cwd || process.cwd());
  const sources = [];
  for (const file of ancestorFiles(root, "AGENTS.md")) sources.push({ kind: "instructions", label: "AGENTS.md", path: file, preview: boundedRead(file, 2_000) });
  for (const file of ancestorFiles(root, path.join(".codex", "config.toml"))) sources.push({ kind: "config", label: ".codex/config.toml", path: file, preview: boundedRead(file, 2_000) });
  const globalConfig = path.join(appHome, "config.toml");
  if (fs.existsSync(globalConfig)) sources.unshift({ kind: "config", label: "OnPeople 全局配置", path: globalConfig, preview: boundedRead(globalConfig, 2_000) });
  return {
    cwd: root,
    thread: thread || null,
    provider: provider ? { type: provider.type, model: provider.model, baseUrl: provider.baseUrl } : null,
    model: model || provider?.model || null,
    policy: { ...policy },
    sources,
    resolvedAt: new Date().toISOString(),
  };
}

module.exports = { ancestorFiles, inspectEffectiveConfig };
