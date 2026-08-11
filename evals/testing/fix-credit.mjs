import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const workspace = process.argv[2];
if (!workspace) throw new Error("workspace argument is required");
const target = join(workspace, "src/credit.js");
const source = await readFile(target, "utf8");
await writeFile(
  target,
  source
    .replace("amount <= 0", "amount < 0")
    .replace("must be positive", "must be non-negative"),
  "utf8",
);

console.log(
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 40,
      output_tokens: 20,
      reasoning_output_tokens: 5,
    },
  }),
);
console.log(
  JSON.stringify({
    type: "run.completed",
    transport: {
      requestedMode: "auto",
      websocketConfigured: true,
      prewarmFailures: 1,
      streamRetries: 2,
      httpFallbacks: 0,
      previousResponseNotFound: 0,
    },
  }),
);
