const fs = require("node:fs");
const path = require("node:path");

function count(usage, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], usage);
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

class UsageLedger {
  constructor(filePath) { this.filePath = filePath; this.lastByThread = new Map(); }
  state() {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return { prices: value.prices || {}, buckets: value.buckets || {} };
    } catch { return { prices: {}, buckets: {} }; }
  }
  write(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`, { mode: 0o600 });
  }
  record({ threadId, provider = "unknown", model = "unknown", usage = {} }) {
    if (!threadId) return;
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
    if (!Object.values(delta).some(Boolean)) return;
    const state = this.state();
    const day = new Date().toISOString().slice(0, 10);
    const key = `${day}|${provider}|${model}`;
    const bucket = state.buckets[key] || { day, provider, model, input: 0, cached: 0, output: 0, reasoning: 0 };
    for (const field of Object.keys(delta)) bucket[field] += delta[field];
    state.buckets[key] = bucket;
    this.write(state);
  }
  snapshot() {
    const state = this.state();
    const rows = Object.values(state.buckets).sort((a, b) => b.day.localeCompare(a.day));
    return { prices: state.prices, rows: rows.map((row) => ({ ...row, estimatedCost: this.cost(row, state.prices[`${row.provider}|${row.model}`]) })) };
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

module.exports = { UsageLedger };
