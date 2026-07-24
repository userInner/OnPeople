const assert = require("node:assert/strict");
const { BrowserSessionManager } = require("../src/browser-session-manager.cjs");

const calls = [];
const fakeSession = {
  isPersistent: () => true,
  getCacheSize: async () => 2 * 1024 * 1024,
  cookies: {
    get: async ({ domain }) => domain === ".google.com" ? [{ name: "redacted" }, { name: "redacted" }] : [],
  },
  clearData: async (options) => calls.push(["clearData", options]),
  clearAuthCache: async () => calls.push(["clearAuthCache"]),
  flushStorageData: () => calls.push(["flushStorageData"]),
};

(async () => {
  const manager = new BrowserSessionManager(() => fakeSession);
  const summary = await manager.summary();
  assert.equal(summary.persistent, true);
  assert.equal(summary.cacheBytes, 2 * 1024 * 1024);
  assert.equal(summary.providers[0].id, "google");
  assert.equal(summary.providers[0].cookieCount, 2);
  assert.equal(summary.providers[0].hasLocalSessionData, true);
  assert.deepEqual(summary.privacy, {
    readsChromeProfile: true,
    exposesCookieValues: false,
    importsPasswords: true,
  });
  assert.equal(JSON.stringify(summary).includes("redacted"), false);

  const signIn = manager.signInTarget("google");
  assert.equal(signIn.url, "https://accounts.google.com/");

  await manager.clearProvider("google");
  assert.equal(calls[0][0], "clearData");
  assert.equal(calls[0][1].origins.includes("https://accounts.google.com"), true);
  assert.deepEqual(calls.slice(1, 3).map(([name]) => name), ["clearAuthCache", "flushStorageData"]);

  process.stdout.write("Browser session manager checks passed.\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
