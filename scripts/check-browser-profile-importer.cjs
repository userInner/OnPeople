const assert = require("node:assert/strict");
const { BrowserProfileImporter } = require("../src/browser-profile-importer.cjs");

const calls = [];
const binding = {
  listImportableProfiles: async () => [{
    source: "chrome",
    profilePath: "/secret/profile/path",
    appName: "Google Chrome",
    profileName: "您的 Chrome",
    profileDirectoryName: "Default",
    hasCookies: true,
    hasPasswords: true,
  }],
  importProfile: async (payload) => {
    calls.push(payload);
    return {
      source: "chrome",
      profilePath: "/secret/profile/path",
      cookies: { status: "success", imported: 12 },
      passwords: { status: "partial-success", imported: 3, error: "sensitive native detail" },
    };
  },
};

(async () => {
  const importer = new BrowserProfileImporter({ binding, platform: "darwin", targetPartition: "persist:test" });
  const listed = await importer.listProfiles();
  assert.equal(listed.available, true);
  assert.equal(listed.profiles.length, 1);
  assert.equal(JSON.stringify(listed).includes("/secret/profile/path"), false);

  const result = await importer.importProfile({ profileId: listed.profiles[0].id, importCookies: true, importPasswords: true });
  assert.equal(calls[0].targetPartition, "persist:test");
  assert.equal(calls[0].profilePath, "/secret/profile/path");
  assert.equal(result.cookies.imported, 12);
  assert.equal(result.passwords.imported, 3);
  assert.equal(result.passwords.error, "导入器报告失败");
  assert.equal(JSON.stringify(result).includes("sensitive native detail"), false);
  assert.equal(JSON.stringify(result).includes("/secret/profile/path"), false);

  const unavailable = new BrowserProfileImporter({ binding: null, platform: "darwin", targetPartition: "persist:test" });
  assert.equal((await unavailable.listProfiles()).available, false);
  process.stdout.write("Browser profile importer checks passed.\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
