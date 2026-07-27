const fs = require("node:fs");
const path = require("node:path");

function count(usage, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], usage);
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function localDay(value = Date.now()) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function tokenTotal(row = {}) {
  // Cached input is already included in input; adding it again inflates profiles.
  return Number(row.input || 0) + Number(row.output || 0) + Number(row.reasoning || 0);
}

function durationLabel(milliseconds = 0) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

const TOOL_ITEM_TYPES = new Set(["mcptoolcall", "toolcall", "customtoolcall", "commandexecution", "command"]);

class UsageLedger {
  constructor(filePath) {
    this.filePath = filePath;
    this.lastByThread = new Map();
    this.activeTurns = new Map();
    this.cache = null;
    this.flushTimer = null;
  }
  state() {
    if (this.cache) return this.cache;
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.cache = {
        prices: value.prices || {},
        buckets: value.buckets || {},
        turns: Array.isArray(value.turns) ? value.turns : [],
        tools: value.tools && typeof value.tools === "object" ? value.tools : {},
        archive: { tokens: Number(value.archive?.tokens) || 0 },
        baselines: value.baselines && typeof value.baselines === "object" ? value.baselines : {},
      };
    } catch {
      this.cache = { prices: {}, buckets: {}, turns: [], tools: {}, archive: { tokens: 0 }, baselines: {} };
    }
    // Seed delta baselines so a resumed thread's cumulative usage totals are
    // not re-counted into today's bucket after an app restart.
    for (const [threadId, row] of Object.entries(this.cache.baselines)) {
      if (!this.lastByThread.has(threadId)) {
        this.lastByThread.set(threadId, {
          input: Number(row.input) || 0,
          cached: Number(row.cached) || 0,
          output: Number(row.output) || 0,
          reasoning: Number(row.reasoning) || 0,
        });
      }
    }
    this.pruneExpiredBuckets(this.cache);
    return this.cache;
  }
  pruneExpiredBuckets(state) {
    const cutoff = localDay(Date.now() - 364 * 86_400_000);
    let archivedTokens = 0;
    for (const [key, row] of Object.entries(state.buckets)) {
      if (String(row.day || "") < cutoff) {
        archivedTokens += tokenTotal(row);
        delete state.buckets[key];
      }
    }
    if (archivedTokens) {
      state.archive.tokens += archivedTokens;
      this.write(state);
    }
  }
  write(state) {
    this.cache = state;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 250);
    this.flushTimer.unref?.();
  }
  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.cache) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify({ version: 2, ...this.cache }, null, 2)}\n`, { mode: 0o600 });
  }
  record({ threadId, provider = "unknown", model = "unknown", usage = {} }) {
    if (!threadId) return;
    const state = this.state();
    const total = usage.total || usage;
    const current = {
      input: count(total, ["inputTokens", "input_tokens"]),
      cached: count(total, ["cachedInputTokens", "cached_tokens", "input_tokens_details.cached_tokens"]),
      output: count(total, ["outputTokens", "output_tokens"]),
      reasoning: count(total, ["reasoningOutputTokens", "reasoning_tokens", "output_tokens_details.reasoning_tokens"]),
    };
    const previous = this.lastByThread.get(threadId) || { input: 0, cached: 0, output: 0, reasoning: 0 };
    const delta = Object.fromEntries(Object.keys(current).map((key) => [key, Math.max(0, current[key] - previous[key])]));
    this.lastByThread.set(threadId, current);
    state.baselines[String(threadId)] = current;
    const baselineKeys = Object.keys(state.baselines);
    if (baselineKeys.length > 500) {
      for (const key of baselineKeys.slice(0, baselineKeys.length - 500)) delete state.baselines[key];
    }
    if (!Object.values(delta).some(Boolean)) { this.write(state); return; }
    const day = localDay();
    const key = `${day}|${provider}|${model}`;
    const bucket = state.buckets[key] || { day, provider, model, input: 0, cached: 0, output: 0, reasoning: 0 };
    for (const field of Object.keys(delta)) bucket[field] += delta[field];
    state.buckets[key] = bucket;
    this.write(state);
  }
  turnStarted({ threadId, turnId, startedAt = Date.now() } = {}) {
    if (!threadId || !turnId) return;
    this.activeTurns.set(String(turnId), {
      threadId: String(threadId),
      turnId: String(turnId),
      startedAt: Number(startedAt) || Date.now(),
    });
  }
  turnCompleted({ threadId, turnId, status = "completed", completedAt = Date.now() } = {}) {
    if (!threadId || !turnId) return;
    const key = String(turnId);
    const active = this.activeTurns.get(key);
    const endedAt = Number(completedAt) || Date.now();
    const startedAt = active?.startedAt || endedAt;
    const state = this.state();
    state.turns.push({
      threadId: String(threadId),
      turnId: key,
      day: localDay(startedAt),
      startedAt,
      completedAt: endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      status: String(status || "completed"),
    });
    state.turns = state.turns.slice(-1_000);
    this.activeTurns.delete(key);
    this.write(state);
  }
  recordItem({ item } = {}) {
    if (!item || typeof item !== "object") return;
    const normalizedType = String(item.type || item.kind || "").replace(/[ _-]/g, "").toLowerCase();
    if (!TOOL_ITEM_TYPES.has(normalizedType)) return;
    const server = String(item.server || item.serverName || "").trim();
    const tool = String(item.tool || item.name || item.method || (normalizedType.startsWith("command") ? "terminal" : "tool")).trim();
    const label = [server, tool].filter(Boolean).join(" · ").slice(0, 120);
    if (!label) return;
    const state = this.state();
    state.tools[label] = Number(state.tools[label] || 0) + 1;
    this.write(state);
  }
  snapshot() {
    const state = this.state();
    const rows = Object.values(state.buckets).sort((a, b) => b.day.localeCompare(a.day));
    return {
      prices: state.prices,
      rows: rows.map((row) => ({ ...row, estimatedCost: this.cost(row, state.prices[`${row.provider}|${row.model}`]) })),
      profile: this.profile(state),
    };
  }
  profile(existingState = null) {
    const state = existingState || this.state();
    const today = localDay();
    const days = [];
    const byDay = new Map();
    for (let index = 364; index >= 0; index -= 1) {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - index);
      const day = localDay(date);
      const value = { day, tokens: 0, requests: 0, durationMs: 0 };
      days.push(value);
      byDay.set(day, value);
    }
    let totalTokens = Number(state.archive?.tokens || 0);
    for (const row of Object.values(state.buckets)) {
      const tokens = tokenTotal(row);
      totalTokens += tokens;
      const day = byDay.get(row.day);
      if (day) day.tokens += tokens;
    }
    for (const turn of state.turns) {
      const day = byDay.get(turn.day);
      if (day) {
        day.requests += 1;
        day.durationMs += Number(turn.durationMs || 0);
      }
    }
    const activeDays = days.filter((day) => day.tokens > 0 || day.requests > 0);
    let currentStreak = 0;
    let longestStreak = 0;
    let running = 0;
    for (const day of days) {
      if (day.tokens > 0 || day.requests > 0) {
        running += 1;
        longestStreak = Math.max(longestStreak, running);
      } else {
        running = 0;
      }
    }
    for (let index = days.length - 1; index >= 0; index -= 1) {
      const day = days[index];
      if (day.tokens > 0 || day.requests > 0) currentStreak += 1;
      else if (day.day !== today) break;
    }
    const peak = days.reduce((best, day) => day.tokens > best.tokens ? day : best, { day: "", tokens: 0 });
    const longestTurn = state.turns.reduce((best, turn) => Number(turn.durationMs || 0) > Number(best.durationMs || 0) ? turn : best, { durationMs: 0 });
    const tools = Object.entries(state.tools)
      .map(([name, runs]) => ({ name, runs: Number(runs || 0) }))
      .sort((left, right) => right.runs - left.runs || left.name.localeCompare(right.name))
      .slice(0, 8);
    return {
      totalTokens,
      peakTokens: peak.tokens,
      peakDay: peak.day || null,
      taskCount: state.turns.length,
      activeDays: activeDays.length,
      currentStreak,
      longestStreak,
      longestTaskMs: Number(longestTurn.durationMs || 0),
      longestTaskLabel: durationLabel(longestTurn.durationMs),
      days,
      tools,
    };
  }
  cost(row, price = {}) {
    const input = Math.max(0, row.input - row.cached);
    return ((input * Number(price.input || 0)) + (row.cached * Number(price.cached || 0)) + ((row.output + row.reasoning) * Number(price.output || 0))) / 1_000_000;
  }
  setPrice(key, price = {}) {
    const state = this.state();
    state.prices[String(key)] = { input: Number(price.input) || 0, cached: Number(price.cached) || 0, output: Number(price.output) || 0 };
    this.write(state);
    return this.snapshot();
  }
}

module.exports = { UsageLedger, durationLabel, localDay, tokenTotal };
