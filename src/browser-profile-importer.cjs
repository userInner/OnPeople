const crypto = require("node:crypto");

const BINDING_NAME = "electron_browser_owl_profile_importer";
const SUPPORTED_PLATFORMS = new Set(["darwin", "win32"]);
const COUNT_FIELDS = ["discovered", "canonicalized", "imported", "skippedExisting", "skippedInvalid", "failed"];

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function sanitizeStep(value) {
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  if (typeof value.status === "string") result.status = value.status;
  for (const field of COUNT_FIELDS) {
    const count = safeCount(value[field]);
    if (count !== undefined) result[field] = count;
  }
  if (value.error != null) result.error = "导入器报告失败";
  return result;
}

function sanitizeResult(value, fallback) {
  const result = {
    source: typeof value?.source === "string" ? value.source : fallback.source,
    profileId: fallback.profileId,
  };
  const cookies = sanitizeStep(value?.cookies);
  if (cookies) result.cookies = cookies;
  if (value?.passwords && typeof value.passwords === "object") {
    result.passwords = sanitizeStep(value.passwords) || {};
    const profile = sanitizeStep(value.passwords.profile);
    const account = sanitizeStep(value.passwords.account);
    if (profile) result.passwords.profile = profile;
    if (account) result.passwords.account = account;
  }
  return result;
}

function loadInternalBinding() {
  if (typeof process._linkedBinding !== "function") return null;
  try {
    const value = process._linkedBinding(BINDING_NAME);
    const importer = value?.owlProfileImporter;
    if (typeof importer?.listImportableProfiles !== "function" || typeof importer?.importProfile !== "function") return null;
    return importer;
  } catch {
    return null;
  }
}

class BrowserProfileImporter {
  constructor({ binding, fallbackBinding = null, platform = process.platform, targetPartition }) {
    this.binding = binding === undefined ? (loadInternalBinding() || fallbackBinding) : binding;
    this.platform = platform;
    this.targetPartition = targetPartition;
    this.profiles = new Map();
  }

  availability() {
    if (!SUPPORTED_PLATFORMS.has(this.platform)) {
      return { available: false, reason: "浏览器资料导入目前仅支持 macOS 与 Windows" };
    }
    if (!this.binding) {
      return { available: false, reason: "当前运行时没有可用的浏览器资料导入模块" };
    }
    return { available: true, reason: null };
  }

  async listProfiles() {
    const availability = this.availability();
    if (!availability.available) return { ...availability, profiles: [] };
    const values = await this.binding.listImportableProfiles();
    if (!Array.isArray(values)) throw new Error("浏览器资料导入器返回了无效结果");
    this.profiles.clear();
    const profiles = [];
    for (const value of values) {
      if (!value || typeof value.source !== "string" || typeof value.profilePath !== "string") continue;
      const id = crypto.createHash("sha256").update(`${value.source}\0${value.profilePath}`).digest("hex").slice(0, 24);
      this.profiles.set(id, value);
      profiles.push({
        id,
        source: value.source,
        appName: typeof value.appName === "string" ? value.appName : value.source,
        profileName: typeof value.profileName === "string" ? value.profileName : "",
        profileDirectoryName: typeof value.profileDirectoryName === "string" ? value.profileDirectoryName : "",
        hasCookies: value.hasCookies === true,
        hasPasswords: value.hasPasswords === true,
      });
    }
    return { ...availability, profiles };
  }

  async importProfile({ profileId, importCookies = true, importPasswords = true, allowElevatedChromeDecryption = false }) {
    if (!this.availability().available) throw new Error(this.availability().reason);
    if (!importCookies && !importPasswords) throw new Error("请至少选择 Cookie 或密码中的一项");
    await this.listProfiles();
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error("所选浏览器资料已不可导入，请重新选择");
    const result = await this.binding.importProfile({
      source: profile.source,
      profilePath: profile.profilePath,
      importCookies: Boolean(importCookies),
      importPasswords: Boolean(importPasswords),
      targetPartition: this.targetPartition,
      ...(allowElevatedChromeDecryption ? { allowElevatedChromeDecryption: true } : {}),
    });
    return sanitizeResult(result, { source: profile.source, profileId });
  }
}

module.exports = { BrowserProfileImporter, BINDING_NAME, sanitizeResult };
