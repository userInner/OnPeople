const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AgentProfileStore } = require("../src/agent-profiles.cjs");
const { inspectEffectiveConfig } = require("../src/effective-config.cjs");
const { LocalMemoryStore } = require("../src/local-memory.cjs");
const { UsageLedger } = require("../src/usage-ledger.cjs");
const { SecretStore } = require("../src/secret-store.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-management-"));
try {
  const profiles = new AgentProfileStore(path.join(root, "profiles.json"));
  assert.equal(profiles.list().some((item) => item.id === "reviewer"), true);
  const custom = profiles.save({ name: "Security", role: "reviewer", sandbox: "read-only", instructions: "Check boundaries." });
  assert.equal(profiles.list().find((item) => item.id === custom.id).name, "Security");

  const project = path.join(root, "repo", "packages", "app");
  fs.mkdirSync(path.join(project, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(root, "repo", "AGENTS.md"), "Root rules\n");
  fs.writeFileSync(path.join(project, ".codex", "config.toml"), "model = \"test\"\n");
  const config = inspectEffectiveConfig({ cwd: project, provider: { type: "compatible", model: "demo", baseUrl: "local" }, policy: { sandbox: "read-only" }, appHome: root });
  assert.equal(config.sources.length, 2);

  const memories = new LocalMemoryStore(path.join(root, "memory.json"));
  memories.save({ scope: "project", projectPath: project, content: "Use pnpm; api_key=secret-value-123456" });
  assert.match(memories.context(project), /Use pnpm/);
  assert.doesNotMatch(memories.context(project), /secret-value/);

  const usage = new UsageLedger(path.join(root, "usage.json"));
  usage.setPrice("compatible|demo", { input: 1, cached: 0.5, output: 2 });
  usage.record({ threadId: "t1", provider: "compatible", model: "demo", usage: { total: { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 500 } } });
  usage.record({ threadId: "t1", provider: "compatible", model: "demo", usage: { total: { inputTokens: 1200, cachedInputTokens: 250, outputTokens: 600 } } });
  const row = usage.snapshot().rows[0];
  assert.deepEqual({ input: row.input, cached: row.cached, output: row.output }, { input: 1200, cached: 250, output: 600 });
  assert.ok(row.estimatedCost > 0);

  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`cipher:${value}`),
    decryptString: (value) => value.toString().replace(/^cipher:/, ""),
  };
  const secrets = new SecretStore(path.join(root, "secrets.json"), fakeSafeStorage);
  secrets.save({ name: "DEPLOY_TOKEN", value: "private", scope: "project", projectPath: project, allowedHosts: "api.example.com" });
  const visible = secrets.list()[0];
  assert.equal(visible.configured, true);
  assert.equal(Object.hasOwn(visible, "encryptedValue"), false);
  assert.equal(secrets.revealForHost("DEPLOY_TOKEN", "api.example.com", project), "private");
  assert.throws(() => secrets.revealForHost("DEPLOY_TOKEN", "evil.example", project));

  console.log("management features: ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
