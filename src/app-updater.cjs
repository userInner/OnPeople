const { EventEmitter } = require("node:events");

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 15 * 1000;
const WINDOWS_UPDATE_FEED_URL = "https://aibro.vip/onpeople/update/windows/";

function normalizeUpdateFeedUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("更新地址必须使用 HTTPS");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "更新失败");
}

class AppUpdateService extends EventEmitter {
  constructor({ updater, platform, isPackaged, isWindowsStore = false, currentVersion, updateFeedUrl = WINDOWS_UPDATE_FEED_URL, checkIntervalMs = CHECK_INTERVAL_MS, startupDelayMs = STARTUP_CHECK_DELAY_MS }) {
    super();
    this.updater = updater;
    this.platform = platform;
    this.isPackaged = Boolean(isPackaged);
    this.isWindowsStore = Boolean(isWindowsStore);
    this.checkIntervalMs = checkIntervalMs;
    this.startupDelayMs = startupDelayMs;
    this.updateFeedUrl = normalizeUpdateFeedUrl(updateFeedUrl);
    this.started = false;
    this.startupTimer = null;
    this.intervalTimer = null;
    const supported = this.platform === "win32" && this.isPackaged && !this.isWindowsStore;
    this.state = {
      supported,
      status: this.isWindowsStore ? "store-managed" : (supported ? "idle" : "unsupported"),
      currentVersion: String(currentVersion || "0.0.0"),
      availableVersion: null,
      percent: null,
      transferred: null,
      total: null,
      message: this.isWindowsStore
        ? "由 Microsoft Store 自动管理更新"
        : this.platform === "win32"
        ? (this.isPackaged ? "自动检查 Windows 更新" : "开发模式不执行自动更新")
        : "当前平台请从 OnPeople 下载页更新",
    };
  }

  snapshot() {
    return { ...this.state };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    this.emit("state", snapshot);
    return snapshot;
  }

  start() {
    if (this.started || !this.state.supported) return this.snapshot();
    this.updater.setFeedURL({ provider: "generic", url: this.updateFeedUrl });
    this.started = true;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.allowPrerelease = false;

    this.updater.on("checking-for-update", () => {
      this.update({ status: "checking", message: "正在检查更新…", percent: null });
    });
    this.updater.on("update-available", (info) => {
      this.update({
        status: "available",
        availableVersion: String(info?.version || ""),
        message: `发现 OnPeople ${info?.version || "新版本"}`,
        percent: null,
      });
    });
    this.updater.on("update-not-available", () => {
      this.update({ status: "up-to-date", availableVersion: null, message: "当前已是最新版本", percent: null });
    });
    this.updater.on("download-progress", (progress) => {
      const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
      this.update({
        status: "downloading",
        percent,
        transferred: Number(progress?.transferred) || 0,
        total: Number(progress?.total) || 0,
        message: `正在下载更新 ${Math.round(percent)}%`,
      });
    });
    this.updater.on("update-downloaded", (info) => {
      this.update({
        status: "downloaded",
        availableVersion: String(info?.version || this.state.availableVersion || ""),
        percent: 100,
        message: "更新已下载，重启后完成安装",
      });
    });
    this.updater.on("error", (error) => {
      this.update({ status: "error", message: errorMessage(error), percent: null });
    });

    this.startupTimer = setTimeout(() => void this.check().catch(() => {}), this.startupDelayMs);
    this.startupTimer.unref?.();
    this.intervalTimer = setInterval(() => void this.check().catch(() => {}), this.checkIntervalMs);
    this.intervalTimer.unref?.();
    return this.snapshot();
  }

  async check() {
    if (!this.state.supported) return this.snapshot();
    if (["checking", "downloading", "downloaded", "installing"].includes(this.state.status)) return this.snapshot();
    this.update({ status: "checking", message: "正在检查更新…", percent: null });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      if (this.state.status !== "error") this.update({ status: "error", message: errorMessage(error), percent: null });
    }
    return this.snapshot();
  }

  async download() {
    if (this.state.status !== "available") throw new Error("当前没有可下载的更新");
    this.update({ status: "downloading", message: "正在准备下载…", percent: 0 });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      if (this.state.status !== "error") this.update({ status: "error", message: errorMessage(error), percent: null });
      throw error;
    }
    return this.snapshot();
  }

  install() {
    if (this.state.status !== "downloaded") throw new Error("更新尚未下载完成");
    this.update({ status: "installing", message: "正在重启并安装…" });
    this.updater.quitAndInstall(false, true);
    return this.snapshot();
  }

  dispose() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
  }
}

module.exports = { AppUpdateService, CHECK_INTERVAL_MS, STARTUP_CHECK_DELAY_MS, WINDOWS_UPDATE_FEED_URL, normalizeUpdateFeedUrl };
