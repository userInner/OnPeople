const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { IndustryPluginStore, isCompatibleVersion, readIndustryPlugin } = require("../src/industry-plugins.cjs");

const referencePluginRoot = path.join(__dirname, "..", "plugins", "research-paper");
const referenceManifest = JSON.parse(fs.readFileSync(path.join(referencePluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const referenceProfile = readIndustryPlugin(referencePluginRoot, referenceManifest);
assert.equal(referenceProfile.id, "research-paper");
assert.equal(referenceProfile.templates[0].id, "article-outline");
assert.equal(referenceProfile.policies[0].id, "research-integrity");
assert.equal(referenceProfile.evals[0].id, "citation-grounding");
assert.match(referenceProfile.instructions, /Never invent a publication/);
assert.match(referenceProfile.instructions, /research_search_papers/);
const referenceMcp = JSON.parse(fs.readFileSync(path.join(referencePluginRoot, ".mcp.json"), "utf8"));
assert.deepEqual(referenceMcp.mcpServers["research-sources"].args, ["./scripts/research-sources-mcp.cjs"]);
assert.equal(referenceMcp.mcpServers["research-sources"].env, undefined);
assert.equal(isCompatibleVersion("0.29.25", ">=0.29.0"), true);
assert.equal(isCompatibleVersion("0.28.9", ">=0.29.0"), false);
const builderConfig = fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8");
assert.match(builderConfig, /plugins\/\*\*\/\*/);
assert.match(builderConfig, /\.agents\/plugins\/marketplace\.json/);
const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
assert.match(mainSource, /official-plugin-marketplace/);
assert.match(
  mainSource,
  /ipcMain\.handle\("plugins:install"[\s\S]*?plugin\/install[\s\S]*?restartAppServer\("plugin-change"\)/,
  "plugin installation should restart the agent runtime so updated Skills and MCP tools are registered",
);
assert.match(
  mainSource,
  /ipcMain\.handle\("plugins:uninstall"[\s\S]*?plugin\/uninstall[\s\S]*?restartAppServer\("plugin-change"\)/,
  "plugin removal should restart the agent runtime so removed MCP tools are detached",
);
assert.match(mainSource, /knownThreadIndustryPlugin/);
assert.match(mainSource, /requestedIndustryPluginId = String\(payload\.industryPluginId/);
assert.doesNotMatch(mainSource, /const industryPlugin = industryPluginStore\?\.active\(\) \|\| null/);
assert.match(mainSource, /availableIndustryPlugin: publicIndustryPlugin/);
assert.match(rendererSource, /activeIndustryPlugin = null;\s+setThreadHeader\(null\)/);
assert.match(rendererSource, /industryPluginId: !currentThreadId/);
assert.match(rendererSource, /syncIndustryPluginCapability/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-industry-plugin-"));
try {
  const pluginRoot = path.join(root, "plugins", "research-paper");
  fs.mkdirSync(path.join(pluginRoot, ".onpeople"), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, "instructions"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "instructions", "agent.md"), "Ground every claim in evidence.\n");
  fs.writeFileSync(path.join(pluginRoot, ".onpeople", "industry.json"), JSON.stringify({
    schemaVersion: 1,
    type: "industry",
    id: "research-paper",
    displayName: "Research Paper",
    industry: "research",
    instructions: "./instructions/agent.md",
    languages: ["zh-CN", "en"],
    capabilities: ["literature-review"],
    workflows: [{ id: "new-paper", name: "New paper", prompt: "Start a paper project." }],
  }));

  const profile = readIndustryPlugin(pluginRoot, { name: "research-paper", version: "1.2.3" });
  assert.equal(profile.version, "1.2.3");
  assert.deepEqual(profile.languages, ["zh-CN", "en"]);

  const store = new IndustryPluginStore(path.join(root, "state.json"), { appVersion: "1.5.0" });
  assert.throws(() => store.activate(profile, { id: "research-paper", installed: false, enabled: true }), /先安装/);
  assert.throws(() => store.activate({ ...profile, compatibility: ">=2.0.0" }, { id: "research-paper", installed: true, enabled: true }), /需要 OnPeople/);
  const active = store.activate(profile, { id: "official:research-paper", installed: true, enabled: true });
  assert.equal(active.active, true);
  assert.match(store.runtimeInstructions(), /Ground every claim/);
  assert.equal(store.decorate([{ id: "official:research-paper", name: "research-paper", installed: true, enabled: true, pluginRoot }])[0].industry.active, true);
  assert.equal(store.deactivate("another-plugin"), false);
  assert.equal(store.deactivate("official:research-paper"), true);
  assert.equal(store.active(), null);

  fs.writeFileSync(path.join(pluginRoot, ".onpeople", "industry.json"), JSON.stringify({
    schemaVersion: 1, type: "industry", id: "research-paper", instructions: "../../outside.md",
  }));
  fs.writeFileSync(path.join(root, "outside.md"), "outside\n");
  assert.throws(() => readIndustryPlugin(pluginRoot, { name: "research-paper" }), /超出插件目录/);

  console.log("industry plugin checks passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
