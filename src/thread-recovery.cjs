const { EventEmitter } = require("node:events");

const TERMINAL_STATES = new Set(["ready", "failed"]);

class ThreadRecoveryCoordinator extends EventEmitter {
  constructor() {
    super();
    this.states = new Map();
  }

  state(threadId) {
    return this.states.get(String(threadId || "")) || null;
  }

  transition(threadId, phase, detail = {}) {
    const id = String(threadId || "").trim();
    if (!id) return null;
    const previous = this.states.get(id);
    const attempt = phase === "restoring"
      ? (previous?.attempt || 0) + 1
      : (previous?.attempt || 1);
    const state = {
      threadId: id,
      phase,
      attempt,
      source: detail.source || previous?.source || null,
      error: detail.error ? String(detail.error) : null,
      startedAt: phase === "restoring" ? Date.now() : (previous?.startedAt || Date.now()),
      updatedAt: Date.now(),
    };
    this.states.set(id, state);
    this.emit("transition", { ...state });
    return state;
  }

  begin(threadId) {
    return this.transition(threadId, "restoring");
  }

  degraded(threadId, error = null) {
    return this.transition(threadId, "degraded", { error });
  }

  ready(threadId, source = "response") {
    return this.transition(threadId, "ready", { source });
  }

  failed(threadId, error) {
    return this.transition(threadId, "failed", { error });
  }

  clear(threadId) {
    this.states.delete(String(threadId || ""));
  }

  snapshot(threadId = null) {
    if (threadId) {
      const state = this.state(threadId);
      return state ? { ...state } : null;
    }
    return [...this.states.values()].map((state) => ({ ...state }));
  }

  isSettled(threadId) {
    return TERMINAL_STATES.has(this.state(threadId)?.phase);
  }
}

module.exports = { ThreadRecoveryCoordinator };
