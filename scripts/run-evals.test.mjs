import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("evaluation runner executes an adapter and independent oracle", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "onpeople-eval-test-"));
  const relativeOutput = `output/eval-harness-${process.pid}.json`;
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-evals.mjs",
        "--adapter",
        "fixture",
        "--case",
        "credit-boundary",
        "--command-json",
        JSON.stringify([
          process.execPath,
          "{repo}/evals/testing/fix-credit.mjs",
          "{workspace}",
        ]),
        "--output",
        relativeOutput,
        "--repeat",
        "2",
        "--pricing",
        "evals/testing/pricing.json",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PASS fixture\s+credit-boundary/);
    const report = JSON.parse(
      await readFile(join(repositoryRoot, relativeOutput), "utf8"),
    );
    assert.equal(report.inProgress, false);
    assert.equal(report.expectedTotal, 2);
    assert.equal(report.total, 2);
    assert.equal(report.passed, 2);
    assert.equal(report.results[0].workspace, null);
    assert.equal(report.results[0].checks[0].exitCode, 0);
    assert.equal(report.results[0].iteration, 1);
    assert.deepEqual(report.results[0].agent.usage, {
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 120,
    });
    assert.deepEqual(report.results[0].agent.transport, {
      source: "run.completed",
      requestedMode: "auto",
      websocketConfigured: true,
      prewarmFailures: 1,
      streamRetries: 2,
      httpFallbacks: 0,
      previousResponseNotFound: 0,
    });
    assert.equal(report.adapters.fixture.usage.runsWithUsage, 2);
    assert.equal(report.adapters.fixture.usage.inputTokens, 200);
    assert.equal(report.adapters.fixture.usage.estimatedCost, 0.00256);
    assert.equal(report.adapters.fixture.transport.prewarmFailures, 2);
    assert.equal(report.adapters.fixture.transport.streamRetries, 4);
    assert.equal(report.adapters.fixture.transport.degradedRuns, 2);
    assert.equal(report.adapters.fixture.transport.websocketConfiguredRuns, 2);
    assert.equal(report.cases[0].adapters.fixture.passRate, 1);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
    await rm(join(repositoryRoot, relativeOutput), { force: true });
  }
});

test("evaluation runner validates suites without requiring an adapter", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-evals.mjs", "--list"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /credit-boundary/);
  assert.match(result.stdout, /unique-slug/);
  assert.match(result.stdout, /stream-line-decoder/);
  assert.match(result.stdout, /ledger-reducer/);
});

test("built-in adapters use explicit writable ephemeral headless commands", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-evals.mjs",
      "--adapter",
      "onpeople,codex",
      "--case",
      "credit-boundary",
      "--model",
      "gpt-5.6-sol",
      "--reasoning-effort",
      "high",
      "--dry-run",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /onpeople-cli/);
  assert.match(result.stdout, /workspace-write/);
  assert.match(result.stdout, /--ephemeral/);
  assert.match(result.stdout, /--json/);
  assert.match(result.stdout, /--timeout/);
  assert.match(result.stdout, /17940/);
  assert.match(result.stdout, /--idle-timeout/);
  assert.match(result.stdout, /900/);
  assert.match(result.stdout, /--transport/);
  assert.match(result.stdout, /auto/);
  assert.match(result.stdout, /gpt-5\.6-sol/);
  assert.match(result.stdout, /model_reasoning_effort/);
  assert.doesNotMatch(result.stdout, /--full-auto/);
});

test("oracle checks run without harness credentials in the environment", async () => {
  const relativeSuite = `output/eval-env-suite-${process.pid}.json`;
  const suitePath = join(repositoryRoot, relativeSuite);
  const checkScript = [
    'const forbidden = ["ONPEOPLE_API_KEY", "ONPEOPLE_SUB2API_KEY", "SUB2API_API_KEY", "OPENAI_API_KEY", "EVAL_TEST_CANARY"];',
    "const leaked = forbidden.filter((name) => process.env[name] !== undefined);",
    'if (leaked.length > 0) { console.error(`oracle env leaked: ${leaked.join(",")}`); process.exit(1); }',
    'if (!process.env.PATH) { console.error("oracle env is missing PATH"); process.exit(1); }',
  ].join("\n");
  try {
    await mkdir(dirname(suitePath), { recursive: true });
    await writeFile(
      suitePath,
      JSON.stringify({
        name: "env-scrub",
        cases: [
          {
            id: "env-scrub",
            title: "oracle environment is scrubbed",
            prompt: "no-op agent for the environment scrubbing test",
            fixture: "evals/fixtures/credit-boundary",
            checks: [
              {
                name: "env-clean",
                command: [process.execPath, "-e", checkScript],
              },
            ],
          },
        ],
      }),
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-evals.mjs",
        "--adapter",
        "fixture",
        "--suite",
        relativeSuite,
        "--command-json",
        JSON.stringify([process.execPath, "-e", "process.exit(0)"]),
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ONPEOPLE_API_KEY: "sk-eval-test-secret-value-000000",
          EVAL_TEST_CANARY: "1",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PASS fixture\s+env-scrub/);
  } finally {
    await rm(suitePath, { force: true });
  }
});

test("evaluation reports redact API-key-shaped output", async () => {
  const relativeOutput = `output/eval-redaction-${process.pid}.json`;
  const fakeKey = `sk-${"x".repeat(40)}`;
  try {
    spawnSync(
      process.execPath,
      [
        "scripts/run-evals.mjs",
        "--adapter",
        "fixture",
        "--case",
        "credit-boundary",
        "--command-json",
        JSON.stringify([process.execPath, "-e", `console.log('${fakeKey}')`]),
        "--output",
        relativeOutput,
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    const reportText = await readFile(
      join(repositoryRoot, relativeOutput),
      "utf8",
    );
    assert.doesNotMatch(reportText, new RegExp(fakeKey));
    assert.match(reportText, /<redacted>/);
  } finally {
    await rm(join(repositoryRoot, relativeOutput), { force: true });
  }
});
