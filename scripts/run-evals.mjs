import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return `Usage: node scripts/run-evals.mjs [options]

Options:
  --adapter NAME[,NAME]  Adapter(s) to run (default: onpeople)
  --suite PATH           Suite JSON (default: evals/suites/core.json)
  --case ID              Run one case only
  --model MODEL          Pin the same model for built-in adapters
  --reasoning-effort E   Pin the same reasoning effort for built-in adapters
  --repeat N             Run every adapter/case pair N times (default: 1)
  --pricing PATH         Optional per-adapter token pricing JSON
  --command-json JSON    Command argv for a single adapter override
  --output PATH          Write the complete JSON result
  --keep-workspaces      Preserve temporary workspaces
  --list                 List cases without running them
  --dry-run              Validate and show commands without spawning agents
  --help                 Show this message

Adapter commands are JSON argv arrays. Set ONPEOPLE_EVAL_COMMAND_JSON or
CODEX_EVAL_COMMAND_JSON. Tokens may contain {workspace}, {promptFile}, or {repo}.
The prompt is also written to stdin unless the command includes {promptFile}.`;
}

function parseArgs(argv) {
  const options = {
    adapters: ["onpeople"],
    suite: "evals/suites/core.json",
    caseId: null,
    model: null,
    reasoningEffort: null,
    repeat: 1,
    pricing: null,
    commandJson: null,
    output: null,
    keepWorkspaces: false,
    list: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--adapter")
      options.adapters = value().split(",").filter(Boolean);
    else if (arg === "--suite") options.suite = value();
    else if (arg === "--case") options.caseId = value();
    else if (arg === "--model") options.model = value();
    else if (arg === "--reasoning-effort") options.reasoningEffort = value();
    else if (arg === "--repeat") options.repeat = Number(value());
    else if (arg === "--pricing") options.pricing = value();
    else if (arg === "--command-json") options.commandJson = value();
    else if (arg === "--output") options.output = value();
    else if (arg === "--keep-workspaces") options.keepWorkspaces = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.adapters.length === 0)
    throw new Error("at least one adapter is required");
  if (options.commandJson && options.adapters.length !== 1) {
    throw new Error("--command-json can only be used with one adapter");
  }
  if (options.model !== null && !options.model.trim()) {
    throw new Error("--model cannot be empty");
  }
  if (
    options.reasoningEffort !== null &&
    !/^[a-z0-9][a-z0-9-]*$/i.test(options.reasoningEffort)
  ) {
    throw new Error("--reasoning-effort contains invalid characters");
  }
  if (
    !Number.isInteger(options.repeat) ||
    options.repeat < 1 ||
    options.repeat > 20
  ) {
    throw new Error("--repeat must be an integer from 1 to 20");
  }
  return options;
}

