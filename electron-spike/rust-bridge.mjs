import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

export class RustBridge {
  #binary;
  #dataRoot;
  #runtimeRoot;
  #transport;
  #socketPath;
  #child = null;
  #stream = null;
  #pending = new Map();
  #eventListeners = new Set();
  #restartCount = 0;
  #stderr = "";
  #stopping = false;

  constructor({
    binary,
    dataRoot,
    runtimeRoot,
    transport = "stdio",
    socketPath,
  }) {
    this.#binary = binary;
    this.#dataRoot = dataRoot;
    this.#runtimeRoot = runtimeRoot;
    this.#transport = transport === "socket" ? "socket" : "stdio";
    this.#socketPath = socketPath;
  }

  get restartCount() {
    return this.#restartCount;
  }

  get pid() {
    return this.#child?.pid ?? null;
  }

  get transport() {
    return this.#transport;
  }

  onEvent(listener) {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  async start() {
    if (this.#child) return;
    this.#stopping = false;
    const args = [
      "--data-root",
      this.#dataRoot,
      "--runtime-root",
      this.#runtimeRoot,
    ];
    if (this.#transport === "socket") {
      if (!this.#socketPath) throw new Error("Unix Socket transport 缺少路径");
      args.push("--socket", this.#socketPath);
    }
    const child = spawn(this.#binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-4_000);
    });
    child.once("error", (error) => this.#handleExit(error));
    child.once("exit", (code, signal) => {
      this.#handleExit(
        new Error(
          `Rust 桌面宿主已退出 (${signal ?? code ?? "unknown"})${this.#stderr ? `: ${this.#stderr.trim()}` : ""}`,
        ),
      );
    });

    if (this.#transport === "socket") {
      this.#stream = await connectSocket(this.#socketPath);
    } else {
      this.#stream = child.stdout;
    }
    createInterface({ input: this.#stream }).on("line", (line) =>
      this.#handleLine(line),
    );
  }

  stop() {
    this.#stopping = true;
    this.#stream?.destroy?.();
    this.#stream = null;
    const child = this.#child;
    this.#child = null;
    if (child && !child.killed) child.kill("SIGTERM");
    this.#clearPending();
  }

  request(request, timeoutMs = 20_000) {
    if (!this.#child || !this.#stream) {
      return Promise.reject(new Error("Rust 桌面宿主尚未启动"));
    }
    const writable =
      this.#transport === "socket" ? this.#stream : this.#child.stdin;
    if (!writable?.writable) {
      return Promise.reject(new Error("Rust 桌面宿主 transport 不可写"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId);
        reject(new Error(`DesktopRequest 超时: ${request.method}`));
      }, timeoutMs);
      this.#pending.set(request.requestId, { resolve, reject, timer });
      writable.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(request.requestId);
        reject(error);
      });
    });
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.kind === "event") {
      for (const listener of this.#eventListeners) listener(message.payload);
      return;
    }
    if (message.kind !== "response") return;
    const response = message.payload;
    const pending = this.#pending.get(response?.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(response.requestId);
    pending.resolve(response);
  }

  #handleExit(error) {
    if (!this.#child) return;
    this.#child = null;
    this.#stream = null;
    if (!this.#stopping) this.#restartCount += 1;
    this.#rejectPending(error);
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #clearPending() {
    for (const pending of this.#pending.values()) clearTimeout(pending.timer);
    this.#pending.clear();
  }
}

async function connectSocket(socketPath) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const stream = createConnection(socketPath);
        stream.once("connect", () => resolve(stream));
        stream.once("error", reject);
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error("无法连接 Rust Unix Socket");
}
