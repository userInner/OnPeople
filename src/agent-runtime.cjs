const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_PERSISTED_TURNS = 40;
const MAX_PERSISTED_ITEMS = 200;
const MAX_PERSISTED_SESSIONS = 200;
const PERSIST_EVENTS = new Set(["turn/started", "item/started", "item/completed", "turn/completed"]);

function identifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idsFrom(message = {}) {
  const params = message.params || {};
  return {
    threadId: identifier(params.threadId) || identifier(params.thread?.id),
    turnId: identifier(params.turnId) || identifier(params.turn?.id),
    itemId: identifier(params.itemId) || identifier(params.item?.id),
  };
}

function publicTurnEvent(message = {}) {
  if (!message || typeof message.method !== "string") return null;
  const ids = idsFrom(message);
  return {
    id: crypto.randomUUID(),
    type: "turn-event",
    name: message.method,
    ...ids,
    params: message.params || {},
    at: new Date().toISOString(),
  };
}

function cleanSession(session) {
  return {
    id: session.id,
    cwd: session.cwd || null,
    model: session.model || null,
    name: session.name || null,
    status: session.status || "idle",
    activeTurnId: session.activeTurnId || null,
    updatedAt: session.updatedAt,
    turns: [...session.turns.values()].slice(-MAX_PERSISTED_TURNS).map((turn) => ({
      id: turn.id,
      status: turn.status,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt || null,
      error: turn.error || null,
      items: [...turn.items.values()].slice(-MAX_PERSISTED_ITEMS).map((item) => ({
        id: item.id,
        type: item.type || null,
        status: item.status || null,
        startedAt: item.startedAt || null,
        completedAt: item.completedAt || null,
      })),
    })),
  };
}

class AgentRuntimeCoordinator extends EventEmitter {
  constructor({ stateFile = null } = {}) {
    super();
    this.stateFile = stateFile;
    this.sessions = new Map();
    this.inFlight = new Map();
    this.persistTimer = null;
    this.load();
  }

  load() {
    if (!this.stateFile) return;
    try {
      const stored = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
      for (const raw of stored.sessions || []) {
        const turns = new Map();
        for (const turn of raw.turns || []) {
          turns.set(turn.id, { ...turn, items: new Map((turn.items || []).map((item) => [item.id, item])) });
        }
        this.sessions.set(raw.id, { ...raw, activeTurnId: null, status: raw.status === "running" ? "interrupted" : raw.status, turns });
      }
    } catch {}
  }

  rememberSession(thread = {}, metadata = {}, { persist = true } = {}) {
    const id = identifier(thread.id) || identifier(metadata.threadId);
    if (!id) return null;
    const existing = this.sessions.get(id) || { id, turns: new Map(), status: "idle" };
    Object.assign(existing, {
      cwd: thread.cwd || metadata.cwd || existing.cwd || null,
      model: metadata.model || existing.model || null,
      name: thread.name || metadata.name || existing.name || null,
      updatedAt: new Date().toISOString(),
    });
    this.sessions.set(id, existing);
    if (persist) this.schedulePersist();
    return existing;
  }

  observe(message) {
    const event = publicTurnEvent(message);
    if (!event) return null;
    const { threadId, turnId, itemId, name, params } = event;
    const session = threadId ? this.rememberSession(params.thread || {}, { threadId }, { persist: false }) : null;

    if (session && name === "turn/started" && turnId) {
      const turn = session.turns.get(turnId) || { id: turnId, items: new Map() };
      Object.assign(turn, { status: "running", startedAt: turn.startedAt || event.at, completedAt: null, error: null });
      session.turns.set(turnId, turn);
      session.activeTurnId = turnId;
      session.status = "running";
      // A turn that never completed (runtime died mid-turn) leaves its full
      // payloads in inFlight — sweep the thread's stale entries on a new turn.
      for (const key of this.inFlight.keys()) {
        if (key.startsWith(`${threadId}:`) && !key.startsWith(`${threadId}:${turnId}:`)) this.inFlight.delete(key);
      }
    }

    const activeTurnId = turnId || session?.activeTurnId || null;
    const turn = session && activeTurnId ? session.turns.get(activeTurnId) : null;
    if (turn && name === "item/started" && itemId) {
      const item = { ...params.item, id: itemId, status: params.item?.status || "running", startedAt: event.at };
      // Full payloads (tool output etc.) live only in inFlight; turn.items keeps the slim persisted shape.
      turn.items.set(itemId, { id: itemId, type: item.type || null, status: item.status, startedAt: item.startedAt });
      this.inFlight.set(`${threadId}:${activeTurnId}:${itemId}`, item);
    } else if (turn && name === "item/completed" && itemId) {
      const item = turn.items.get(itemId) || { id: itemId, startedAt: event.at };
      Object.assign(item, {
        type: params.item?.type || item.type || null,
        status: params.item?.status || "completed",
        completedAt: event.at,
      });
      turn.items.set(itemId, item);
      this.inFlight.delete(`${threadId}:${activeTurnId}:${itemId}`);
    }

    if (session && name === "turn/completed" && activeTurnId) {
      const completedTurn = session.turns.get(activeTurnId) || { id: activeTurnId, items: new Map(), startedAt: event.at };
      completedTurn.status = params.turn?.status || "completed";
      completedTurn.completedAt = event.at;
      completedTurn.error = params.turn?.error?.message || null;
      session.turns.set(activeTurnId, completedTurn);
      session.activeTurnId = null;
      session.status = completedTurn.status;
      for (const key of this.inFlight.keys()) {
        if (key.startsWith(`${threadId}:${activeTurnId}:`)) this.inFlight.delete(key);
      }
      // Keep the live maps at the persisted caps so long sessions do not grow without bound.
      while (completedTurn.items.size > MAX_PERSISTED_ITEMS) completedTurn.items.delete(completedTurn.items.keys().next().value);
      while (session.turns.size > MAX_PERSISTED_TURNS) session.turns.delete(session.turns.keys().next().value);
    }

    if (session) session.updatedAt = event.at;
    if (PERSIST_EVENTS.has(name)) this.schedulePersist();
    this.emit("event", event);
    return event;
  }

  snapshot(threadId = null) {
    if (threadId) {
      const session = this.sessions.get(threadId);
      return session ? cleanSession(session) : null;
    }
    return {
      sessions: [...this.sessions.values()].map(cleanSession),
      inFlight: [...this.inFlight.entries()].map(([key, item]) => ({ key, id: item.id, type: item.type || null, status: item.status || "running" })),
    };
  }

  schedulePersist() {
    if (!this.stateFile || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 1000);
  }

  pruneSessions() {
    if (this.sessions.size <= MAX_PERSISTED_SESSIONS) return;
    const removable = [...this.sessions.values()]
      .filter((session) => session.status !== "running" && !session.activeTurnId)
      .sort((left, right) => String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")));
    for (const session of removable) {
      if (this.sessions.size <= MAX_PERSISTED_SESSIONS) break;
      this.sessions.delete(session.id);
    }
  }

  persist() {
    if (!this.stateFile) return;
    this.pruneSessions();
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, sessions: [...this.sessions.values()].map(cleanSession) }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.stateFile);
  }

  close() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.persist();
  }
}

module.exports = { AgentRuntimeCoordinator, idsFrom, publicTurnEvent };
