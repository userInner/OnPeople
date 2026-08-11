import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  shell,
  systemPreferences,
} from "electron";

import { isSafeBrowserUrl } from "./browser-controller.mjs";

function nonEmptyPath(value, field = "path") {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${field} 不能为空`);
  return result;
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    }[extension] ?? "application/octet-stream"
  );
}

async function generatedImage(filePath) {
  const bytes = await readFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    mimeType: mimeType(filePath),
    bytes: bytes.byteLength,
    dataUrl: `data:${mimeType(filePath)};base64,${bytes.toString("base64")}`,
  };
}

export class ElectronShellAdapter {
  #window;
  #requestRust;
  #emit;
  #rendererReady;

  constructor({ window, requestRust, emit, rendererReady }) {
    this.#window = window;
    this.#requestRust = requestRust;
    this.#emit = emit;
    this.#rendererReady = rendererReady;
  }

  async handle(method, params = {}) {
    switch (method) {
      case "shell.deep-links.activate":
        return [];
      case "shell.frontend.ready":
        this.#rendererReady();
        return null;
      case "shell.task-window.open":
        this.#window.show();
        this.#window.focus();
        if (params.threadId) {
          this.#emit("app:new-task", { threadId: params.threadId });
        }
        return null;
      case "shell.microphone.request": {
        const granted =
          process.platform === "darwin"
            ? await systemPreferences.askForMediaAccess("microphone")
            : true;
        return { granted, status: granted ? "granted" : "denied" };
      }
      case "shell.cloud-console.open":
        return this.#openUrl(
          process.env.ONPEOPLE_CLOUD_CONSOLE_URL ?? "https://onpeople.ai/",
        );
      case "shell.external-url.open":
        return this.#openUrl(params.url);
      case "shell.editor.open": {
        const target = path.resolve(
          nonEmptyPath(params.cwd, "cwd"),
          String(params.path ?? ""),
        );
        const error = await shell.openPath(target);
        return { opened: !error, path: target };
      }
      case "shell.local-artifact.open": {
        const target = nonEmptyPath(params.path);
        const error = await shell.openPath(target);
        return { opened: !error, path: target };
      }
      case "shell.generated-image.reveal": {
        const target = nonEmptyPath(params.imagePath, "imagePath");
        shell.showItemInFolder(target);
        return { revealed: true, path: target };
      }
      case "shell.generated-image.copy": {
        const target = nonEmptyPath(params.imagePath, "imagePath");
        const image = nativeImage.createFromPath(target);
        if (image.isEmpty()) throw new Error("无法读取生成图片");
        clipboard.writeImage(image);
        return {
          copied: true,
          image: await generatedImage(target),
          clipboard: "image",
        };
      }
      case "shell.images.pick":
        return this.#pickFiles(params.paths, [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ]);
      case "shell.attachments.pick":
        return this.#pickFiles(params.paths);
      case "shell.image.paste": {
        const image = clipboard.readImage();
        return { selected: image.isEmpty() ? [] : (params.paths ?? []) };
      }
      case "shell.thread.reveal": {
        this.#window.show();
        this.#window.focus();
        this.#emit("app:new-task", { threadId: params.threadId });
        return { threadId: params.threadId, cwd: "", opened: true };
      }
      case "shell.project.reveal": {
        const target = nonEmptyPath(params.projectPath, "projectPath");
        shell.showItemInFolder(target);
        return { opened: true, path: target };
      }
      case "shell.download-directory.pick":
        return this.#pickDownloadDirectory(params.path);
      case "shell.scheduler.open": {
        const snapshot = await this.#rustResult("scheduler.get", {});
        this.#emit("scheduler:open", snapshot);
        return snapshot;
      }
      case "shell.app-update.state":
        return this.#updateState();
      case "shell.app-update.check":
        return {
          available: false,
          currentVersion: process.env.npm_package_version ?? "0.30.0",
          version: null,
          date: null,
          body: null,
        };
      case "shell.app-update.download":
        return {
          available: false,
          currentVersion: process.env.npm_package_version ?? "0.30.0",
          downloaded: false,
          version: null,
          bytes: null,
        };
      case "shell.app-update.install":
        return {
          installed: false,
          version: process.env.npm_package_version ?? "0.30.0",
        };
      case "shell.app-update.open-download":
        return this.#openUrl("https://github.com/userinner/onpeople/releases");
      default:
        throw new Error(`Electron 壳不支持 Desktop 方法: ${method}`);
    }
  }

  async #openUrl(value) {
    const url = String(value ?? "");
    if (!isSafeBrowserUrl(url) || new URL(url).protocol === "about:") {
      throw new Error("只允许打开 HTTP 或 HTTPS 链接");
    }
    await shell.openExternal(url);
    return { opened: true, url };
  }

  async #pickFiles(seed = [], filters) {
    if (Array.isArray(seed) && seed.length > 0) {
      return { selected: seed.map(String) };
    }
    const result = await dialog.showOpenDialog(this.#window, {
      properties: ["openFile", "multiSelections"],
      ...(filters ? { filters } : {}),
    });
    return { selected: result.canceled ? [] : result.filePaths };
  }

  async #pickDownloadDirectory(initialPath) {
    const result = await dialog.showOpenDialog(this.#window, {
      defaultPath: initialPath || undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    const selected = result.canceled ? null : result.filePaths[0] ?? null;
    const preferences = await this.#rustResult("preferences.get", {});
    if (!selected) return preferences;
    const next = { ...preferences, downloadDirectory: selected };
    await this.#rustResult("preferences.save", { preferences: next });
    return next;
  }

  async #rustResult(method, params) {
    const response = await this.#requestRust({
      protocolVersion: 1,
      requestId: `electron-shell-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method,
      params,
    });
    if (!response.ok) throw response.error ?? new Error(`Rust 请求失败: ${method}`);
    return response.result;
  }

  #updateState() {
    return {
      supported: false,
      status: "idle",
      currentVersion: process.env.npm_package_version ?? "0.30.0",
      availableVersion: null,
      progress: null,
      message: null,
    };
  }
}

export async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
