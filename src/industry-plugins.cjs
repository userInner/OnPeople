const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteFile, readJsonWithBackup } = require("./atomic-file.cjs");

const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_INSTRUCTIONS_BYTES = 64 * 1024;
const MAX_LIST_ITEMS = 40;
const INDUSTRY_FIELDS = new Set([
  "$schema", "schemaVersion", "type", "id", "displayName", "industry", "description",
  "compatibleOnPeople", "instructions", "languages", "capabilities", "workflows", "templates", "policies", "evals",
]);

function cleanText(value, maximum = 1_000) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, maximum);
}

function resolvePluginFile(pluginRoot, candidate, label) {
  const relative = cleanText(candidate, 500);
  if (!relative || path.isAbsolute(relative)) throw new Error(`${label} 必须是插件内的相对路径`);
  const root = fs.realpathSync(pluginRoot);
  const target = fs.realpathSync(path.resolve(pluginRoot, relative));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`${label} 超出插件目录`);
  if (!fs.statSync(target).isFile()) throw new Error(`${label} 必须指向文件`);
  return target;
}

function validateStringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return [...new Set(value.slice(0, MAX_LIST_ITEMS).map((item) => cleanText(item, 160)).filter(Boolean))];
}

function validateWorkflows(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("workflows 必须是数组");
  const ids = new Set();
  return value.slice(0, 20).map((workflow) => {
    const id = cleanText(workflow?.id, 64);
    const name = cleanText(workflow?.name, 80);
    const prompt = cleanText(workflow?.prompt, 2_000);
    if (!PLUGIN_ID.test(id) || ids.has(id)) throw new Error("workflow id 必须是唯一的 hyphen-case");
    if (!name || !prompt) throw new Error(`workflow ${id} 缺少 name 或 prompt`);
    ids.add(id);
    return { id, name, prompt, description: cleanText(workflow.description, 240) };
  });
}

function validateResources(value, label, pluginRoot) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const ids = new Set();
  return value.slice(0, 40).map((resource) => {
    const id = cleanText(resource?.id, 64);
    const name = cleanText(resource?.name, 80);
    const relativePath = cleanText(resource?.path, 500);
    if (!PLUGIN_ID.test(id) || ids.has(id)) throw new Error(`${label} id 必须是唯一的 hyphen-case`);
    if (!name) throw new Error(`${label} ${id} 缺少 name`);
    resolvePluginFile(pluginRoot, relativePath, `${label} ${id}`);
    ids.add(id);
    return { id, name, path: relativePath, description: cleanText(resource.description, 240) };
  });
}

function readIndustryPlugin(pluginRoot, pluginManifest = {}) {
  const root = fs.realpathSync(path.resolve(pluginRoot));
  const manifestPath = path.join(root, ".onpeople", "industry.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const unexpected = Object.keys(manifest).filter((key) => !INDUSTRY_FIELDS.has(key));
  if (unexpected.length) throw new Error(`不支持的行业插件字段：${unexpected.join(", ")}`);
  const id = cleanText(manifest.id, 64);
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion 必须为 1");
  if (manifest.type !== "industry") throw new Error("type 必须为 industry");
  if (!PLUGIN_ID.test(id)) throw new Error("id 必须使用小写 hyphen-case");
  if (pluginManifest.name && pluginManifest.name !== id) throw new Error("行业插件 id 必须与 plugin name 一致");
  const instructionsPath = resolvePluginFile(root, manifest.instructions, "instructions");
  const instructions = fs.readFileSync(instructionsPath, "utf8");
  if (!instructions.trim()) throw new Error("行业插件 instructions 不能为空");
  if (Buffer.byteLength(instructions) > MAX_INSTRUCTIONS_BYTES) throw new Error("行业插件 instructions 不能超过 64 KiB");
  return {
    schemaVersion: 1,
    type: "industry",
    id,
    version: cleanText(pluginManifest.version || manifest.version, 64) || "0.0.0",
    displayName: cleanText(manifest.displayName, 80) || id,
    industry: cleanText(manifest.industry, 80),
    description: cleanText(manifest.description, 500),
    compatibility: cleanText(manifest.compatibleOnPeople, 80),
    capabilities: validateStringList(manifest.capabilities, "capabilities"),
    languages: validateStringList(manifest.languages, "languages"),
    workflows: validateWorkflows(manifest.workflows),
    templates: validateResources(manifest.templates, "templates", root),
    policies: validateResources(manifest.policies, "policies", root),
    evals: validateResources(manifest.evals, "evals", root),
    instructions: instructions.trim(),
    pluginRoot: root,
    manifestPath,
  };
}

function semverParts(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function isCompatibleVersion(currentVersion, requirement) {
  const wanted = cleanText(requirement, 80);
  if (!wanted) return true;
  const operator = wanted.startsWith(">=") ? ">=" : "=";
  const target = semverParts(operator === ">=" ? wanted.slice(2) : wanted);
  const current = semverParts(currentVersion);
  if (!target || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] === target[index]) continue;
    return operator === ">=" && current[index] > target[index];
  }
  return true;
}

