const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteFile, readJsonWithBackup } = require("./atomic-file.cjs");
const { sanitize } = require("./local-memory.cjs");

const CHECKPOINT_SCHEMA_VERSION = 1;
const CHECKPOINT_MARKER = "<onpeople_context_checkpoint";
const DEFAULT_REBUILD_EVERY = 3;
const MAX_SNAPSHOTS = 8;
const MAX_RECENT_MESSAGES = 12;
const MAX_EVIDENCE_ITEMS = 16;

const CONSTRAINT_PATTERN = /(?:必须|务必|不得|禁止|不要|不能|不允许|不需要|只(?:能|要)|需要|保留|保持|避免|must\b|never\b|do\s+not\b|don't\b|only\b|keep\b|avoid\b)/i;
const REJECTION_PATTERN = /(?:^|[，。；：,.;:\s])(?:不对|不是|不要|不需要|不行|不能|别用|去掉|移除|删除|放弃|不采用|wrong\b|do\s+not\b|don't\b|remove\b|reject\b)/i;
const DECISION_PATTERN = /^(?:可以|好的|好吧|确认|同意|就这样|就这么|开始|嗯+好的|ok\b|okay\b|yes\b)|(?:正确方案|最终决定|就按这个|采用这个)/i;
const TEST_RESULT_PATTERN = /(?:\b(?:test|tests|check|checks)\b.{0,32}\b(?:passed|pass|ok|successful)\b|(?:测试|检查|校验).{0,24}(?:通过|成功)|exit[_ ]?code\s*[:=]\s*0|process exited with code 0)/i;

function cleanText(value, maximum = 1_200) {
  return sanitize(String(value || "")
    .replace(/<onpeople_context_checkpoint[\s\S]*?<\/onpeople_context_checkpoint>/gi, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n"), maximum);
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function visibleUserText(value) {
  const text = String(value || "").trim();
  if (!text || text.includes(CHECKPOINT_MARKER)) return "";
  if (text.startsWith("<environment_context>") || text.startsWith("<developer")) return "";
  if (text.startsWith("Another language model started to solve this problem and produced a summary")) return "";
  if (text.startsWith("<codex_internal_context")) {
    return text.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/)?.[1]?.trim() || "";
  }
  return text;
}

function evidence(sourceId, timestamp, text, extra = {}) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  return {
    sourceId: String(sourceId || "unknown"),
    timestamp: timestamp || null,
    text: cleaned,
    ...extra,
  };
}

function dedupeEvidence(items, maximum = MAX_EVIDENCE_ITEMS) {
  const seen = new Set();
  const result = [];
  for (const item of [...(items || [])].reverse()) {
    if (!item?.text) continue;
    const key = item.text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maximum) break;
  }
  return result.reverse();
}

function dedupeRecentMessages(items, maximum = MAX_RECENT_MESSAGES) {
  const seen = new Set();
  const result = [];
  for (const item of [...(items || [])].reverse()) {
    if (!item?.text) continue;
    const key = `${item.role || "unknown"}\0${item.text.replace(/\s+/g, " ").trim().toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maximum) break;
  }
  return result.reverse();
}

function parseJsonObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function outputText(payload) {
  const value = payload?.output ?? payload?.result ?? payload?.content ?? "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return ""; }
}

function extractPatchFiles(argumentsValue) {
  const parsed = parseJsonObject(argumentsValue);
  const patch = typeof parsed?.patch === "string" ? parsed.patch
    : typeof parsed?.input === "string" ? parsed.input
      : typeof argumentsValue === "string" ? argumentsValue : "";
  const files = [];
  for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const file = cleanText(match[1], 600);
    if (file) files.push(file);
  }
  return files;
}

function normalizeDirectiveSubject(text) {
  return String(text || "")
    .toLocaleLowerCase()
    .replace(/(?:必须|务必|不得|禁止|不要|不能|不允许|不需要|只(?:能|要)|需要|保留|保持|避免|可以|好的|确认|同意|去掉|移除|删除|放弃|不采用|must|never|do\s+not|don't|only|keep|avoid|remove|reject)/gi, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 120);
}

function detectConflicts(constraints, rejectedSolutions) {
  const conflicts = [];
  for (const positive of constraints || []) {
    if (REJECTION_PATTERN.test(positive.text)) continue;
    const positiveSubject = normalizeDirectiveSubject(positive.text);
    if (positiveSubject.length < 4) continue;
    for (const negative of rejectedSolutions || []) {
      if (positive.sourceId === negative.sourceId) continue;
      const negativeSubject = normalizeDirectiveSubject(negative.text);
      if (negativeSubject.length < 4) continue;
      const overlaps = positiveSubject === negativeSubject
        || (positiveSubject.length >= 8 && negativeSubject.includes(positiveSubject))
        || (negativeSubject.length >= 8 && positiveSubject.includes(negativeSubject));
      if (!overlaps) continue;
      conflicts.push({
        type: "directive-conflict",
        subject: positiveSubject.slice(0, 80),
        sources: [positive.sourceId, negative.sourceId],
        statements: [positive.text, negative.text],
      });
      if (conflicts.length >= 5) return conflicts;
    }
  }
  return conflicts;
}

function emptyEvidence() {
  return {
    goal: null,
    constraints: [],
    rejectedSolutions: [],
    confirmedDecisions: [],
    currentPlan: null,
    unresolvedQuestions: [],
    modifiedFiles: [],
    testResults: [],
    recentMessages: [],
    source: {
      bytes: 0,
      lines: 0,
      firstItemId: null,
      lastItemId: null,
      sha256: null,
      hashMode: "raw-v1",
      endedWithNewline: true,
    },
  };
}

function parseRolloutBuffer(buffer, options = {}) {
  const result = emptyEvidence();
  const lineOffset = Number(options.lineOffset || 0);
  const raw = buffer.toString("utf8");
  const lines = raw.split("\n");
  result.source.bytes = Number(options.totalBytes ?? buffer.length);
  result.source.lines = lineOffset + lines.filter((line) => line.trim()).length;
  result.source.endedWithNewline = raw.endsWith("\n") || !raw;
  let previousAssistant = options.previousAssistant || null;
  const captureUser = (rawText, sourceId, timestamp, includeRecent = true) => {
    const text = cleanText(visibleUserText(rawText));
    if (!text) return;
    const item = evidence(sourceId, timestamp, text, { role: "user" });
    if (includeRecent) result.recentMessages.push(item);
    if (CONSTRAINT_PATTERN.test(text)) result.constraints.push(evidence(sourceId, timestamp, text));
    if (REJECTION_PATTERN.test(text)) result.rejectedSolutions.push(evidence(sourceId, timestamp, text));
    if (DECISION_PATTERN.test(text)) {
      result.confirmedDecisions.push(evidence(sourceId, timestamp, text, {
        context: previousAssistant ? cleanText(previousAssistant.text, 800) : "",
        contextSourceId: previousAssistant?.sourceId || null,
      }));
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const payload = record.payload || {};
    const sourceId = String(payload.id || payload.call_id || payload.callId || `rollout:${lineOffset + index + 1}`);
    const timestamp = record.timestamp || null;
    if (!result.source.firstItemId) result.source.firstItemId = sourceId;
    result.source.lastItemId = sourceId;

    if (record.type === "event_msg" && payload.type === "thread_goal_updated" && payload.goal) {
      result.goal = {
        objective: cleanText(payload.goal.objective, 4_000),
        status: cleanText(payload.goal.status, 40) || null,
        sourceId,
        timestamp,
      };
      captureUser(payload.goal.objective, sourceId, timestamp, false);
      continue;
    }

    if (record.type === "event_msg" && payload.type === "user_message") {
      captureUser(payload.message, sourceId, timestamp);
      continue;
    }

    if (record.type !== "response_item") continue;
    if (payload.type === "message") {
      const rawText = contentText(payload.content);
      if (payload.role === "user") {
        captureUser(rawText, sourceId, timestamp);
      } else if (payload.role === "assistant") {
        const text = cleanText(rawText);
        if (!text) continue;
        previousAssistant = evidence(sourceId, timestamp, text, { role: "assistant" });
        result.recentMessages.push(previousAssistant);
      }
      continue;
    }

    if (new Set(["function_call", "custom_tool_call"]).has(payload.type)) {
      const name = String(payload.name || "");
      if (name.endsWith("update_plan")) {
        const parsed = parseJsonObject(payload.arguments || payload.input);
        if (Array.isArray(parsed?.plan)) {
          result.currentPlan = {
            sourceId,
            timestamp,
            explanation: cleanText(parsed.explanation, 1_000),
            steps: parsed.plan.slice(0, 20).map((item) => ({
              step: cleanText(item?.step, 800),
              status: cleanText(item?.status, 40) || "pending",
            })).filter((item) => item.step),
          };
        }
      }
      if (name.endsWith("apply_patch")) {
        for (const file of extractPatchFiles(payload.arguments || payload.input)) {
          result.modifiedFiles.push(evidence(sourceId, timestamp, file));
        }
      }
      continue;
    }

    if (new Set(["function_call_output", "custom_tool_call_output"]).has(payload.type)) {
      const text = cleanText(outputText(payload), 1_200);
      if (text && TEST_RESULT_PATTERN.test(text)) result.testResults.push(evidence(sourceId, timestamp, text));
    }
  }

  result.constraints = dedupeEvidence(result.constraints);
  result.rejectedSolutions = dedupeEvidence(result.rejectedSolutions);
  result.confirmedDecisions = dedupeEvidence(result.confirmedDecisions);
  result.modifiedFiles = dedupeEvidence(result.modifiedFiles, 40);
  result.testResults = dedupeEvidence(result.testResults, 10);
  result.recentMessages = dedupeRecentMessages(result.recentMessages);
  const lastMessage = result.recentMessages.at(-1);
  if (lastMessage?.role === "user" && /[?？]|(?:吗|呢|怎么|为何|为什么|能否|可不可以)[。！!]*$/i.test(lastMessage.text)) {
    result.unresolvedQuestions = [{ ...lastMessage }];
  }
  return result;
}

async function extractRolloutEvidence(rolloutPath, options = {}) {
  const stat = await fs.promises.stat(rolloutPath);
  const requestedStart = Math.max(0, Number(options.startByte || 0));
  const startByte = requestedStart <= stat.size ? requestedStart : 0;
  const buffer = await fs.promises.readFile(rolloutPath);
  const selected = startByte ? buffer.subarray(startByte) : buffer;
  const result = parseRolloutBuffer(selected, {
    lineOffset: startByte ? Number(options.lineOffset || 0) : 0,
    totalBytes: stat.size,
    previousAssistant: options.previousAssistant || null,
  });
  const incrementalHash = crypto.createHash("sha256").update(selected).digest("hex");
  result.source.sha256 = startByte && options.previousHash
    ? crypto.createHash("sha256").update(`${options.previousHash}\0${incrementalHash}`).digest("hex")
    : crypto.createHash("sha256").update(buffer).digest("hex");
  result.source.hashMode = startByte && options.previousHash ? "chain-v1" : "raw-v1";
  result.source.rolloutFile = path.basename(rolloutPath);
  result.source.startByte = startByte;
  return result;
}

function mergeEvidence(previous, incoming, mode) {
  if (!previous || mode === "full") return incoming;
  const merged = {
    goal: incoming.goal || previous.goal || null,
    constraints: dedupeEvidence([...(previous.constraints || []), ...(incoming.constraints || [])]),
    rejectedSolutions: dedupeEvidence([...(previous.rejectedSolutions || []), ...(incoming.rejectedSolutions || [])]),
    confirmedDecisions: dedupeEvidence([...(previous.confirmedDecisions || []), ...(incoming.confirmedDecisions || [])]),
    currentPlan: incoming.currentPlan || previous.currentPlan || null,
    unresolvedQuestions: incoming.unresolvedQuestions?.length ? incoming.unresolvedQuestions : [],
    modifiedFiles: dedupeEvidence([...(previous.modifiedFiles || []), ...(incoming.modifiedFiles || [])], 40),
    testResults: dedupeEvidence([...(previous.testResults || []), ...(incoming.testResults || [])], 10),
    recentMessages: dedupeRecentMessages([...(previous.recentMessages || []), ...(incoming.recentMessages || [])]),
    source: {
      ...incoming.source,
      firstItemId: previous.source?.firstItemId || incoming.source?.firstItemId || null,
      lines: incoming.source?.lines || previous.source?.lines || 0,
    },
  };
  return merged;
}

function goalFingerprint(goal) {
  return crypto.createHash("sha256").update(JSON.stringify({
    objective: goal?.objective || "",
    status: goal?.status || "",
  })).digest("hex");
}

function modelFingerprint(model) {
  return crypto.createHash("sha256").update(String(model || "")).digest("hex");
}

class ContextCheckpointStore {
  constructor(directoryPath, options = {}) {
    this.directoryPath = path.resolve(directoryPath);
    this.rebuildEvery = Math.max(1, Number(options.rebuildEvery || DEFAULT_REBUILD_EVERY));
    this.maxSnapshots = Math.max(2, Number(options.maxSnapshots || MAX_SNAPSHOTS));
    this.cache = new Map();
  }

  filePath(threadId) {
    const id = String(threadId || "").trim();
    if (!id) throw new Error("threadId is required");
    const readable = id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "thread";
    const hash = crypto.createHash("sha256").update(id).digest("hex").slice(0, 12);
    return path.join(this.directoryPath, `${readable}-${hash}.json`);
  }

  state(threadId) {
    const id = String(threadId || "").trim();
    if (this.cache.has(id)) return structuredClone(this.cache.get(id));
    const fallback = { version: CHECKPOINT_SCHEMA_VERSION, threadId: id, compactionCount: 0, currentRevision: 0, snapshots: [] };
    const parsed = readJsonWithBackup(this.filePath(id), fallback);
    const normalized = !parsed || parsed.version !== CHECKPOINT_SCHEMA_VERSION || parsed.threadId !== id || !Array.isArray(parsed.snapshots) ? fallback : {
      ...fallback,
      ...parsed,
      compactionCount: Math.max(0, Number(parsed.compactionCount || 0)),
      currentRevision: Math.max(0, Number(parsed.currentRevision || 0)),
      snapshots: parsed.snapshots.slice(-this.maxSnapshots),
    };
    this.cache.set(id, normalized);
    return structuredClone(normalized);
  }

  writeState(threadId, state) {
    const id = String(threadId || "").trim();
    atomicWriteFile(this.filePath(id), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    this.cache.set(id, structuredClone(state));
  }

  current(threadId) {
    return this.state(threadId).snapshots.at(-1) || null;
  }

  summary(threadId) {
    const state = this.state(threadId);
    const checkpoint = state.snapshots.at(-1) || null;
    if (!checkpoint) return { available: false, compactionCount: state.compactionCount, revision: 0 };
    return {
      available: true,
      revision: checkpoint.revision,
      compactionCount: state.compactionCount,
      updatedAt: checkpoint.createdAt,
      reason: checkpoint.reason,
      rebuildMode: checkpoint.rebuildMode,
      objective: checkpoint.goal?.objective || null,
      evidenceCount: (checkpoint.constraints?.length || 0) + (checkpoint.confirmedDecisions?.length || 0),
      conflictCount: checkpoint.conflicts?.length || 0,
      injected: checkpoint.injected === true,
      injectionError: checkpoint.injectionError || null,
    };
  }

  markInjection(threadId, revision, result = {}) {
    const state = this.state(threadId);
    const index = state.snapshots.findIndex((snapshot) => snapshot.revision === Number(revision));
    if (index < 0) return null;
    state.snapshots[index] = {
      ...state.snapshots[index],
      injected: result.injected === true,
      injectedAt: result.injected === true ? new Date().toISOString() : null,
      injectionError: result.error ? cleanText(result.error, 1_000) : null,
    };
    this.writeState(threadId, state);
    return state.snapshots[index];
  }

  async rebuild(input = {}) {
    const threadId = String(input.threadId || "").trim();
    if (!threadId) throw new Error("threadId is required");
    if (!input.rolloutPath) throw new Error("rolloutPath is required");
    const state = this.state(threadId);
    const previous = state.snapshots.at(-1) || null;
    const compactionCount = state.compactionCount + (input.compaction ? 1 : 0);
    const manualFull = input.reason === "manual-recalibration";
    const explicitFull = input.forceFull === true || manualFull;
    const hasAuthoritativeGoal = Object.hasOwn(input, "goal");
    const authoritativeGoal = hasAuthoritativeGoal ? input.goal : previous?.goal;
    const changedGoal = Boolean(previous && previous.goalFingerprint !== goalFingerprint(authoritativeGoal));
    const changedModel = Boolean(previous && previous.modelFingerprint !== modelFingerprint(input.model || previous.model));
    const periodicFull = Boolean(input.compaction && compactionCount % this.rebuildEvery === 0);
    let rebuildMode = !previous || explicitFull || changedGoal || changedModel || periodicFull ? "full" : "incremental";
    if (rebuildMode === "incremental" && previous.source?.endedWithNewline === false) rebuildMode = "full";
    const extracted = await extractRolloutEvidence(input.rolloutPath, rebuildMode === "incremental" ? {
      startByte: previous.source?.bytes || 0,
      lineOffset: previous.source?.lines || 0,
      previousHash: previous.source?.sha256 || null,
      previousAssistant: [...(previous.recentMessages || [])].reverse().find((item) => item.role === "assistant") || null,
    } : {});
    const merged = mergeEvidence(previous, extracted, rebuildMode);
    const goal = hasAuthoritativeGoal && input.goal ? {
      objective: cleanText(input.goal.objective, 4_000),
      status: cleanText(input.goal.status, 40) || null,
      sourceId: "thread/goal/get",
      timestamp: new Date().toISOString(),
    } : hasAuthoritativeGoal ? null : merged.goal;
    const revision = state.currentRevision + 1;
    const checkpoint = {
      version: CHECKPOINT_SCHEMA_VERSION,
      revision,
      threadId,
      createdAt: new Date().toISOString(),
      reason: cleanText(input.reason, 80) || "context-compaction",
      compactionCount,
      rebuildMode,
      model: cleanText(input.model, 160) || null,
      modelFingerprint: modelFingerprint(input.model),
      cwd: cleanText(input.cwd, 1_000) || null,
      goal,
      goalFingerprint: goalFingerprint(goal),
      constraints: merged.constraints,
      rejectedSolutions: merged.rejectedSolutions,
      confirmedDecisions: merged.confirmedDecisions,
      currentPlan: merged.currentPlan,
      unresolvedQuestions: merged.unresolvedQuestions,
      modifiedFiles: merged.modifiedFiles,
      testResults: merged.testResults,
      recentMessages: merged.recentMessages,
      conflicts: detectConflicts(merged.constraints, merged.rejectedSolutions),
      source: merged.source,
      injected: false,
      injectedAt: null,
      injectionError: null,
    };
    const nextState = {
      version: CHECKPOINT_SCHEMA_VERSION,
      threadId,
      compactionCount,
      currentRevision: revision,
      snapshots: [...state.snapshots, checkpoint].slice(-this.maxSnapshots),
    };
    this.writeState(threadId, nextState);
    return {
      checkpoint,
      shouldInject: rebuildMode === "full",
      trigger: manualFull ? "manual" : changedGoal ? "goal-change" : changedModel ? "model-change" : periodicFull ? "periodic" : explicitFull ? "forced" : "incremental",
    };
  }
}

function formatContextCheckpointItem(checkpoint) {
  const quoted = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const lines = [
    `<onpeople_context_checkpoint version="${CHECKPOINT_SCHEMA_VERSION}" revision="${Number(checkpoint?.revision || 0)}">`,
    "This is an evidence-backed continuity checkpoint rebuilt from the original rollout. It supplements Codex compaction; it does not replace newer explicit user instructions.",
    "Use only the highest checkpoint revision. Preserve quoted constraints exactly. If two cited statements conflict and the newest user instruction does not clearly resolve them, ask the user instead of choosing silently.",
  ];
  const section = (title, items, render = (item) => `[${quoted(item.sourceId)}] ${quoted(item.text)}`) => {
    if (!items?.length) return;
    lines.push(`\n## ${title}`);
    for (const item of items) lines.push(`- ${render(item)}`);
  };
  if (checkpoint?.goal?.objective) lines.push(`\n## Active goal\n- [${quoted(checkpoint.goal.sourceId || "goal")}] ${quoted(checkpoint.goal.objective)} (${quoted(checkpoint.goal.status || "unknown")})`);
  section("Hard constraints", checkpoint?.constraints);
  section("Rejected approaches", checkpoint?.rejectedSolutions);
  section("Confirmed decisions", checkpoint?.confirmedDecisions, (item) => {
    const context = item.context ? ` Approved proposal context [${quoted(item.contextSourceId || "assistant")}]: ${quoted(item.context)}` : "";
    return `[${quoted(item.sourceId)}] ${quoted(item.text)}${context}`;
  });
  if (checkpoint?.currentPlan?.steps?.length) {
    lines.push("\n## Current plan");
    for (const item of checkpoint.currentPlan.steps) lines.push(`- [${quoted(item.status)}] ${quoted(item.step)}`);
  }
  section("Unresolved questions", checkpoint?.unresolvedQuestions);
  section("Modified files", checkpoint?.modifiedFiles);
  section("Verified test results", checkpoint?.testResults);
  if (checkpoint?.conflicts?.length) {
    lines.push("\n## Conflicts requiring user resolution");
    for (const conflict of checkpoint.conflicts) lines.push(`- [${conflict.sources.map(quoted).join(" / ")}] ${conflict.statements.map(quoted).join("  ↔  ")}`);
  }
  section("Recent original messages", checkpoint?.recentMessages, (item) => `[${quoted(item.sourceId)}] ${quoted(item.role)}: ${quoted(item.text)}`);
  const closingTag = "</onpeople_context_checkpoint>";
  const body = lines.join("\n").slice(0, 12_000 - closingTag.length - 2);
  return {
    type: "message",
    role: "developer",
    content: [{ type: "input_text", text: `${body}\n${closingTag}` }],
  };
}

module.exports = {
  CHECKPOINT_MARKER,
  CHECKPOINT_SCHEMA_VERSION,
  ContextCheckpointStore,
  detectConflicts,
  extractRolloutEvidence,
  formatContextCheckpointItem,
  parseRolloutBuffer,
};
