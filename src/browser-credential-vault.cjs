const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function originKey(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizedOrigin(value) {
  try { return new URL(value).origin; } catch { return null; }
}

class BrowserCredentialVault {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
  }

  available() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  readEntries() {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(value?.entries) ? value.entries : [];
    } catch {
      return [];
    }
  }

  writeEntries(entries) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }

  importCredentials(credentials) {
    if (!this.available()) throw new Error("系统安全存储不可用，不能安全导入密码");
    const entries = this.readEntries();
    const byIdentity = new Map(entries.map((entry) => [`${entry.originKey}:${entry.usernameKey}`, entry]));
    let imported = 0;
    let skippedInvalid = 0;
    for (const credential of credentials) {
      const origin = normalizedOrigin(credential.originUrl || credential.signonRealm);
      if (!origin || typeof credential.username !== "string" || typeof credential.password !== "string" || !credential.password) {
        skippedInvalid += 1;
        continue;
      }
      const usernameKey = originKey(credential.username);
      const payload = Buffer.from(this.safeStorage.encryptString(JSON.stringify({
        origin,
        actionUrl: typeof credential.actionUrl === "string" ? credential.actionUrl : "",
        username: credential.username,
        password: credential.password,
      }))).toString("base64");
      byIdentity.set(`${originKey(origin)}:${usernameKey}`, {
        originKey: originKey(origin),
        usernameKey,
        payload,
        updatedAt: new Date().toISOString(),
      });
      imported += 1;
    }
    this.writeEntries([...byIdentity.values()]);
    return { imported, skippedInvalid };
  }

  findForUrl(url) {
    if (!this.available()) return null;
    const origin = normalizedOrigin(url);
    if (!origin) return null;
    const key = originKey(origin);
    const matches = this.readEntries().filter((entry) => entry.originKey === key);
    for (const entry of matches) {
      try {
        const value = JSON.parse(this.safeStorage.decryptString(Buffer.from(entry.payload, "base64")));
        if (value?.origin === origin && typeof value.username === "string" && typeof value.password === "string") return value;
      } catch {}
    }
    return null;
  }
}

module.exports = { BrowserCredentialVault, normalizedOrigin };
