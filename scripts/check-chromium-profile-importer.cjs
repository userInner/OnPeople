const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { BrowserCredentialVault } = require("../src/browser-credential-vault.cjs");
const { ChromiumProfileImporter, deriveMacKey, encryptFixtureValue } = require("../src/chromium-profile-importer.cjs");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-chrome-import-test-"));

try {
  const chromeRoot = path.join(temporaryRoot, "Library", "Application Support", "Google", "Chrome");
  const profilePath = path.join(chromeRoot, "Default");
  fs.mkdirSync(path.join(profilePath, "Network"), { recursive: true });
  fs.writeFileSync(path.join(chromeRoot, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Fixture Profile" } } } }));

  const secret = "fixture-safe-storage-secret";
  const key = deriveMacKey(secret);
  const host = ".example.test";
  const cookiePlaintext = Buffer.concat([crypto.createHash("sha256").update(host).digest(), Buffer.from("fixture-cookie")]);
  const cookieDb = new DatabaseSync(path.join(profilePath, "Network", "Cookies"));
  cookieDb.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,expires_utc REAL,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER);");
  cookieDb.prepare("INSERT INTO meta VALUES('version','24')").run();
  cookieDb.prepare("INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)").run(host, "sid", "", encryptFixtureValue(cookiePlaintext, key), "/", 13_400_000_000_000_000, 1, 1, 1);
  cookieDb.close();

  const loginDb = new DatabaseSync(path.join(profilePath, "Login Data"));
  loginDb.exec("CREATE TABLE logins(origin_url TEXT,action_url TEXT,username_value TEXT,password_value BLOB,signon_realm TEXT,blacklisted_by_user INTEGER);");
  loginDb.prepare("INSERT INTO logins VALUES(?,?,?,?,?,0)").run("https://example.test/login", "https://example.test/session", "fixture-user", encryptFixtureValue("fixture-password", key), "https://example.test");
  loginDb.close();

  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => Buffer.from(value).toString().slice("encrypted:".length),
  };
  const vault = new BrowserCredentialVault({ filePath: path.join(temporaryRoot, "vault.json"), safeStorage });
  const importedCookies = [];
  const importer = new ChromiumProfileImporter({
    platform: "darwin",
    homeDirectory: temporaryRoot,
    credentialVault: vault,
    keychainReader: async () => secret,
    getTargetSession: () => ({ cookies: { set: async (value) => importedCookies.push(value) } }),
  });

  (async () => {
    const profiles = await importer.listImportableProfiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].profileName, "Fixture Profile");
    assert.equal(profiles[0].hasCookies, true);
    assert.equal(profiles[0].hasPasswords, true);
    const result = await importer.importProfile({ source: "chrome", profilePath, importCookies: true, importPasswords: true });
    assert.equal(result.cookies.imported, 1);
    assert.equal(result.passwords.imported, 1);
    assert.equal(importedCookies[0].value, "fixture-cookie");
    assert.equal(vault.findForUrl("https://example.test/account").username, "fixture-user");
    assert.equal(vault.findForUrl("https://example.test/account").password, "fixture-password");
    process.stdout.write("Chromium profile importer checks passed.\n");
  })().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }).finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
} catch (error) {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  throw error;
}
