const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const COOKIE_HASH_PREFIX_VERSION = 24;
const MAC_IV = Buffer.alloc(16, 0x20);
const MAC_SALT = Buffer.from("saltysalt");

function deriveMacKey(password) {
  return crypto.pbkdf2Sync(Buffer.from(password), MAC_SALT, 1003, 16, "sha1");
}

function decryptMacValue(encrypted, key) {
  const value = Buffer.from(encrypted || []);
  if (value.length < 4 || !new Set(["v10", "v11"]).has(value.subarray(0, 3).toString("ascii"))) return null;
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, MAC_IV);
  return Buffer.concat([decipher.update(value.subarray(3)), decipher.final()]);
}

function encryptFixtureValue(value, key) {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, MAC_IV);
  return Buffer.concat([Buffer.from("v10"), cipher.update(Buffer.from(value)), cipher.final()]);
}

function runSecurity(args) {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/security", args, { encoding: "utf8", maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) reject(new Error("无法从 macOS 钥匙串读取 Chrome Safe Storage；请确认已授权并完全关闭 Chrome"));
      else resolve(stdout.trimEnd());
    });
  });
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function fileExists(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function cookieDatabasePath(profilePath) {
  const candidates = [path.join(profilePath, "Network", "Cookies"), path.join(profilePath, "Cookies")];
  return candidates.find(fileExists) || candidates[0];
}

function statusFromCounts(counts) {
  if (counts.failed > 0 && counts.imported > 0) return "partial-success";
  if (counts.failed > 0) return "failed";
  return "success";
}

function combineSteps(steps) {
  const combined = { discovered: 0, canonicalized: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0, failed: 0 };
  for (const step of steps.filter(Boolean)) {
    for (const field of Object.keys(combined)) combined[field] += Number(step[field] || 0);
  }
  return { ...combined, status: statusFromCounts(combined) };
}

function sameSiteValue(value) {
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

class ChromiumProfileImporter {
  constructor({
    platform = process.platform,
    homeDirectory = os.homedir(),
    getTargetSession,
    credentialVault,
    keychainReader = () => runSecurity(["find-generic-password", "-w", "-s", "Chrome Safe Storage"]),
  }) {
    this.platform = platform;
    this.getTargetSession = getTargetSession;
    this.credentialVault = credentialVault;
    this.keychainReader = keychainReader;
    this.sources = [{
      source: "chrome",
      appName: "Google Chrome",
      root: path.join(homeDirectory, "Library", "Application Support", "Google", "Chrome"),
    }];
  }

  async listImportableProfiles() {
    if (this.platform !== "darwin") return [];
    const profiles = [];
    for (const source of this.sources) {
      const localState = readJson(path.join(source.root, "Local State"));
      const infoCache = localState?.profile?.info_cache || {};
      let directories = Object.keys(infoCache);
      if (directories.length === 0) {
        try { directories = fs.readdirSync(source.root).filter((name) => name === "Default" || /^Profile \d+$/.test(name)); } catch {}
      }
      for (const directory of directories) {
        const profilePath = path.join(source.root, directory);
        const cookiesPath = cookieDatabasePath(profilePath);
        const loginPath = path.join(profilePath, "Login Data");
        const accountLoginPath = path.join(profilePath, "Login Data For Account");
        if (!fileExists(cookiesPath) && !fileExists(loginPath) && !fileExists(accountLoginPath)) continue;
        profiles.push({
          source: source.source,
          appName: source.appName,
          profileName: typeof infoCache[directory]?.name === "string" ? infoCache[directory].name : directory,
          profileDirectoryName: directory,
          profilePath,
          hasCookies: fileExists(cookiesPath),
          hasPasswords: (fileExists(loginPath) || fileExists(accountLoginPath)) && this.credentialVault?.available() === true,
        });
      }
    }
    return profiles;
  }

  validateProfile(sourceId, profilePath) {
    const source = this.sources.find((item) => item.source === sourceId);
    if (!source) throw new Error("不支持的 Chromium 浏览器来源");
    const root = path.resolve(source.root) + path.sep;
    const candidate = path.resolve(profilePath);
    if (!candidate.startsWith(root)) throw new Error("浏览器资料路径不在允许的 Chrome 目录中");
    return candidate;
  }

  async importProfile({ source, profilePath, importCookies, importPasswords }) {
    if (this.platform !== "darwin") throw new Error("开源兼容导入器目前仅支持 macOS Chrome");
    const safeProfilePath = this.validateProfile(source, profilePath);
    const secret = await this.keychainReader();
    if (!secret) throw new Error("Chrome Safe Storage 钥匙串条目为空");
    const key = deriveMacKey(secret);
    const result = { source, profilePath: safeProfilePath };
    if (importCookies) result.cookies = await this.importCookies(cookieDatabasePath(safeProfilePath), key);
    if (importPasswords) {
      const profilePathname = path.join(safeProfilePath, "Login Data");
      const accountPathname = path.join(safeProfilePath, "Login Data For Account");
      const profile = fileExists(profilePathname) ? this.importPasswords(profilePathname, key) : undefined;
      const account = fileExists(accountPathname) ? this.importPasswords(accountPathname, key) : undefined;
      result.passwords = { ...combineSteps([profile, account]), ...(profile ? { profile } : {}), ...(account ? { account } : {}) };
    }
    return result;
  }

  async importCookies(databasePath, key) {
    const counts = { discovered: 0, canonicalized: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0, failed: 0 };
    if (!fileExists(databasePath)) return { ...counts, status: "failed", error: "Cookie 数据库不存在" };
    let database;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      const versionRow = database.prepare("SELECT value FROM meta WHERE key = 'version'").get();
      const version = Number(versionRow?.value || 0);
      const rows = database.prepare(`SELECT host_key, name, value, encrypted_value, path,
        (expires_utc / 1000000.0) - ${CHROME_EPOCH_OFFSET_SECONDS} AS expiration_unix,
        is_secure, is_httponly, samesite FROM cookies`).all();
      counts.discovered = rows.length;
      const targetSession = this.getTargetSession();
      for (const row of rows) {
        try {
          let plaintext = typeof row.value === "string" && row.value ? Buffer.from(row.value) : decryptMacValue(row.encrypted_value, key);
          if (!plaintext) { counts.skippedInvalid += 1; continue; }
          if (version >= COOKIE_HASH_PREFIX_VERSION) {
            const expected = crypto.createHash("sha256").update(row.host_key).digest();
            if (plaintext.length < 32 || !crypto.timingSafeEqual(plaintext.subarray(0, 32), expected)) {
              counts.skippedInvalid += 1;
              continue;
            }
            plaintext = plaintext.subarray(32);
          }
          const host = String(row.host_key || "").replace(/^\./, "");
          if (!host || !row.name || plaintext.includes(0)) { counts.skippedInvalid += 1; continue; }
          const secure = Boolean(row.is_secure);
          const details = {
            url: `${secure ? "https" : "http"}://${host}${String(row.path || "/").startsWith("/") ? row.path : "/"}`,
            name: String(row.name),
            value: plaintext.toString("utf8"),
            path: String(row.path || "/"),
            secure,
            httpOnly: Boolean(row.is_httponly),
            sameSite: sameSiteValue(Number(row.samesite)),
          };
          if (String(row.host_key).startsWith(".")) details.domain = String(row.host_key);
          if (Number(row.expiration_unix) > 0) details.expirationDate = Number(row.expiration_unix);
          counts.canonicalized += 1;
          await targetSession.cookies.set(details);
          counts.imported += 1;
        } catch {
          counts.failed += 1;
        }
      }
    } catch {
      counts.failed += 1;
      return { ...counts, status: statusFromCounts(counts), error: "无法读取 Cookie 数据库；请完全关闭 Chrome 后重试" };
    } finally {
      try { database?.close(); } catch {}
    }
    return { ...counts, status: statusFromCounts(counts) };
  }

  importPasswords(databasePath, key) {
    const counts = { discovered: 0, canonicalized: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0, failed: 0 };
    if (!fileExists(databasePath)) return { ...counts, status: "failed", error: "密码数据库不存在" };
    let database;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      const rows = database.prepare(`SELECT origin_url, action_url, username_value, password_value, signon_realm
        FROM logins WHERE COALESCE(blacklisted_by_user, 0) = 0`).all();
      counts.discovered = rows.length;
      const credentials = [];
      for (const row of rows) {
        try {
          const plaintext = decryptMacValue(row.password_value, key);
          if (!plaintext || plaintext.includes(0)) { counts.skippedInvalid += 1; continue; }
          credentials.push({
            originUrl: String(row.origin_url || ""),
            actionUrl: String(row.action_url || ""),
            signonRealm: String(row.signon_realm || ""),
            username: String(row.username_value || ""),
            password: plaintext.toString("utf8"),
          });
          counts.canonicalized += 1;
        } catch { counts.failed += 1; }
      }
      const stored = this.credentialVault.importCredentials(credentials);
      counts.imported = stored.imported;
      counts.skippedInvalid += stored.skippedInvalid;
    } catch {
      counts.failed += 1;
      return { ...counts, status: statusFromCounts(counts), error: "无法读取密码数据库；请完全关闭 Chrome 后重试" };
    } finally {
      try { database?.close(); } catch {}
    }
    return { ...counts, status: statusFromCounts(counts) };
  }
}

module.exports = { ChromiumProfileImporter, deriveMacKey, decryptMacValue, encryptFixtureValue };
