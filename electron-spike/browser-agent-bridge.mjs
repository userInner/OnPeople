import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:net";
import { createInterface } from "node:readline";

const MAX_REQUEST_BYTES = 256 * 1024;

export class BrowserAgentBridge {
  #server = null;
  #handler;
  #address = null;
  #token = randomBytes(32).toString("hex");

  constructor({ handler }) {
    this.#handler = handler;
  }

  get address() {
    return this.#address;
  }

  get token() {
    return this.#token;
  }

  async start() {
    if (this.#server) return this.#address;
    const server = createServer((socket) => {
      let received = 0;
      let handled = false;
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      lines.on("line", async (line) => {
        if (handled) return;
        handled = true;
        lines.close();
        received += Buffer.byteLength(line);
        if (received > MAX_REQUEST_BYTES) {
          socket.end(
            `${JSON.stringify({ ok: false, error: "浏览器请求过大" })}\n`,
          );
          return;
        }
        try {
          const request = JSON.parse(line);
          const suppliedToken = Buffer.from(String(request?.token ?? ""));
          const expectedToken = Buffer.from(this.#token);
          if (
            suppliedToken.length !== expectedToken.length ||
            !timingSafeEqual(suppliedToken, expectedToken)
          ) {
            throw new Error("内嵌浏览器 Agent bridge 认证失败");
          }
          const result = await this.#handler(request);
          socket.end(`${JSON.stringify({ ok: true, result })}\n`);
        } catch (error) {
          socket.end(
            `${JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })}\n`,
          );
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("无法启动内嵌浏览器 Agent bridge");
    }
    this.#server = server;
    this.#address = `127.0.0.1:${address.port}`;
    return this.#address;
  }

  close() {
    this.#server?.close();
    this.#server = null;
    this.#address = null;
  }
}

function pageMatchesExpectedUrl(candidateUrl, expectedUrl) {
  if (!expectedUrl || candidateUrl === expectedUrl) return true;
  if (!candidateUrl || candidateUrl === "about:blank") return false;
  try {
    const candidate = new URL(candidateUrl);
    const expected = new URL(expectedUrl);
    return candidate.origin === expected.origin;
  } catch {
    return false;
  }
}

export async function waitForBrowserPage(
  browserHost,
  expectedUrl,
  timeoutMs = 12_000,
  remindRenderer = null,
) {
  const deadline = Date.now() + timeoutMs;
  let nextReminderAt = Date.now() + 400;
  while (Date.now() < deadline) {
    const state = browserHost?.state();
    const page = state?.attachedPages?.find(
      (candidate) =>
        candidate.tabId === state.activeTabId &&
        pageMatchesExpectedUrl(candidate.url, expectedUrl),
    );
    if (page) return page;
    if (remindRenderer && Date.now() >= nextReminderAt) {
      remindRenderer();
      nextReminderAt = Date.now() + 400;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("内嵌浏览器页面尚未准备好");
}
