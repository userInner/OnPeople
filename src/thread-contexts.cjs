class ThreadContextRegistry {
  constructor() {
    this.threads = new Map();
    this.windows = new Map();
  }

  normalizeId(value) {
    const id = String(value || "").trim();
    return id || null;
  }

  ensure(threadId, patch = {}) {
    const id = this.normalizeId(threadId);
    if (!id) return null;
    const previous = this.threads.get(id) || {
      id,
      turnId: null,
      goal: null,
      model: null,
      reasoningEffort: null,
      name: null,
      cwd: null,
      workspaceMode: null,
      workspaceBaseCwd: null,
      provider: null,
      lifecycle: "idle",
      updatedAt: Date.now(),
    };
    const next = { ...previous, ...patch, id, updatedAt: Date.now() };
    this.threads.set(id, next);
    return next;
  }

  get(threadId) {
    const id = this.normalizeId(threadId);
    return id ? (this.threads.get(id) || null) : null;
  }

  update(threadId, patch = {}) {
    return this.ensure(threadId, patch);
  }

  remove(threadId) {
    const id = this.normalizeId(threadId);
    if (!id) return false;
    for (const [windowId, boundThreadId] of this.windows) {
      if (boundThreadId === id) this.windows.set(windowId, null);
    }
    return this.threads.delete(id);
  }

  bindWindow(windowId, threadId) {
    const key = Number(windowId);
    if (!Number.isInteger(key)) throw new Error("windowId must be an integer");
    const id = this.normalizeId(threadId);
    this.windows.set(key, id);
    return id ? this.ensure(id) : null;
  }

  unbindWindow(windowId) {
    this.windows.delete(Number(windowId));
  }

  threadIdForWindow(windowId) {
    return this.windows.get(Number(windowId)) || null;
  }

  contextForWindow(windowId) {
    return this.get(this.threadIdForWindow(windowId));
  }

  startTurn(threadId, turnId) {
    const id = this.normalizeId(threadId);
    const nextTurnId = this.normalizeId(turnId);
    if (!id) return null;
    return this.ensure(id, { turnId: nextTurnId, lifecycle: nextTurnId ? "running" : "idle" });
  }

  completeTurn(threadId, turnId = null, lifecycle = "idle") {
    const context = this.get(threadId);
    if (!context) return null;
    const expected = this.normalizeId(turnId);
    if (expected && context.turnId && context.turnId !== expected) return context;
    return this.update(context.id, { turnId: null, lifecycle });
  }

  setProvider(threadId, provider) {
    return this.ensure(threadId, { provider: provider ? { ...provider } : null });
  }

  snapshot(threadId = null) {
    if (threadId) {
      const context = this.get(threadId);
      return context ? { ...context, provider: context.provider ? { ...context.provider } : null } : null;
    }
    return {
      threads: [...this.threads.values()].map((context) => ({
        ...context,
        provider: context.provider ? { ...context.provider } : null,
      })),
      windows: [...this.windows.entries()].map(([windowId, boundThreadId]) => ({ windowId, threadId: boundThreadId })),
    };
  }
}

module.exports = { ThreadContextRegistry };
