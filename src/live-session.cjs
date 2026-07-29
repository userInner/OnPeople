const LIVE_VOICES = Object.freeze(["cove"]);
const DEFAULT_LIVE_VOICE = "cove";
const MAX_SDP_BYTES = 2 * 1024 * 1024;
const MAX_INITIAL_ITEMS = 16;
const MAX_INITIAL_TEXT = 8_000;
const { resolveLiveSidebandUrl } = require("./live-sideband.cjs");

function normalizeLiveVoice(value) {
  const voice = String(value || "").trim().toLowerCase();
  return LIVE_VOICES.includes(voice) ? voice : DEFAULT_LIVE_VOICE;
}

function normalizeLiveInitialItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, MAX_INITIAL_ITEMS)
    .map((item) => {
      const role = new Set(["user", "developer", "assistant"]).has(item?.role)
        ? item.role
        : "user";
      const text = String(item?.text || "").replace(/\0/g, "").trim().slice(0, MAX_INITIAL_TEXT);
      if (!text) return null;
      return {
        type: "message",
        role,
        content: [{
          type: role === "assistant" ? "output_text" : "input_text",
          text,
        }],
      };
    })
    .filter(Boolean);
}

function buildLiveSession({
  instructions = "",
  initialItems = [],
  voice = DEFAULT_LIVE_VOICE,
} = {}) {
  const normalizedInstructions = String(instructions || "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, 16_000);
  const session = {
    instructions: normalizedInstructions || "You are OnPeople Live, a concise voice assistant.",
    audio: {
      output: {
        voice: normalizeLiveVoice(voice),
      },
    },
    delegation: {
      type: "client",
    },
  };
  const normalizedItems = normalizeLiveInitialItems(initialItems);
  if (normalizedItems.length) session.initial_items = normalizedItems;
  return session;
}

function liveErrorMessage(status, body) {
  let parsed = null;
  try { parsed = JSON.parse(body); } catch {}
  const upstream = parsed?.error?.message || parsed?.message || "";
  if (status === 401) return "OnPeople 登录凭据已失效，请重新登录";
  if (status === 403) return upstream || "当前 OnPeople 模型分组尚未开放 GPT-Live";
  if (status === 429) return upstream || "GPT-Live 并发已满，请稍后重试";
  if (status >= 500) return upstream || "GPT-Live 服务暂时不可用";
  return upstream || `GPT-Live 建连失败（HTTP ${status}）`;
}

async function createLiveCall({
  baseUrl,
  apiKey,
  sdp,
  instructions,
  initialItems,
  voice,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const offer = String(sdp || "");
  if (!/^https?:\/\//i.test(normalizedBaseUrl)) throw new Error("GPT-Live 服务地址无效");
  if (!String(apiKey || "").trim()) throw new Error("请先登录 OnPeople 账号");
  if (!offer.trim()) throw new Error("GPT-Live SDP Offer 不能为空");
  if (Buffer.byteLength(offer) > MAX_SDP_BYTES) throw new Error("GPT-Live SDP Offer 超过大小限制");
  if (typeof fetchImpl !== "function") throw new Error("当前运行时不支持 GPT-Live 网络请求");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 30_000));
  let response;
  try {
    response = await fetchImpl(`${normalizedBaseUrl}/live`, {
      method: "POST",
      headers: {
        accept: "application/sdp",
        authorization: `Bearer ${String(apiKey).trim()}`,
        "content-type": "application/json",
        "user-agent": "OnPeople-Desktop/Live",
      },
      body: JSON.stringify({
        sdp: offer,
        session: buildLiveSession({ instructions, initialItems, voice }),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("GPT-Live 建连超时");
    throw new Error(`GPT-Live 网络连接失败：${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }

  const answer = await response.text();
  if (!response.ok) throw new Error(liveErrorMessage(response.status, answer));
  if (!answer.trim().startsWith("v=0")) throw new Error("GPT-Live 返回了无效的 SDP Answer");
  const rawLocation = String(response.headers.get("location") || "").trim();
  const sidebandUrl = resolveLiveSidebandUrl(normalizedBaseUrl, rawLocation);
  return {
    sdp: answer,
    callId: rawLocation ? rawLocation.split("/").filter(Boolean).pop() || null : null,
    sidebandAvailable: Boolean(sidebandUrl),
    sidebandLocation: rawLocation || null,
    sidebandUrl,
    sidebandStatus: sidebandUrl
      ? "Sideband 控制通道正在连接"
      : "服务未返回 Sideband 控制地址",
  };
}

async function closeLiveCall({
  baseUrl,
  apiKey,
  callId,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedCallId = String(callId || "").trim();
  if (!/^https?:\/\//i.test(normalizedBaseUrl)) throw new Error("GPT-Live 服务地址无效");
  if (!String(apiKey || "").trim()) throw new Error("请先登录 OnPeople 账号");
  if (!normalizedCallId) return false;
  if (typeof fetchImpl !== "function") throw new Error("当前运行时不支持 GPT-Live 网络请求");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 8_000));
  let response;
  try {
    response = await fetchImpl(`${normalizedBaseUrl}/live/${encodeURIComponent(normalizedCallId)}`, {
      method: "DELETE",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${String(apiKey).trim()}`,
        "user-agent": "OnPeople-Desktop/Live",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("GPT-Live 结束请求超时");
    throw new Error(`GPT-Live 结束请求失败：${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }
  if (response.ok || response.status === 404) return true;
  const body = await response.text();
  throw new Error(liveErrorMessage(response.status, body));
}

module.exports = {
  DEFAULT_LIVE_VOICE,
  LIVE_VOICES,
  buildLiveSession,
  closeLiveCall,
  createLiveCall,
  liveErrorMessage,
  normalizeLiveInitialItems,
  normalizeLiveVoice,
};