function pluginRootFromSummary(plugin) {
  const localSource = plugin?.source?.type === "local" || plugin?.source?.source === "local";
  const candidate = localSource ? plugin.source.path : plugin?.pluginRoot;
  if (!candidate || !path.isAbsolute(candidate) || !fs.existsSync(candidate)) return null;
  return candidate;
}

function publicProfile(profile, active = false) {
  if (!profile) return null;
  const { instructions, pluginRoot, manifestPath, ...visible } = profile;
  return { ...visible, active: Boolean(active) };
}

class IndustryPluginStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.appVersion = cleanText(options.appVersion, 64);
  }

  state() {
    const value = readJsonWithBackup(this.filePath, { version: 1, active: null });
    return { version: 1, active: value?.active && typeof value.active === "object" ? value.active : null };
  }

  write(active) {
    atomicWriteFile(this.filePath, `${JSON.stringify({ version: 1, active }, null, 2)}\n`, { mode: 0o600 });
    return this.active();
  }

  active() {
    const active = this.state().active;
    if (!active || !PLUGIN_ID.test(String(active.id || "")) || !String(active.instructions || "").trim()) return null;
    return { ...active };
  }

  activate(profile, plugin = {}) {
    if (!profile) throw new Error("这个插件没有 OnPeople 行业声明");
    if (!plugin.installed) throw new Error("请先安装行业插件");
    if (plugin.enabled === false) throw new Error("插件已被策略停用，无法激活");
    if (profile.compatibility && !isCompatibleVersion(this.appVersion, profile.compatibility)) {
      throw new Error(`这个插件需要 OnPeople ${profile.compatibility}`);
    }
    const snapshot = {
      id: profile.id,
      pluginId: cleanText(plugin.id, 200) || profile.id,
      version: profile.version,
      displayName: profile.displayName,
      industry: profile.industry,
      description: profile.description,
      capabilities: profile.capabilities,
      languages: profile.languages,
      workflows: profile.workflows,
      instructions: profile.instructions,
      activatedAt: new Date().toISOString(),
    };
    this.write(snapshot);
    return { ...publicProfile(snapshot, true), pluginId: snapshot.pluginId };
  }

  deactivate(pluginId = null) {
    const active = this.active();
    if (pluginId && active && active.pluginId !== pluginId && active.id !== pluginId) return false;
    this.write(null);
    return Boolean(active);
  }

  inspect(plugin) {
    const root = pluginRootFromSummary(plugin);
    if (!root) return { profile: null, error: null };
    try {
      const pluginManifestPath = path.join(root, ".codex-plugin", "plugin.json");
      const pluginManifest = fs.existsSync(pluginManifestPath)
        ? JSON.parse(fs.readFileSync(pluginManifestPath, "utf8"))
        : { name: plugin.name, version: plugin.version || plugin.localVersion };
      return { profile: readIndustryPlugin(root, pluginManifest), error: null };
    } catch (error) {
      return { profile: null, error: error.message };
    }
  }

  decorate(plugins) {
    const active = this.active();
    return (plugins || []).map((plugin) => {
      const { profile, error } = this.inspect(plugin);
      return {
        ...plugin,
        industry: profile ? publicProfile(profile, active?.pluginId === plugin.id || active?.id === profile.id) : null,
        industryError: error,
      };
    });
  }

  runtimeInstructions(profile = this.active()) {
    if (!profile?.instructions) return "";
    return `<onpeople_industry_plugin id="${profile.id}" version="${profile.version}">\n${profile.instructions}\n</onpeople_industry_plugin>`;
  }
}

module.exports = {
  IndustryPluginStore,
  isCompatibleVersion,
  pluginRootFromSummary,
  publicProfile,
  readIndustryPlugin,
};
