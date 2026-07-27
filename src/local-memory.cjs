const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._~+\/-]{12,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+)/ig;

function sanitize(value, maximum = 2_000) {
  return String(value || "").replace(/\0/g, "").replace(SECRET_PATTERN, "[REDACTED]").trim().slice(0, maximum);
}

class LocalMemoryStore {
  constructor(filePath) { this.filePath = filePath; }
  state() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return { enabled: parsed.enabled !== false, generate: parsed.generate === true, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    } catch { return { enabled: true, generate: false, entries: [] }; }
  }
  write(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`, { mode: 0o600 });
  }
  list(cwd = "") {
    const state = this.state();
    const root = cwd ? path.resolve(cwd) : "";
    return { ...state, entries: state.entries.filter((item) => item.scope === "global" || !root || item.projectPath === root) };
  }
  settings(patch = {}) {
    const state = this.state();
    const next = { ...state, enabled: patch.enabled === undefined ? state.enabled : Boolean(patch.enabled), generate: patch.generate === undefined ? state.generate : Boolean(patch.generate) };
    this.write(next);
    return next;
  }
  save(input = {}) {
    const state = this.state();
    const id = sanitize(input.id, 80) || crypto.randomUUID();
    const scope = input.scope === "global" ? "global" : "project";
    const content = sanitize(input.content, 4_000);
    if (!content) throw new Error("记忆内容不能为空");
    const entry = { id, scope, projectPath: scope === "project" ? path.resolve(input.projectPath || process.cwd()) : null, content, enabled: input.enabled !== false, source: sanitize(input.source, 120) || "user", updatedAt: new Date().toISOString() };
    let entries = [...state.entries.filter((item) => item.id !== id), entry];
    // Auto-generated candidates arrive after every turn — cap them separately
    // so they can never evict the user's explicitly saved memories.
    const isCandidate = (item) => !item.enabled && String(item.source || "").startsWith("candidate:");
    const candidates = entries.filter(isCandidate);
    if (candidates.length > 100) {
      const stale = new Set(candidates.slice(0, candidates.length - 100).map((item) => item.id));
      entries = entries.filter((item) => !stale.has(item.id));
    }
    state.entries = entries.slice(-500);
    this.write(state);
    return entry;
  }
  remove(id) {
    const state = this.state();
    const found = state.entries.some((item) => item.id === id);
    state.entries = state.entries.filter((item) => item.id !== id);
    this.write(state);
    return { removed: found };
  }
  context(cwd) {
    const state = this.list(cwd);
    if (!state.enabled) return "";
    const entries = state.entries.filter((item) => item.enabled).slice(-20);
    if (!entries.length) return "";
    return `<onpeople_memory>\n${entries.map((item) => `- ${sanitize(item.content, 1_000)}`).join("\n")}\n</onpeople_memory>`;
  }
}

module.exports = { LocalMemoryStore, sanitize };
