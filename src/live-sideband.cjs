const WebSocket = require("ws");

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_DELAYS_MS = Object.freeze([300, 1_000, 2_500]);

function resolveLiveSidebandUrl(baseUrl, location) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedLocation = String(location || "").trim();
  if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
    throw new Error("GPT-Live Sideband 服务地址无效");
  }
  if (!normalizedLocation) return null;
  const base = new URL(`${normalizedBaseUrl}/`);
  const target = new URL(normalizedLocation, base);
  if (!new Set(["http:", "https:", "ws:", "wss:"]).has(target.protocol)) {
    throw new Error("GPT-Live Sideband 协议无效");
  }
  target.protocol = target.protocol === "http:" ? "ws:"
    : target.protocol === "https:" ? "wss:"
      : target.protocol;
  return target.toString();
}

function sidebandPayload(data, isBinary) {
  if (isBinary) return Buffer.from(data);
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data || "");
}

class LiveSidebandConnection {
  constructor({
    url,
    apiKey,
    WebSocketImpl = WebSocket,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    reconnectDelaysMs = DEFAULT_RECONNECT_DELAYS_MS,
    onEvent = () => {},
    onStatus = () => {},
  } = {}) {
    this.url = String(url || "").trim();
    this.apiKey = String(apiKey || "").trim();
    this.WebSocketImpl = WebSocketImpl;
    this.connectTimeoutMs = Math.max(1_000, Number(connectTimeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS);
    this.reconnectDelaysMs = Array.isArray(reconnectDelaysMs)
      ? reconnectDelaysMs.map((value) => Math.max(0, Number(value) || 0))
      : [...DEFAULT_RECONNECT_DELAYS_MS];
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.socket = null;
    this.closed = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
  }

  start() {
    if (!/^wss?:\/\//i.test(this.url)) throw new Error("GPT-Live Sideband WebSocket 地址无效");
    if (!this.apiKey) throw new Error("GPT-Live Sideband 缺少鉴权凭据");
    this.closed = false;
    this.#connect();
    return this;
  }

  #emitStatus(state, detail = "") {
    this.onStatus({
      state,
      detail: String(detail || ""),
      attempt: this.reconnectAttempt,
      connected: state === "connected",
    });
  }

  #connect() {
    if (this.closed) return;
    this.#emitStatus(this.reconnectAttempt ? "reconnecting" : "connecting");
    const socket = new this.WebSocketImpl(this.url, {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "user-agent": "OnPeople-Desktop/Live-Sideband",
      },
      handshakeTimeout: this.connectTimeoutMs,
      perMessageDeflate: false,
    });
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket || this.closed) return;
      this.reconnectAttempt = 0;
      this.#emitStatus("connected");
    });
    socket.on("message", (data, isBinary) => {
      if (this.socket !== socket || this.closed) return;
      this.onEvent(sidebandPayload(data, isBinary), Boolean(isBinary));
    });
    socket.on("error", (error) => {
      if (this.socket !== socket || this.closed) return;
      this.#emitStatus("error", error?.message || error);
    });
    socket.on("close", (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closed) {
        this.#emitStatus("closed");
        return;
      }
      const detail = `${Number(code) || 0}${reason?.length ? ` ${String(reason)}` : ""}`.trim();
      this.#scheduleReconnect(detail);
    });
  }

  #scheduleReconnect(detail) {
    if (this.closed) return;
    const delay = this.reconnectDelaysMs[this.reconnectAttempt];
    if (delay == null) {
      this.#emitStatus("unavailable", detail);
      return;
    }
    this.reconnectAttempt += 1;
    this.#emitStatus("reconnecting", detail);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return false;
    this.socket.send(typeof payload === "string" || Buffer.isBuffer(payload)
      ? payload
      : JSON.stringify(payload));
    return true;
  }

  close(code = 1000, reason = "OnPeople Live ended") {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      this.#emitStatus("closed");
      return;
    }
    try { socket.close(code, reason); }
    catch { try { socket.terminate?.(); } catch {} }
    this.#emitStatus("closed");
  }
}

function connectLiveSideband(options = {}) {
  return new LiveSidebandConnection(options).start();
}

module.exports = {
  LiveSidebandConnection,
  connectLiveSideband,
  resolveLiveSidebandUrl,
  sidebandPayload,
};
