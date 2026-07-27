const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteFile, readJsonWithBackup } = require("./atomic-file.cjs");

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

class SecretStore {
  constructor(filePath, safeStorage) { this.filePath = filePath; this.safeStorage = safeStorage; }
  read() {
    try { const value = readJsonWithBackup(this.filePath, { secrets: [] }); return Array.isArray(value.secrets) ? value.secrets : []; }
    catch { return []; }
  }
  write(secrets) {
    atomicWriteFile(this.filePath, `${JSON.stringify({ version: 1, secrets }, null, 2)}\n`, { mode: 0o600 });
  }
  list() { return this.read().map(({ encryptedValue, ...item }) => ({ ...item, configured: Boolean(encryptedValue) })); }
  save(input = {}) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用");
    const name = String(input.name || "").trim().toUpperCase();
    if (!NAME.test(name)) throw new Error("变量名只能使用大写字母、数字和下划线");
    const value = String(input.value || "");
    const existing = this.read();
    const byId = input.id ? existing.find((item) => item.id === input.id) : null;
    const byName = existing.find((item) => item.name === name);
    if (byId && byName && byName.id !== byId.id) throw new Error("已存在同名变量，请先删除或改用其他名称");
    const previous = byId || byName;
    if (!value && !previous?.encryptedValue) throw new Error("密钥值不能为空");
    const record = {
      id: previous?.id || crypto.randomUUID(), name,
      encryptedValue: value ? this.safeStorage.encryptString(value).toString("base64") : previous.encryptedValue,
      scope: input.scope === "global" ? "global" : "project",
      projectPath: input.scope === "global" ? null : path.resolve(input.projectPath || process.cwd()),
      allowedHosts: [...new Set(String(input.allowedHosts || "").split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, 30),
      updatedAt: new Date().toISOString(),
    };
    const secrets = this.read();
    this.write([...secrets.filter((item) => item.id !== record.id && item.name !== name), record].slice(-200));
    return this.list().find((item) => item.id === record.id);
  }
  remove(id) { const values = this.read(); this.write(values.filter((item) => item.id !== id)); return { removed: values.some((item) => item.id === id) }; }
  revealForHost(name, host, cwd) {
    const normalizedHost = String(host || "").toLowerCase();
    const root = path.resolve(cwd || process.cwd());
    const record = this.read().find((item) => item.name === name && (item.scope === "global" || item.projectPath === root));
    if (!record) throw new Error("找不到这个安全变量");
    if (!record.allowedHosts.includes(normalizedHost)) throw new Error("目标域名不在这个变量的允许列表中");
    return this.safeStorage.decryptString(Buffer.from(record.encryptedValue, "base64"));
  }
}

module.exports = { SecretStore };
