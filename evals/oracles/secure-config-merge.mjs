import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workspace = process.argv[2];
const { mergeConfig } = await import(
  pathToFileURL(resolve(workspace, "src/config.js"))
);
const defaults = {
  server: { host: "localhost", port: 80 },
  tags: ["base"],
  enabled: true,
};
const overrides = { server: { port: 443 }, tags: ["prod"], enabled: undefined };
const merged = mergeConfig(defaults, overrides);
assert.deepEqual(merged, {
  server: { host: "localhost", port: 443 },
  tags: ["prod"],
  enabled: true,
});
assert.equal(Object.getPrototypeOf(merged), Object.prototype);
merged.server.host = "changed";
merged.tags.push("changed");
assert.equal(defaults.server.host, "localhost");
assert.deepEqual(overrides.tags, ["prod"]);

const malicious = JSON.parse(
  '{"safe":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"ok":1},"prototype":{"x":1}}',
);
const secured = mergeConfig({}, malicious);
assert.deepEqual(secured, { safe: { ok: 1 } });
assert.equal({}.polluted, undefined);
