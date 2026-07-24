const crypto = require("node:crypto");
const fs = require("node:fs");

const BUILT_INS = [
  { id: "default", name: "Default", role: "通用执行", model: "", effort: "medium", sandbox: "inherit", instructions: "完成当前任务，保持改动聚焦并验证结果。", builtIn: true },
  { id: "explorer", name: "Explorer", role: "代码调查", model: "", effort: "medium", sandbox: "read-only", instructions: "只读调查代码库，返回证据、路径和建议，不修改文件。", builtIn: true },
  { id: "worker", name: "Worker", role: "实现与修复", model: "", effort: "medium", sandbox: "inherit", instructions: "独立完成明确的实现或修复任务，运行相关检查并返回交接。", builtIn: true },
  { id: "reviewer", name: "Reviewer", role: "代码审阅", model: "", effort: "high", sandbox: "read-only", instructions: "审阅正确性、安全性和回归风险，按严重性报告可执行问题。", builtIn: true },
];

function cleanText(value, maximum = 4_000) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, maximum);
}

class AgentProfileStore {
  constructor(filePath) { this.filePath = filePath; }
  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(value.profiles) ? value.profiles : [];
    } catch { return []; }
  }
  write(profiles) {
    fs.mkdirSync(require("node:path").dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify({ version: 1, profiles }, null, 2)}\n`, { mode: 0o600 });
  }
  list() { return [...BUILT_INS, ...this.read()].map((item) => ({ ...item })); }
  save(input = {}) {
    const profiles = this.read();
    const id = cleanText(input.id, 80) || crypto.randomUUID();
    if (BUILT_INS.some((item) => item.id === id)) throw new Error("内置 Agent 不能覆盖");
    const profile = {
      id,
      name: cleanText(input.name, 80) || "Custom Agent",
      role: cleanText(input.role, 120) || "自定义角色",
      model: cleanText(input.model, 160),
      effort: new Set(["low", "medium", "high", "xhigh", "max", "ultra"]).has(input.effort) ? input.effort : "medium",
      sandbox: new Set(["inherit", "read-only", "workspace-write", "danger-full-access"]).has(input.sandbox) ? input.sandbox : "inherit",
      instructions: cleanText(input.instructions, 8_000),
      updatedAt: new Date().toISOString(),
      builtIn: false,
    };
    this.write([...profiles.filter((item) => item.id !== id), profile]);
    return profile;
  }
  remove(id) {
    if (BUILT_INS.some((item) => item.id === id)) throw new Error("内置 Agent 不能删除");
    const profiles = this.read();
    this.write(profiles.filter((item) => item.id !== id));
    return { removed: profiles.some((item) => item.id === id) };
  }
}

module.exports = { AgentProfileStore, BUILT_INS };
