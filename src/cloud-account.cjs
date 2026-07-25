const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_KEY_NAME = "OnPeople Desktop";
const DEFAULT_SERVICE_URL = "https://sub2api.aibro.vip";
const ACCOUNT_SCHEMA_VERSION = 3;
const LEGACY_LOCAL_SERVICE_URLS = new Set([
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8787",
]);

function normalizeServiceUrl(value) {
  const parsed = new URL(String(value || "").trim());
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Sub2API 地址仅支持 HTTP(S)");
  parsed.pathname = parsed.pathname
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "")
    .replace(/\/v1$/, "") || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function apiErrorMessage(result, status) {
  return result?.error?.message
    || result?.message
    || result?.detail
    || `Sub2API 返回 ${status}`;
}

function unwrapManagementResponse(result) {
  if (!result || typeof result !== "object" || !Object.hasOwn(result, "code")) return result;
  if (Number(result.code) !== 0) {
    const error = new Error(result.message || "Sub2API 请求失败");
    error.code = result.reason || result.code;
    throw error;
  }
  return result.data;
}

function groupPriority(group = {}) {
  const platform = String(group.platform || "").toLowerCase();
  if (platform === "composite") return 0;
  if (platform === "openai") return 1;
  if (platform === "grok") return 2;
  return 3;
}

function emptyAccountRecord(serviceUrl) {
  return {
    schemaVersion: ACCOUNT_SCHEMA_VERSION,
    serviceUrl,
    encryptedAccessToken: "",
    encryptedRefreshToken: "",
    encryptedApiKey: "",
    apiKeyId: null,
    group: null,
    cachedAccount: null,
    cachedModels: [],
  };
}

function normalizeCachedAccount(account) {
  if (!account || typeof account !== "object") return null;
  return {
    id: account.id ?? null,
    email: String(account.email || ""),
    username: String(account.username || ""),
    balanceUSD: Number(account.balanceUSD || 0),
    frozenBalanceUSD: Number(account.frozenBalanceUSD || 0),
    concurrency: Number(account.concurrency || 0),
    status: String(account.status || ""),
    apiKeyId: Number(account.apiKeyId || 0) || null,
    group: account.group && typeof account.group === "object" ? account.group : null,
  };
}

function normalizeCachedModels(models) {
  return (Array.isArray(models) ? models : [])
    .map((model) => ({
      id: String(model?.id || ""),
      name: String(model?.name || model?.id || ""),
      ownedBy: model?.ownedBy || null,
    }))
    .filter((model) => model.id);
}

function jwtAccount(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    return normalizeCachedAccount({
      id: payload.user_id || payload.uid || payload.sub || null,
      email: payload.email || payload.username || "",
      username: payload.username || "",
      status: "cached",
    });
  } catch {
    return null;
  }
}

class CloudAccountClient {
  constructor({ filePath, safeStorage, defaultServiceUrl = DEFAULT_SERVICE_URL }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.defaultServiceUrl = normalizeServiceUrl(defaultServiceUrl);
  }

