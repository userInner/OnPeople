const fs = require("node:fs");
const path = require("node:path");

// Status names, priority, and the 8 × 9 atlas geometry follow the public
// OpenAI Codex terminal-pet implementation:
// https://github.com/openai/codex/tree/main/codex-rs/tui/src/pets
const PET_FRAME = Object.freeze({ width: 192, height: 208, columns: 8, rows: 9 });
const PET_STATUS_PRIORITY = Object.freeze({
  "needs-input": 4,
  blocked: 3,
  ready: 2,
  running: 1,
  idle: 0,
});

const PET_ANIMATIONS = Object.freeze({
  idle: { row: 0, frames: 6, durations: [1680, 660, 660, 840, 840, 1920] },
  "running-right": { row: 1, frames: 8, duration: 120, finalDuration: 220 },
  "running-left": { row: 2, frames: 8, duration: 120, finalDuration: 220 },
  waving: { row: 3, frames: 4, duration: 140, finalDuration: 280 },
  jumping: { row: 4, frames: 5, duration: 140, finalDuration: 280 },
  failed: { row: 5, frames: 8, duration: 140, finalDuration: 240 },
  waiting: { row: 6, frames: 6, duration: 150, finalDuration: 260 },
  running: { row: 7, frames: 6, duration: 120, finalDuration: 220 },
  review: { row: 8, frames: 6, duration: 150, finalDuration: 280 },
});

function normalizePetStatus(value) {
  const raw = String(value || "").toLowerCase().replace(/[\s_]+/g, "-");
  if (raw.includes("waiting-approval") || raw.includes("waiting-input") || raw.includes("needs-input")) return "needs-input";
  if (raw.includes("failed") || raw.includes("error") || raw.includes("blocked") || raw.includes("paused")) return "blocked";
  if (raw.includes("completed") || raw.includes("ready")) return "ready";
  if (raw.includes("working") || raw.includes("running") || raw.includes("active") || raw.includes("restoring") || raw.includes("starting")) return "running";
  return "idle";
}

function animationForStatus(status) {
  return {
    "needs-input": "waiting",
    blocked: "failed",
    ready: "jumping",
    running: "running",
    idle: "idle",
  }[normalizePetStatus(status)];
}

class PetStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tasks = new Map();
    this.settings = this.#readSettings();
  }

  #readSettings() {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        visible: Boolean(value.visible),
        position: value.position && Number.isFinite(value.position.x) && Number.isFinite(value.position.y)
          ? { x: value.position.x, y: value.position.y }
          : null,
        trayOpen: Boolean(value.trayOpen),
        skinId: String(value.skinId || value.petId || "onpeople"),
        customSkins: Array.isArray(value.customSkins)
          ? value.customSkins.slice(0, 24).map((skin) => ({
            id: String(skin.id || ""),
            name: String(skin.name || "自定义皮肤").slice(0, 60),
            path: String(skin.path || ""),
          })).filter((skin) => skin.id && skin.path)
          : [],
      };
    } catch {
      return { visible: false, position: null, trayOpen: false, skinId: "onpeople", customSkins: [] };
    }
  }

  saveSettings(patch = {}) {
    this.settings = { ...this.settings, ...patch };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`, { mode: 0o600 });
    return this.snapshot();
  }

  updateTask(input = {}) {
    const threadId = String(input.threadId || "").trim();
    if (!threadId) return this.snapshot();
    const status = normalizePetStatus(input.status);
    if (status === "idle") {
      this.tasks.delete(threadId);
      return this.snapshot();
    }
    const existing = this.tasks.get(threadId) || {};
    this.tasks.set(threadId, {
      threadId,
      title: String(input.title || existing.title || `任务 ${threadId.slice(0, 8)}`).trim(),
      status,
      updatedAt: Date.now(),
    });
    return this.snapshot();
  }

  removeTask(threadId) {
    this.tasks.delete(String(threadId || ""));
    return this.snapshot();
  }

  snapshot() {
    const tasks = [...this.tasks.values()].sort((left, right) =>
      (PET_STATUS_PRIORITY[right.status] - PET_STATUS_PRIORITY[left.status])
      || (right.updatedAt - left.updatedAt));
    const active = tasks[0] || null;
    return {
      ...this.settings,
      status: active?.status || "idle",
      animation: animationForStatus(active?.status || "idle"),
      activeThreadId: active?.threadId || null,
      tasks,
    };
  }
}

module.exports = {
  PET_ANIMATIONS,
  PET_FRAME,
  PET_STATUS_PRIORITY,
  PetStateStore,
  animationForStatus,
  normalizePetStatus,
};
