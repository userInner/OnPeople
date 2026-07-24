const assert = require("node:assert/strict");
const { isNavigationAbort, loadWebContentsUrl, resolveAddressInput } = require("../src/browser-navigation.cjs");

(async () => {
  assert.equal(isNavigationAbort(Object.assign(new Error("aborted"), { code: "ERR_ABORTED", errno: -3 })), true);
  assert.equal(isNavigationAbort(new Error("ERR_ABORTED (-3) loading URL")), true);
  assert.equal(isNavigationAbort(new Error("ERR_NAME_NOT_RESOLVED")), false);

  assert.deepEqual(
    { kind: resolveAddressInput("12323").kind, url: resolveAddressInput("12323").url.toString() },
    { kind: "search", url: "https://www.google.com.hk/search?q=12323" },
  );
  assert.equal(resolveAddressInput("自由职业者 平台").url.toString(), "https://www.google.com.hk/search?q=%E8%87%AA%E7%94%B1%E8%81%8C%E4%B8%9A%E8%80%85+%E5%B9%B3%E5%8F%B0");
  assert.equal(resolveAddressInput("?freelancer").url.toString(), "https://www.google.com.hk/search?q=freelancer");
  assert.equal(resolveAddressInput("google.com.hk").url.toString(), "https://google.com.hk/");
  assert.equal(resolveAddressInput("google.com.hk/search?q=123").url.toString(), "https://google.com.hk/search?q=123");
  assert.equal(resolveAddressInput("localhost:3000").url.toString(), "https://localhost:3000/");
  assert.equal(resolveAddressInput("127.0.0.1:5173/app").url.toString(), "https://127.0.0.1:5173/app");
  assert.equal(resolveAddressInput("https://example.com/path").url.toString(), "https://example.com/path");
  assert.throws(() => resolveAddressInput("file:///tmp/private"), /Only HTTP/);

  const redirected = {
    loadURL: async () => { redirected.current = "https://www.google.com.hk/"; throw Object.assign(new Error("ERR_ABORTED (-3)"), { errno: -3 }); },
    getURL: () => redirected.current,
  };
  assert.deepEqual(await loadWebContentsUrl(redirected, "https://google.com.hk/"), { url: "https://www.google.com.hk/", replaced: true });

  const failed = { loadURL: async () => { throw new Error("ERR_NAME_NOT_RESOLVED"); }, getURL: () => "" };
  await assert.rejects(() => loadWebContentsUrl(failed, "https://invalid.test/"), /ERR_NAME_NOT_RESOLVED/);
  process.stdout.write("Browser navigation checks passed.\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
