const crypto = require("node:crypto");

function trimText(value, limit = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function consoleRecord(params = {}) {
  const values = Array.isArray(params.args)
    ? params.args.map((arg) => arg.value ?? arg.description ?? arg.unserializableValue).filter((value) => value !== undefined)
    : [];
  return {
    level: trimText(params.type || "log", 24),
    text: trimText(values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "), 2_000),
    timestamp: Number(params.timestamp) || Date.now(),
    source: "console",
  };
}

function logRecord(entry = {}) {
  return {
    level: trimText(entry.level || "info", 24),
    text: trimText(entry.text, 2_000),
    timestamp: Number(entry.timestamp) || Date.now(),
    source: trimText(entry.source || "log", 48),
    url: trimText(entry.url, 1_000) || null,
    line: Number.isFinite(entry.lineNumber) ? entry.lineNumber : null,
  };
}

function networkRecord(event, params = {}, existing = {}) {
  if (event === "Network.requestWillBeSent") {
    return {
      id: trimText(params.requestId, 160),
      method: trimText(params.request?.method || "GET", 16),
      url: trimText(params.request?.url, 2_000),
      type: trimText(params.type || "Other", 40),
      status: null,
      mimeType: null,
      error: null,
      startedAt: Number(params.timestamp) || null,
    };
  }
  if (event === "Network.responseReceived") {
    return {
      ...existing,
      id: trimText(params.requestId, 160),
      status: Number(params.response?.status) || null,
      mimeType: trimText(params.response?.mimeType, 120) || null,
      url: trimText(params.response?.url || existing.url, 2_000),
      type: trimText(params.type || existing.type || "Other", 40),
    };
  }
  if (event === "Network.loadingFailed") {
    return { ...existing, id: trimText(params.requestId, 160), error: trimText(params.errorText, 500) || "Request failed" };
  }
  return existing;
}

function annotationRecord(draft = {}, page = {}) {
  const note = trimText(draft.note, 2_000);
  if (!note) throw new Error("Annotation note is required");
  const rect = draft.rect || {};
  return {
    id: crypto.randomUUID(),
    url: trimText(page.url, 2_000),
    title: trimText(page.title, 500),
    selector: trimText(draft.selector, 1_000),
    element: trimText(draft.element, 80),
    text: trimText(draft.text, 500),
    note,
    rect: {
      x: Math.max(0, Number(rect.x) || 0),
      y: Math.max(0, Number(rect.y) || 0),
      width: Math.max(0, Number(rect.width) || 0),
      height: Math.max(0, Number(rect.height) || 0),
    },
    createdAt: Date.now(),
  };
}

function boundedPush(list, value, limit = 200) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
  return list;
}

module.exports = { annotationRecord, boundedPush, consoleRecord, logRecord, networkRecord, trimText };