async function confinedPath(candidate, label, { mustExist = true } = {}) {
  const absolute = resolve(repositoryRoot, candidate);
  const rel = relative(repositoryRoot, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the repository: ${candidate}`);
  }
  if (mustExist) return realpath(absolute);
  return absolute;
}

async function loadSuite(path) {
  const suitePath = await confinedPath(path, "suite");
  const suite = JSON.parse(await readFile(suitePath, "utf8"));
  if (!suite || !Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error("suite must contain at least one case");
  }
  const ids = new Set();
  for (const testCase of suite.cases) {
    if (!testCase?.id || !/^[a-z0-9][a-z0-9-]*$/.test(testCase.id)) {
      throw new Error(`invalid case id: ${testCase?.id ?? "<missing>"}`);
    }
    if (ids.has(testCase.id))
      throw new Error(`duplicate case id: ${testCase.id}`);
    ids.add(testCase.id);
    if (!testCase.prompt?.trim())
      throw new Error(`case ${testCase.id} has no prompt`);
    if (!Array.isArray(testCase.checks) || testCase.checks.length === 0) {
      throw new Error(`case ${testCase.id} has no checks`);
    }
    const fixture = await confinedPath(
      testCase.fixture,
      `fixture for ${testCase.id}`,
    );
    if (!(await stat(fixture)).isDirectory()) {
      throw new Error(`fixture for ${testCase.id} is not a directory`);
    }
  }
  return { suite, suitePath };
}

async function loadPricing(path) {
  if (!path) return null;
  const pricingPath = await confinedPath(path, "pricing");
  const pricing = JSON.parse(await readFile(pricingPath, "utf8"));
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    throw new Error("pricing must be a JSON object");
  }
  if (typeof pricing.currency !== "string" || !pricing.currency.trim()) {
    throw new Error("pricing.currency must be a non-empty string");
  }
  if (!pricing.adapters || typeof pricing.adapters !== "object") {
    throw new Error("pricing.adapters must be an object");
  }
  for (const [adapter, rates] of Object.entries(pricing.adapters)) {
    for (const field of [
      "inputPerMillion",
      "cachedInputPerMillion",
      "outputPerMillion",
    ]) {
      if (!Number.isFinite(rates?.[field]) || rates[field] < 0) {
        throw new Error(
          `pricing.adapters.${adapter}.${field} must be non-negative`,
        );
      }
    }
  }
  return { ...pricing, path: pricingPath };
}

function parseCommand(value, label) {
  let command;
  try {
    command = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((item) => typeof item !== "string" || !item)
  ) {
    throw new Error(`${label} must be a non-empty JSON array of strings`);
  }
  return command;
}

function adapterCommand(adapter, override, options) {
  if (override) return parseCommand(override, "--command-json");
  const variable = `${adapter.toUpperCase().replaceAll("-", "_")}_EVAL_COMMAND_JSON`;
  const configured = process.env[variable];
  if (configured) return parseCommand(configured, variable);
  if (adapter === "onpeople") {
    const command = [
      "cargo",
      "run",
      "--quiet",
      "--manifest-path",
      "{repo}/Cargo.toml",
      "-p",
      "onpeople-cli",
      "--",
      "exec",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--approval-policy",
      "never",
      "--timeout",
      "17940",
      "--idle-timeout",
      "900",
      "--transport",
      "auto",
      "--json",
    ];
    if (options.model) command.push("--model", options.model);
    if (options.reasoningEffort) {
      command.push("--reasoning-effort", options.reasoningEffort);
    }
    command.push("-C", "{workspace}", "-");
    return command;
  }
  if (adapter === "codex") {
    const command = [
      "codex",
      "exec",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--json",
    ];
    if (options.model) command.push("--model", options.model);
    if (options.reasoningEffort) {
      command.push(
        "--config",
        `model_reasoning_effort="${options.reasoningEffort}"`,
      );
    }
    command.push("-C", "{workspace}", "-");
    return command;
  }
  throw new Error(
    `${variable} is required for adapter ${adapter}; see evals/README.md for the adapter contract`,
  );
}

function expandTokens(argv, values) {
  return argv.map((item) =>
    item
      .replaceAll("{workspace}", values.workspace)
      .replaceAll("{promptFile}", values.promptFile)
      .replaceAll("{repo}", repositoryRoot),
  );
}

function redactSensitiveText(value) {
  let redacted = String(value ?? "").replace(
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    "<redacted>",
  );
  for (const name of [
    "ONPEOPLE_SUB2API_KEY",
    "SUB2API_API_KEY",
    "ONPEOPLE_API_KEY",
    "OPENAI_API_KEY",
  ]) {
    const secret = process.env[name];
    if (secret && secret.length >= 8) {
      redacted = redacted.replaceAll(secret, "<redacted>");
    }
  }
  return redacted;
}

function numericField(source, ...names) {
  for (const name of names) {
    const value = source?.[name];
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const source = value.total ?? value.totalUsage ?? value;
  const inputTokens = numericField(source, "input_tokens", "inputTokens") ?? 0;
  const cachedInputTokens =
    numericField(source, "cached_input_tokens", "cachedInputTokens") ?? 0;
  const outputTokens =
    numericField(source, "output_tokens", "outputTokens") ?? 0;
  const reasoningOutputTokens =
    numericField(source, "reasoning_output_tokens", "reasoningOutputTokens") ??
    0;
  const hasUsage = [
    "input_tokens",
    "inputTokens",
    "cached_input_tokens",
    "cachedInputTokens",
    "output_tokens",
    "outputTokens",
    "reasoning_output_tokens",
    "reasoningOutputTokens",
    "total_tokens",
    "totalTokens",
  ].some((name) => Number.isFinite(source[name]));
  if (!hasUsage) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens:
      numericField(source, "total_tokens", "totalTokens") ??
      inputTokens + outputTokens,
  };
}

function extractUsage(stdout) {
  let usage = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const candidates = [
      event.usage,
      event.tokenUsage,
      event.params?.tokenUsage,
      event.event?.params?.tokenUsage,
      event.event?.params?.usage,
      event.event?.params?.turn?.usage,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeUsage(candidate);
      if (normalized) usage = normalized;
    }
  }
  return usage;
}

function extractRunError(stdout) {
  let error = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "run.failed" && event.error) error = event.error;
    } catch {
      // Custom adapters may mix human-readable output with JSONL.
    }
  }
  return error;
}

function normalizeTransport(value, source) {
  if (!value || typeof value !== "object") return null;
  return {
    source,
    requestedMode:
      typeof value.requestedMode === "string" ? value.requestedMode : null,
    websocketConfigured:
      typeof value.websocketConfigured === "boolean"
        ? value.websocketConfigured
        : null,
    prewarmFailures:
      numericField(value, "prewarmFailures", "prewarm_failures") ?? 0,
    streamRetries: numericField(value, "streamRetries", "stream_retries") ?? 0,
    httpFallbacks: numericField(value, "httpFallbacks", "http_fallbacks") ?? 0,
    previousResponseNotFound:
      numericField(
        value,
        "previousResponseNotFound",
        "previous_response_not_found",
      ) ?? 0,
  };
}

function extractTransport(stdout) {
  const inferred = {
    source: "inferred",
    requestedMode: null,
    websocketConfigured: null,
    prewarmFailures: 0,
    streamRetries: 0,
    httpFallbacks: 0,
    previousResponseNotFound: 0,
  };
  let authoritative = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "run.completed" && event.transport) {
      authoritative = normalizeTransport(event.transport, "run.completed");
      continue;
    }
    const serverLog =
      event.type === "app_server.notification" &&
      event.event?.type === "server-log" &&
      typeof event.event.text === "string"
        ? event.event.text
        : null;
    if (!serverLog) continue;
    if (serverLog.includes("startup websocket prewarm setup failed")) {
      inferred.prewarmFailures += 1;
    }
    if (serverLog.includes("stream disconnected - retrying sampling request")) {
      inferred.streamRetries += 1;
    }
    if (serverLog.toLowerCase().includes("falling back to http")) {
      inferred.httpFallbacks += 1;
    }
    if (serverLog.includes("previous_response_not_found")) {
      inferred.previousResponseNotFound += 1;
    }
  }
  return authoritative ?? inferred;
}

function estimateCost(usage, rates) {
  if (!usage || !rates) return null;
  const cachedInput = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const uncachedInput = usage.inputTokens - cachedInput;
  return (
    (uncachedInput * rates.inputPerMillion +
      cachedInput * rates.cachedInputPerMillion +
      usage.outputTokens * rates.outputPerMillion) /
    1_000_000
  );
}

function classifyFailure(result) {
  if (result.passed) return null;
  if (!result.agent) return { stage: "agent", category: "not_run" };
  if (result.agent.timedOut) {
    return { stage: "agent", category: "agent_timeout" };
  }
  if (result.agent.exitCode !== 0) {
    const timeoutKind = result.agent.error?.context?.timeoutKind;
    if (result.agent.error?.code === "RUNTIME_TIMEOUT") {
      return {
        stage: "agent",
        category:
          timeoutKind === "idle" ? "agent_idle_timeout" : "agent_hard_timeout",
        timeoutKind: timeoutKind ?? "hard",
      };
    }
    return {
      stage: "agent",
      category: "agent_error",
      exitCode: result.agent.exitCode,
      signal: result.agent.signal,
    };
  }
  const failedCheck = result.checks.find(
    (check) => check.exitCode !== 0 || check.timedOut,
  );
  if (!failedCheck) return { stage: "unknown", category: "unknown" };
  if (failedCheck.timedOut) {
    return {
      stage: "oracle",
      category: "oracle_timeout",
      check: failedCheck.name,
    };
  }
  const detail = `${failedCheck.stderr}\n${failedCheck.stdout}`;
  const kind = /AssertionError/.test(detail)
    ? "assertion"
    : /SyntaxError/.test(detail)
      ? "syntax"
      : "runtime";
  return {
    stage: "oracle",
    category: "oracle_failure",
    kind,
    check: failedCheck.name,
  };
}

function runCommand(argv, { cwd, stdin, timeoutMs, env = {} }) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: null,
        signal: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(`${stderr}${error.message}`),
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(stderr),
      });
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

async function initializeWorkspace(testCase, adapter, keepWorkspaces) {
  const parent = await mkdtemp(
    join(tmpdir(), `onpeople-eval-${testCase.id}-${adapter}-`),
  );
  const workspace = join(parent, "workspace");
  const fixture = await confinedPath(
    testCase.fixture,
    `fixture for ${testCase.id}`,
  );
  await cp(fixture, workspace, {
    recursive: true,
    errorOnExist: true,
    verbatimSymlinks: true,
  });
  const promptFile = join(parent, "prompt.md");
  await writeFile(promptFile, `${testCase.prompt.trim()}\n`, "utf8");
  const gitInit = await runCommand(["git", "init", "--quiet"], {
    cwd: workspace,
    timeoutMs: 10_000,
  });
  if (gitInit.exitCode !== 0) {
    if (!keepWorkspaces) await rm(parent, { recursive: true, force: true });
    throw new Error(
      `failed to initialize fixture repository: ${gitInit.stderr}`,
    );
  }
  await runCommand(["git", "add", "."], { cwd: workspace, timeoutMs: 10_000 });
  return { parent, workspace, promptFile };
}

async function runCase(testCase, adapter, commandTemplate, options, iteration) {
  const paths = await initializeWorkspace(
    testCase,
    adapter,
    options.keepWorkspaces,
  );
  const values = { workspace: paths.workspace, promptFile: paths.promptFile };
  const command = expandTokens(commandTemplate, values);
  const usesPromptFile = commandTemplate.some((item) =>
    item.includes("{promptFile}"),
  );
  const result = {
    adapter,
    caseId: testCase.id,
    iteration,
    repeat: options.repeat,
    title: testCase.title ?? testCase.id,
    workspace: options.keepWorkspaces ? paths.workspace : null,
    command: command.map(redactSensitiveText),
    passed: false,
    dryRun: options.dryRun,
    agent: null,
    checks: [],
  };
  try {
    if (options.dryRun) return result;
    result.agent = await runCommand(command, {
      cwd: paths.workspace,
      stdin: usesPromptFile ? undefined : `${testCase.prompt.trim()}\n`,
      timeoutMs: testCase.timeoutMs ?? 600_000,
      env: {
        ONPEOPLE_EVAL_CASE_ID: testCase.id,
        ONPEOPLE_EVAL_WORKSPACE: paths.workspace,
        ONPEOPLE_EVAL_PROMPT_FILE: paths.promptFile,
      },
    });
    result.agent.usage = extractUsage(result.agent.stdout);
    result.agent.error = extractRunError(result.agent.stdout);
    result.agent.transport = extractTransport(result.agent.stdout);
    result.agent.estimatedCost = estimateCost(
      result.agent.usage,
      options.pricingData?.adapters?.[adapter],
    );
    for (const check of testCase.checks) {
      const argv = expandTokens(check.command, values);
      const checkResult = await runCommand(argv, {
        cwd: paths.workspace,
        timeoutMs: check.timeoutMs ?? 60_000,
      });
      result.checks.push({
        name: check.name,
        command: argv.map(redactSensitiveText),
        ...checkResult,
      });
    }
    result.passed =
      result.agent.exitCode === 0 &&
      !result.agent.timedOut &&
      result.checks.every((check) => check.exitCode === 0 && !check.timedOut);
    result.failure = classifyFailure(result);
    return result;
  } finally {
    if (!options.keepWorkspaces)
      await rm(paths.parent, { recursive: true, force: true });
  }
}

function printResult(result) {
  const repetition = ` [${result.iteration}/${result.repeat}]`;
  if (result.dryRun) {
    process.stdout.write(
      `DRY  ${result.adapter.padEnd(10)} ${result.caseId}${repetition}  ${JSON.stringify(result.command)}\n`,
    );
    return;
  }
  const state = result.passed ? "PASS" : "FAIL";
  const duration = result.agent
    ? `${(result.agent.durationMs / 1000).toFixed(1)}s`
    : "not-run";
  process.stdout.write(
    `${state} ${result.adapter.padEnd(10)} ${result.caseId}${repetition}  ${duration}\n`,
  );
  const transport = result.agent?.transport;
  if (
    transport &&
    (transport.prewarmFailures > 0 ||
      transport.streamRetries > 0 ||
      transport.httpFallbacks > 0)
  ) {
    process.stdout.write(
      `     transport prewarm=${transport.prewarmFailures} retries=${transport.streamRetries} fallbacks=${transport.httpFallbacks}\n`,
    );
  }
  if (!result.passed) {
    const failure =
      result.agent?.exitCode !== 0 || result.agent?.timedOut
        ? result.agent
        : (result.checks.find(
            (check) => check.exitCode !== 0 || check.timedOut,
          ) ?? result.agent);
    const detail =
      failure?.stderr?.trim() ||
      failure?.stdout?.trim() ||
      "adapter did not complete";
    process.stdout.write(`${detail.slice(0, 2_000)}\n`);
  }
}

function durationStats(results) {
  const values = results
    .map((result) => result.agent?.durationMs)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return {
      durationMs: 0,
      meanDurationMs: null,
      medianDurationMs: null,
      p95DurationMs: null,
    };
  }
  const durationMs = values.reduce((total, value) => total + value, 0);
  const middle = Math.floor(values.length / 2);
  const medianDurationMs =
    values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle];
  return {
    durationMs,
    meanDurationMs: durationMs / values.length,
    medianDurationMs,
    p95DurationMs: values[Math.ceil(values.length * 0.95) - 1],
  };
}

function usageStats(results, currency) {
  const totals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
  let runsWithUsage = 0;
  let runsWithCost = 0;
  let estimatedCost = 0;
  for (const result of results) {
    const usage = result.agent?.usage;
    if (usage) {
      runsWithUsage += 1;
      for (const field of Object.keys(totals)) totals[field] += usage[field];
    }
    const cost = result.agent?.estimatedCost;
    if (Number.isFinite(cost)) {
      runsWithCost += 1;
      estimatedCost += cost;
    }
  }
  return {
    ...totals,
    runsWithUsage,
    usageCoverage: results.length === 0 ? null : runsWithUsage / results.length,
    runsWithCost,
    costCoverage: results.length === 0 ? null : runsWithCost / results.length,
    estimatedCost: runsWithCost === 0 ? null : estimatedCost,
    currency: runsWithCost === 0 ? null : currency,
  };
}

function failureStats(results) {
  const categories = {};
  for (const result of results) {
    const category = result.failure?.category;
    if (category) categories[category] = (categories[category] ?? 0) + 1;
  }
  return categories;
}

function transportStats(results) {
  const totals = {
    prewarmFailures: 0,
    streamRetries: 0,
    httpFallbacks: 0,
    previousResponseNotFound: 0,
  };
  let runsWithTransport = 0;
  let degradedRuns = 0;
  let websocketConfiguredRuns = 0;
  for (const result of results) {
    const transport = result.agent?.transport;
    if (!transport) continue;
    runsWithTransport += 1;
    if (transport.websocketConfigured === true) websocketConfiguredRuns += 1;
    for (const field of Object.keys(totals))
      totals[field] += transport[field] ?? 0;
    if (
      transport.prewarmFailures > 0 ||
      transport.streamRetries > 0 ||
      transport.httpFallbacks > 0
    ) {
      degradedRuns += 1;
    }
  }
  return {
    ...totals,
    runsWithTransport,
    degradedRuns,
    websocketConfiguredRuns,
  };
}

function summarizeResults({
  suite,
  suitePath,
  startedAt,
  results,
  options,
  inProgress,
}) {
  const completed = results.filter((result) => !result.dryRun);
  const currency = options.pricingData?.currency ?? null;
  const adapters = Object.fromEntries(
    options.adapters.map((adapter) => {
      const adapterResults = completed.filter(
        (result) => result.adapter === adapter,
      );
      const passed = adapterResults.filter((result) => result.passed).length;
      return [
        adapter,
        {
          total: adapterResults.length,
          passed,
          failed: adapterResults.length - passed,
          passRate:
            adapterResults.length === 0 ? null : passed / adapterResults.length,
          ...durationStats(adapterResults),
          usage: usageStats(adapterResults, currency),
          transport: transportStats(adapterResults),
          failures: failureStats(adapterResults),
        },
      ];
    }),
  );
  const caseSummaries = suite.cases
    .filter((testCase) =>
      options.caseId ? testCase.id === options.caseId : true,
    )
    .map((testCase) => ({
      caseId: testCase.id,
      adapters: Object.fromEntries(
        options.adapters.map((adapter) => {
          const caseResults = completed.filter(
            (result) =>
              result.adapter === adapter && result.caseId === testCase.id,
          );
          const passed = caseResults.filter((result) => result.passed).length;
          return [
            adapter,
            {
              runs: caseResults.length,
              passed,
              passRate:
                caseResults.length === 0 ? null : passed / caseResults.length,
              ...durationStats(caseResults),
              usage: usageStats(caseResults, currency),
              transport: transportStats(caseResults),
              failures: failureStats(caseResults),
            },
          ];
        }),
      ),
    }));
  return {
    suite: suite.name ?? basename(suitePath),
    suitePath,
    startedAt,
    completedAt: new Date().toISOString(),
    inProgress,
    expectedTotal:
      caseSummaries.length * options.adapters.length * options.repeat,
    total: completed.length,
    passed: completed.filter((result) => result.passed).length,
    failed: completed.filter((result) => !result.passed).length,
    settings: {
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      repeat: options.repeat,
      sandbox: "workspace-write",
      ephemeral: true,
      structuredOutput: true,
      timeoutPolicy: "per-case",
      maxCaseTimeoutMs: Math.max(
        ...suite.cases
          .filter((testCase) =>
            options.caseId ? testCase.id === options.caseId : true,
          )
          .map((testCase) => testCase.timeoutMs ?? 600_000),
      ),
      onpeopleIdleTimeoutMs: 900_000,
      schedule: "alternating-by-case-and-iteration",
      pricing: options.pricingData
        ? {
            currency: options.pricingData.currency,
            adapters: options.pricingData.adapters,
          }
        : null,
    },
    failures: failureStats(completed),
    adapters,
    cases: caseSummaries,
    results,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { suite, suitePath } = await loadSuite(options.suite);
  options.pricingData = await loadPricing(options.pricing);
  const cases = options.caseId
    ? suite.cases.filter((testCase) => testCase.id === options.caseId)
    : suite.cases;
  if (cases.length === 0) throw new Error(`unknown case: ${options.caseId}`);
  if (options.list) {
    for (const testCase of cases)
      process.stdout.write(`${testCase.id}\t${testCase.title ?? ""}\n`);
    return;
  }
  const startedAt = new Date().toISOString();
  const results = [];
  const outputPath = options.output
    ? await confinedPath(options.output, "output", { mustExist: false })
    : null;
  if (outputPath) await mkdir(dirname(outputPath), { recursive: true });
  const commands = new Map(
    options.adapters.map((adapter) => [
      adapter,
      adapterCommand(adapter, options.commandJson, options),
    ]),
  );
  for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const testCase = cases[caseIndex];
      const scheduledAdapters =
        (caseIndex + iteration - 1) % 2 === 0
          ? options.adapters
          : options.adapters.toReversed();
      for (const adapter of scheduledAdapters) {
        const command = commands.get(adapter);
        const result = await runCase(
          testCase,
          adapter,
          command,
          options,
          iteration,
        );
        results.push(result);
        printResult(result);
        if (outputPath && !options.dryRun) {
          const checkpoint = summarizeResults({
            suite,
            suitePath,
            startedAt,
            results,
            options,
            inProgress: true,
          });
          await writeFile(
            outputPath,
            `${JSON.stringify(checkpoint, null, 2)}\n`,
            "utf8",
          );
        }
      }
    }
  }
  const completed = results.filter((result) => !result.dryRun);
  const summary = summarizeResults({
    suite,
    suitePath,
    startedAt,
    results,
    options,
    inProgress: false,
  });
  if (outputPath) {
    await writeFile(
      outputPath,
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );
  }
  if (completed.length > 0) {
    process.stdout.write(
      `\n${summary.passed}/${summary.total} evaluations passed\n`,
    );
  }
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`eval: ${error.message}\n`);
  process.exitCode = 1;
});
