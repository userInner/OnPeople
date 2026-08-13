# OnPeople evaluation harness

This directory contains deterministic repository tasks used to compare OnPeople
and Codex under the same task, model, permissions, and timeout. Fixtures are
copied to isolated temporary Git repositories. Hidden oracles run only after the
agent exits, so an agent cannot pass by editing the tests.

The core suite contains ten isolated tasks spanning boundary validation,
Unicode normalization, protocol parsing, async deduplication, path confinement,
secure configuration merging, TTL/LRU behavior, streaming UTF-8 decoding,
guarded pagination, and multi-file ledger logic.

Core cases use a five-hour hard limit per adapter run. The built-in OnPeople
adapter passes `--timeout 17940`, reserving the final minute for a graceful
`turn/interrupt` and process shutdown inside the same five-hour outer limit.
It also uses a 15-minute no-progress watchdog that ignores unrelated background
notifications. Independent OnPeople runs in the same workspace use a hashed,
path-redacted Sub2API affinity key so repeated prefixes can reach the same
upstream account. Codex is stopped by the same outer per-case deadline.

## Commands

```bash
npm run eval:list
npm run eval -- --adapter codex
npm run eval -- --adapter onpeople,codex --model gpt-5.6-sol --reasoning-effort high --output output/evals/latest.json
npm run eval -- --adapter onpeople,codex --repeat 3 --model gpt-5.6-sol --reasoning-effort high --output output/evals/repeated.json
```

For comparative runs, always pass `--model` and `--reasoning-effort`. The
built-in adapters then pin both products to the same model, workspace-write
sandbox, ephemeral session mode, task prompt, fixture, timeout, and hidden
oracle. A report without pinned model settings is useful for smoke testing but
not for a fair product comparison.

Use `--repeat 3` (or another value from 1 to 20) to measure stability instead
of relying on one stochastic run. The runner checkpoints the JSON report after
every completed execution, classifies failures, and aggregates mean, median,
P95, per-case pass rate, and structured Token usage. OnPeople reports also
aggregate transport health: WebSocket prewarm failures, sampling retries, HTTP
fallbacks, and `previous_response_not_found`. The built-in adapter uses
`--transport auto`, so WebSocket remains the preferred path while HTTPS remains
available after retry exhaustion.

Dollar or credit cost is not inferred because provider billing differs. Pass a
repository-local `--pricing` JSON file when rates are known:

```json
{
  "currency": "CNY",
  "adapters": {
    "onpeople": {
      "inputPerMillion": 0,
      "cachedInputPerMillion": 0,
      "outputPerMillion": 0
    }
  }
}
```

The cost formula treats cached input as a subset of input Tokens and does not
double-charge reasoning Tokens that are already included in output Tokens.

Both Codex and the source-tree OnPeople CLI have built-in default commands. Set
`ONPEOPLE_SUB2API_KEY` for the individual evaluation process:

```bash
npm run eval -- --adapter onpeople
```

The built-in evaluation adapter is ephemeral and never opens the desktop
Keychain or Credential Manager. Export `ONPEOPLE_SUB2API_KEY` in the process
that launches the evaluation; do not place it in a suite, command argv, report,
or repository file.

To benchmark a packaged or prebuilt CLI without Cargo startup overhead, override
the JSON argv array:

```bash
export ONPEOPLE_EVAL_COMMAND_JSON='["/absolute/path/to/onpeople","exec","--ephemeral","--sandbox","workspace-write","-C","{workspace}","-"]'
npm run eval -- --adapter onpeople,codex
```

The adapter must exit only after the turn finishes. Exit code zero means the
agent loop completed, not that the task passed; the independent oracle decides
task success. The runner passes `ONPEOPLE_EVAL_CASE_ID`,
`ONPEOPLE_EVAL_WORKSPACE`, and `ONPEOPLE_EVAL_PROMPT_FILE` as environment
variables. If `{promptFile}` is absent from the argv template, the prompt is
also sent on stdin.

Do not put credentials in suite files or command argv. Keep credentials in the
adapter's normal secure store or process environment.

Oracle checks execute code the agent just produced, so they run with a
scrubbed environment: only basic variables such as `PATH`, `HOME`, and locale
settings survive. Harness credentials (API keys, tokens) are visible to the
adapter process only, never to oracles. Oracles must not depend on custom
environment variables; everything they need arrives through argv tokens.