  read() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const storedVersion = Number(stored.schemaVersion || 0);
      const legacyUrl = normalizeServiceUrl(stored.serviceUrl || this.defaultServiceUrl);
      const normalized = {
        schemaVersion: ACCOUNT_SCHEMA_VERSION,
        serviceUrl: LEGACY_LOCAL_SERVICE_URLS.has(legacyUrl) ? this.defaultServiceUrl : legacyUrl,
        encryptedAccessToken: String(stored.encryptedAccessToken || ""),
        encryptedRefreshToken: String(stored.encryptedRefreshToken || ""),
        encryptedApiKey: String(stored.encryptedApiKey || ""),
        apiKeyId: Number(stored.apiKeyId || 0) || null,
        group: stored.group && typeof stored.group === "object" ? stored.group : null,
        cachedAccount: normalizeCachedAccount(stored.cachedAccount),
        cachedModels: normalizeCachedModels(stored.cachedModels),
      };
      // Account schema upgrades must never discard encrypted credentials. Older
      // builds wrote compatible encrypted fields, so normalize and persist them.
      if (storedVersion > 0 && storedVersion < ACCOUNT_SCHEMA_VERSION) {
        try { this.write(normalized); } catch {}
      }
      return normalized;
    } catch {
      return emptyAccountRecord(this.defaultServiceUrl);
    }
  }

  write(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }

  serviceUrl() {
    return this.read().serviceUrl;
  }

  managementBaseUrl() {
    return `${this.serviceUrl()}/api/v1`;
  }

  apiBaseUrl() {
    return `${this.serviceUrl()}/v1`;
  }

  decrypt(field) {
    const encrypted = this.read()[field];
    if (!encrypted || !this.safeStorage.isEncryptionAvailable()) return "";
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return "";
    }
  }

  accessToken() {
    return this.decrypt("encryptedAccessToken");
  }

  refreshToken() {
    return this.decrypt("encryptedRefreshToken");
  }

  apiKey() {
    return this.decrypt("encryptedApiKey");
  }

  encrypt(value) {
    if (!value) return "";
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，无法保存 Sub2API 登录状态");
    return this.safeStorage.encryptString(value).toString("base64");
  }

  saveCredentials(serviceUrl, changes = {}) {
    const previous = this.read();
    const normalizedServiceUrl = normalizeServiceUrl(serviceUrl || previous.serviceUrl);
    const serviceChanged = normalizedServiceUrl !== previous.serviceUrl;
    const next = {
      ...(serviceChanged ? {
        encryptedAccessToken: "",
        encryptedRefreshToken: "",
        encryptedApiKey: "",
        apiKeyId: null,
        group: null,
        cachedAccount: null,
        cachedModels: [],
      } : previous),
      schemaVersion: ACCOUNT_SCHEMA_VERSION,
      serviceUrl: normalizedServiceUrl,
    };
    if (Object.hasOwn(changes, "accessToken")) next.encryptedAccessToken = this.encrypt(changes.accessToken);
    if (Object.hasOwn(changes, "refreshToken")) next.encryptedRefreshToken = this.encrypt(changes.refreshToken);
    if (Object.hasOwn(changes, "apiKey")) next.encryptedApiKey = this.encrypt(changes.apiKey);
    if (Object.hasOwn(changes, "apiKeyId")) next.apiKeyId = changes.apiKeyId || null;
    if (Object.hasOwn(changes, "group")) next.group = changes.group || null;
    if (Object.hasOwn(changes, "cachedAccount")) next.cachedAccount = normalizeCachedAccount(changes.cachedAccount);
    if (Object.hasOwn(changes, "cachedModels")) next.cachedModels = normalizeCachedModels(changes.cachedModels);
    this.write(next);
    return next;
  }

  clearCredentials() {
    return this.saveCredentials(this.serviceUrl(), {
      accessToken: "",
      refreshToken: "",
      apiKey: "",
      apiKeyId: null,
      group: null,
      cachedAccount: null,
      cachedModels: [],
    });
  }

  async fetchJson(url, { method = "GET", body = null, token = "", headers = {}, timeoutMs = 15_000 } = {}) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const target = new URL(url).origin;
      const detail = cause?.cause?.code
        || (cause?.name === "TimeoutError" ? "连接超时" : "");
      const error = new Error(`无法连接 OnPeople 服务（${target}）${detail ? `：${detail}` : ""}`);
      error.code = cause?.name === "TimeoutError" ? "CLOUD_TIMEOUT" : "CLOUD_NETWORK_ERROR";
      error.cause = cause;
      throw error;
    }
    const raw = await response.text();
    let result;
    try {
      result = JSON.parse(raw || "{}");
    } catch {
      result = {};
    }
    if (!response.ok) {
      const error = new Error(apiErrorMessage(result, response.status));
      error.statusCode = response.status;
      error.code = result?.reason || result?.error?.code || null;
      throw error;
    }
    return result;
  }

  async refreshSession() {
    const refreshToken = this.refreshToken();
    if (!refreshToken) return { refreshed: false, transientFailure: false };
    try {
      const result = unwrapManagementResponse(await this.fetchJson(`${this.managementBaseUrl()}/auth/refresh`, {
        method: "POST",
        body: { refresh_token: refreshToken },
      }));
      if (!result?.access_token) return { refreshed: false, transientFailure: false };
      this.saveCredentials(this.serviceUrl(), {
        accessToken: result.access_token,
        refreshToken: result.refresh_token || refreshToken,
      });
      return { refreshed: true, transientFailure: false };
    } catch (error) {
      return {
        refreshed: false,
        transientFailure: new Set(["CLOUD_NETWORK_ERROR", "CLOUD_TIMEOUT"]).has(error.code),
      };
    }
  }

  async managementRequest(pathname, {
    method = "GET",
    body = null,
    authenticated = true,
    retry = true,
    headers = {},
  } = {}) {
    const token = authenticated ? this.accessToken() : "";
    if (authenticated && !token) throw Object.assign(new Error("请先登录 Sub2API 账号"), { code: "SIGNED_OUT" });
    try {
      const result = await this.fetchJson(`${this.managementBaseUrl()}${pathname}`, { method, body, token, headers });
      return unwrapManagementResponse(result);
    } catch (error) {
      let refresh = { refreshed: false, transientFailure: false };
      if (authenticated && retry && error.statusCode === 401) {
        refresh = await this.refreshSession();
        if (refresh.refreshed) {
          return this.managementRequest(pathname, { method, body, authenticated, retry: false, headers });
        }
      }
      if (authenticated && error.statusCode === 401 && !refresh.transientFailure) this.clearCredentials();
      throw error;
    }
  }

  async gatewayRequest(pathname) {
    const apiKey = this.apiKey();
    if (!apiKey) throw Object.assign(new Error("尚未配置 OnPeople Desktop API Key"), { code: "MISSING_API_KEY" });
    return this.fetchJson(`${this.apiBaseUrl()}${pathname}`, { token: apiKey });
  }

  async availableGroups() {
    const groups = await this.managementRequest("/groups/available");
    return (Array.isArray(groups) ? groups : [])
      .filter((group) => !group.status || group.status === "active")
      .sort((left, right) => groupPriority(left) - groupPriority(right));
  }

  async ensureDesktopApiKey() {
    const listed = await this.managementRequest("/keys?page=1&page_size=100");
    const keys = Array.isArray(listed?.items) ? listed.items : (Array.isArray(listed) ? listed : []);
    let selected = keys.find((key) => key.name === DESKTOP_KEY_NAME && key.status === "active" && key.group_id && key.key);
    if (!selected) {
      const groups = await this.availableGroups();
      const group = groups[0];
      if (!group) {
        throw new Error("Sub2API 账号当前没有可用分组，请先在 Sub2API 管理端为用户开放模型分组");
      }
      selected = await this.managementRequest("/keys", {
        method: "POST",
        body: { name: DESKTOP_KEY_NAME, group_id: group.id },
        headers: { "idempotency-key": crypto.randomUUID() },
      });
    }
    if (!selected?.key) throw new Error("Sub2API 未返回可用 API Key");
    const group = selected.group || (await this.availableGroups()).find((item) => item.id === selected.group_id) || null;
    this.saveCredentials(this.serviceUrl(), {
      apiKey: selected.key,
      apiKeyId: selected.id,
      group,
    });
    return { ...selected, group };
  }

  async models() {
    try {
      const result = await this.gatewayRequest("/models");
      const models = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.models) ? result.models : []);
      return models.map((model) => ({
        id: String(model.id || model.model || ""),
        name: String(model.name || model.id || model.model || ""),
        ownedBy: model.owned_by || null,
      })).filter((model) => model.id);
    } catch {
      return [];
    }
  }

  async status() {
    const serviceUrl = this.serviceUrl();
    const accessToken = this.accessToken();
    if (!accessToken) {
      return { signedIn: false, serviceUrl, apiBaseUrl: `${serviceUrl}/v1`, account: null, models: [] };
    }
    try {
      const user = await this.managementRequest("/auth/me");
      if (!this.apiKey()) await this.ensureDesktopApiKey();
      const stored = this.read();
      const account = {
        id: user.id,
        email: user.email,
        username: user.username,
        balanceUSD: Number(user.balance || 0),
        frozenBalanceUSD: Number(user.frozen_balance || 0),
        concurrency: Number(user.concurrency || 0),
        status: user.status,
        apiKeyId: stored.apiKeyId,
        group: stored.group,
      };
      const models = await this.models();
      this.saveCredentials(serviceUrl, { cachedAccount: account, cachedModels: models });
      return {
        signedIn: true,
        serviceUrl,
        apiBaseUrl: `${serviceUrl}/v1`,
        account,
        models,
      };
    } catch (error) {
      if (!new Set(["CLOUD_NETWORK_ERROR", "CLOUD_TIMEOUT"]).has(error.code)) throw error;
      const stored = this.read();
      const cachedAccount = stored.cachedAccount || jwtAccount(accessToken);
      if (!cachedAccount || !this.apiKey()) throw error;
      return {
        signedIn: true,
        offline: true,
        serviceUrl,
        apiBaseUrl: `${serviceUrl}/v1`,
        account: { ...cachedAccount, apiKeyId: stored.apiKeyId, group: stored.group },
        models: stored.cachedModels,
      };
    }
  }

  async login({ email, password, serviceUrl }) {
    this.saveCredentials(serviceUrl || this.serviceUrl());
    const result = await this.managementRequest("/auth/login", {
      method: "POST",
      body: { email, password },
      authenticated: false,
    });
    if (result?.requires_2fa) {
      const error = new Error("该账号启用了两步验证，请先在 Sub2API 控制台登录，或暂时关闭两步验证后重试");
      error.code = "TWO_FACTOR_REQUIRED";
      throw error;
    }
    if (!result?.access_token) throw new Error("Sub2API 没有返回登录令牌");
    this.saveCredentials(this.serviceUrl(), {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || "",
      apiKey: "",
      apiKeyId: null,
      group: null,
    });
    await this.ensureDesktopApiKey();
    return this.status();
  }

  async sendRegistrationCode({ email, serviceUrl }) {
    this.saveCredentials(serviceUrl || this.serviceUrl());
    return this.managementRequest("/auth/send-verify-code", {
      method: "POST",
      body: { email },
      authenticated: false,
    });
  }

  async register({ email, password, verifyCode }) {
    const result = await this.managementRequest("/auth/register", {
      method: "POST",
      body: { email, password, verify_code: verifyCode },
      authenticated: false,
    });
    if (!result?.access_token) throw new Error("Sub2API 没有返回注册令牌");
    this.saveCredentials(this.serviceUrl(), {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || "",
      apiKey: "",
      apiKeyId: null,
      group: null,
    });
    await this.ensureDesktopApiKey();
    return this.status();
  }

  async redeem(code) {
    const result = await this.managementRequest("/redeem", {
      method: "POST",
      body: { code: String(code || "").trim() },
    });
    return { redemption: result, state: await this.status() };
  }

  async logout() {
    const refreshToken = this.refreshToken();
    try {
      if (refreshToken) {
        await this.managementRequest("/auth/logout", {
          method: "POST",
          body: { refresh_token: refreshToken },
          authenticated: false,
        });
      }
    } finally {
      this.clearCredentials();
    }
    return this.status();
  }

  providerCredentials() {
    const apiKey = this.apiKey();
    if (!apiKey) throw new Error("请先登录 Sub2API 账号，再选择 OnPeople 模型");
    return { baseUrl: this.apiBaseUrl(), apiKey };
  }
}

module.exports = {
  CloudAccountClient,
  DEFAULT_SERVICE_URL,
  DESKTOP_KEY_NAME,
  normalizeServiceUrl,
  unwrapManagementResponse,
};
