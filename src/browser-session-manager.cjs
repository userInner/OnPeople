// Reusable, consent-first browser session management.
// This module never exports cookie values, passwords, tokens, or storage contents.

const SESSION_PROVIDERS = Object.freeze({
  google: Object.freeze({
    id: "google",
    label: "Google",
    loginUrl: "https://accounts.google.com/",
    services: ["Gmail", "Drive", "Docs", "Calendar", "YouTube"],
    cookieDomains: [".google.com", ".google.com.hk", ".googleusercontent.com", ".youtube.com"],
    // clearData({ origins }) deletes by registrable domain — keep every domain
    // listed in cookieDomains represented here, or "clear" leaves cookies behind.
    origins: [
      "https://accounts.google.com",
      "https://www.google.com",
      "https://www.google.com.hk",
      "https://mail.google.com",
      "https://drive.google.com",
      "https://docs.google.com",
      "https://calendar.google.com",
      "https://www.youtube.com",
      "https://lh3.googleusercontent.com",
    ],
  }),
});

const CLEARABLE_DATA = ["cookies", "localStorage", "indexedDB", "serviceWorkers", "cache"];

class BrowserSessionManager {
  constructor(getSession) {
    this.getSession = getSession;
  }

  session() {
    const value = this.getSession();
    if (!value) throw new Error("浏览器会话尚未就绪");
    return value;
  }

  provider(providerId) {
    const provider = SESSION_PROVIDERS[providerId];
    if (!provider) throw new Error("不支持的浏览器账号来源");
    return provider;
  }

  signInTarget(providerId) {
    const provider = this.provider(providerId);
    return { provider: provider.id, label: provider.label, url: provider.loginUrl };
  }

  async providerSummary(provider) {
    const ses = this.session();
    let cookieCount = 0;
    for (const domain of provider.cookieDomains) {
      const cookies = await ses.cookies.get({ domain });
      cookieCount += cookies.length;
    }
    return {
      id: provider.id,
      label: provider.label,
      services: [...provider.services],
      hasLocalSessionData: cookieCount > 0,
      cookieCount,
    };
  }

  async summary() {
    const ses = this.session();
    const providers = await Promise.all(Object.values(SESSION_PROVIDERS).map((provider) => this.providerSummary(provider)));
    return {
      persistent: ses.isPersistent(),
      cacheBytes: await ses.getCacheSize(),
      providers,
      privacy: {
        readsChromeProfile: true,
        exposesCookieValues: false,
        importsPasswords: true,
      },
    };
  }

  async clearProvider(providerId) {
    const provider = this.provider(providerId);
    const ses = this.session();
    await ses.clearData({ dataTypes: CLEARABLE_DATA, origins: provider.origins });
    await ses.clearAuthCache();
    ses.flushStorageData();
    return { cleared: provider.id, summary: await this.summary() };
  }

  async clearAll() {
    const ses = this.session();
    await ses.clearData({ dataTypes: CLEARABLE_DATA });
    await ses.clearAuthCache();
    ses.flushStorageData();
    return { cleared: "all", summary: await this.summary() };
  }
}

module.exports = { BrowserSessionManager, SESSION_PROVIDERS };
