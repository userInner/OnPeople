const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertSafeTarget, parseArgs, planCleanup } = require("./clean-release-artifacts.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-clean-release-"));
try {
  const files = [
    "release/OnPeople-0.29.22-macos-arm64.zip",
    "release/OnPeople-0.29.23-macos-arm64.zip",
    "release/OnPeople-0.29.24-macos-arm64.zip",
    "release/OnPeople-0.29.24-macos-arm64-signed-unnotarized.dmg",
    "release/windows/latest.yml",
    "release/windows/win-unpacked/OnPeople.exe",
    ".embedded-runtime/codex",
    "node_modules/example/index.js",
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "fixture");
  }

  const defaultPlan = planCleanup(root);
  const targets = defaultPlan.candidates.map(({ target }) => path.relative(root, target));
  assert.deepEqual(defaultPlan.retainedVersions, ["0.29.24", "0.29.23"]);
  assert.ok(targets.includes("release/OnPeople-0.29.22-macos-arm64.zip"));
  assert.ok(targets.includes("release/OnPeople-0.29.24-macos-arm64-signed-unnotarized.dmg"));
  assert.ok(targets.includes("release/windows/win-unpacked"));
  assert.ok(!targets.includes("release/OnPeople-0.29.24-macos-arm64.zip"));
  assert.ok(!targets.includes(".embedded-runtime"));

  const fullPlan = planCleanup(root, { keep: 1, includeRuntime: true, includeDependencies: true });
  const fullTargets = fullPlan.candidates.map(({ target }) => path.relative(root, target));
  assert.ok(fullTargets.includes(".embedded-runtime"));
  assert.ok(fullTargets.includes("node_modules"));
  assert.throws(() => assertSafeTarget(root, path.join(root, "src")), /outside cleanup roots/);
  assert.deepEqual(parseArgs(["--apply", "--keep", "3", "--include-runtime"]), {
    apply: true,
    includeRuntime: true,
    includeDependencies: false,
    keep: 3,
  });
  assert.throws(() => parseArgs(["--keep", "0"]), /at least 1/);
  console.log("Release artifact cleanup checks passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
