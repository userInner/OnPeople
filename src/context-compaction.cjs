const PENDING_MANUAL_CONTEXT_COMPACTION_ID = "pending-manual-context-compaction";

function compactionItem(message = {}) {
  const item = message.params?.item;
  return item?.type === "contextCompaction" ? item : null;
}

function compactionKey(threadId, itemId) {
  return `${String(threadId || "")}\0${String(itemId || "")}`;
}

class ContextCompactionTracker {
  constructor() {
    this.pendingManualByThread = new Map();
    this.activeByItem = new Map();
  }

  beginManual(threadId) {
    const id = String(threadId || "").trim();
    if (!id) throw new Error("threadId is required");
    this.pendingManualByThread.set(id, (this.pendingManualByThread.get(id) || 0) + 1);
    return {
      id: PENDING_MANUAL_CONTEXT_COMPACTION_ID,
      type: "contextCompaction",
      status: "inProgress",
      completed: false,
      source: "manual",
    };
  }

  failManual(threadId) {
    const id = String(threadId || "").trim();
    const count = this.pendingManualByThread.get(id) || 0;
    if (count <= 1) this.pendingManualByThread.delete(id);
    else this.pendingManualByThread.set(id, count - 1);
    return PENDING_MANUAL_CONTEXT_COMPACTION_ID;
  }

  observe(message = {}) {
    const item = compactionItem(message);
    if (!item) return { message, lifecycle: null };
    const threadId = String(message.params?.threadId || message.params?.thread?.id || "").trim();
    const itemId = String(item.id || "").trim();
    if (!threadId || !itemId) return { message, lifecycle: null };

    const key = compactionKey(threadId, itemId);
    let source = "automatic";
    if (message.method === "item/started") {
      const pending = this.pendingManualByThread.get(threadId) || 0;
      if (pending > 0) {
        source = "manual";
        if (pending === 1) this.pendingManualByThread.delete(threadId);
        else this.pendingManualByThread.set(threadId, pending - 1);
      }
      this.activeByItem.set(key, { threadId, itemId, source });
    } else if (message.method === "item/completed") {
      source = this.activeByItem.get(key)?.source || "automatic";
      this.activeByItem.delete(key);
    } else {
      return { message, lifecycle: null };
    }

    const completed = message.method === "item/completed";
    const enrichedItem = {
      ...item,
      status: completed ? (item.status || "completed") : (item.status || "inProgress"),
      completed,
      source,
    };
    return {
      message: {
        ...message,
        params: { ...message.params, item: enrichedItem },
      },
      lifecycle: { threadId, itemId, source, completed },
    };
  }

  clearThread(threadId) {
    const id = String(threadId || "").trim();
    const itemIds = [];
    for (const [key, active] of this.activeByItem) {
      if (active.threadId !== id) continue;
      itemIds.push(active.itemId);
      this.activeByItem.delete(key);
    }
    const hadPendingManual = this.pendingManualByThread.delete(id);
    return { itemIds, hadPendingManual };
  }

  clearAll() {
    const cleared = new Map();
    for (const active of this.activeByItem.values()) {
      const state = cleared.get(active.threadId) || { itemIds: [], hadPendingManual: false };
      state.itemIds.push(active.itemId);
      cleared.set(active.threadId, state);
    }
    for (const threadId of this.pendingManualByThread.keys()) {
      const state = cleared.get(threadId) || { itemIds: [], hadPendingManual: false };
      state.hadPendingManual = true;
      cleared.set(threadId, state);
    }
    this.activeByItem.clear();
    this.pendingManualByThread.clear();
    return cleared;
  }
}

module.exports = {
  ContextCompactionTracker,
  PENDING_MANUAL_CONTEXT_COMPACTION_ID,
  compactionItem,
};
