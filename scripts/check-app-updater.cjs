const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { AppUpdateService, WINDOWS_UPDATE_FEED_URL, normalizeUpdateFeedUrl } = require("../src/app-updater.cjs");

class FakeUpdater extends EventEmitter {
  setFeedURL(config) { this.feedConfig = config; }
  async checkForUpdates() { this.emit("update-available", { version: "0.30.0" }); }
  async downloadUpdate() {
    this.emit("download-progress", { percent: 42.4, transferred: 424, total: 1000 });
    this.emit("update-downloaded", { version: "0.30.0" });
  }
  quitAndInstall(isSilent, forceRunAfter) { this.installArgs = [isSilent, forceRunAfter]; }
}

async function run() {
  const fake = new FakeUpdater();
  const service = new AppUpdateService({
    updater: fake,
    platform: "win32",
    isPackaged: true,
    currentVersion: "0.29.12",
    startupDelayMs: 60_000,
    checkIntervalMs: 60_000,
  });
  service.start();
  assert.deepEqual(fake.feedConfig, { provider: "generic", url: WINDOWS_UPDATE_FEED_URL });
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, true);
  assert.equal(service.snapshot().status, "idle");

  await service.check();
  assert.equal(service.snapshot().status, "available");
  assert.equal(service.snapshot().availableVersion, "0.30.0");

  await service.download();
  assert.equal(service.snapshot().status, "downloaded");
  assert.equal(service.snapshot().percent, 100);

  service.install();
  assert.equal(service.snapshot().status, "installing");
  assert.deepEqual(fake.installArgs, [false, true]);
  service.dispose();

  const unsupported = new AppUpdateService({ updater: new FakeUpdater(), platform: "darwin", isPackaged: true, currentVersion: "0.29.12" });
  assert.equal(unsupported.start().supported, false);
  assert.equal((await unsupported.check()).status, "unsupported");

  const storeUpdater = new FakeUpdater();
  const storeManaged = new AppUpdateService({
    updater: storeUpdater,
    platform: "win32",
    isPackaged: true,
    isWindowsStore: true,
    currentVersion: "0.29.12",
  });
  assert.equal(storeManaged.start().supported, false);
  assert.equal(storeManaged.snapshot().status, "store-managed");
  assert.match(storeManaged.snapshot().message, /Microsoft Store/);
  assert.equal(storeUpdater.feedConfig, undefined);
  assert.equal((await storeManaged.check()).status, "store-managed");

  assert.equal(normalizeUpdateFeedUrl("https://updates.example.test/windows"), "https://updates.example.test/windows/");
  assert.throws(() => normalizeUpdateFeedUrl("http://updates.example.test/windows"), /HTTPS/);
  console.log("App updater checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
