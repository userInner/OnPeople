"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
const pluginRoot = path.join(root, "plugins", "research-paper");
const serverPath = path.join(pluginRoot, "scripts", "research-sources-mcp.cjs");
const connector = require(serverPath);

async function main() {
  assert.equal(connector.normalizeDoi("https://doi.org/10.1000/ABC"), "10.1000/abc");
  await assert.rejects(connector.request("https://example.com/data"), /blocked upstream host/);
  const merged = connector.deduplicate([
    connector.record("crossref", { doi: "10.1000/test", title: "A Study" }),
    connector.record("openalex", { doi: "https://doi.org/10.1000/TEST", title: "A Study", abstract: "Abstract", fullTextUrl: "https://example.org/paper.pdf" }),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].matchedSources, ["crossref", "openalex"]);
  assert.equal(merged[0].evidenceLevel, "public-full-text-link");
  assert.equal(connector.tools.length, 7);
  assert.equal((await connector.sourceStatus()).authentication, "none");
  const summary = connector.contentSummary({
    query: "test", resultCount: 25, results: Array.from({ length: 25 }, (_, index) => ({ title: `Result ${index}` })),
    sources: [{ source: "crossref", status: "ok", resultCount: 25 }],
  });
  assert.match(summary, /structuredResultsAttached/);
  assert.doesNotMatch(summary, /Result 24/);
  assert.ok(summary.length < 1_000);

  const config = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.equal(config.mcpServers["research-sources"].command, "node");
  assert.equal(config.mcpServers["research-sources"].cwd, ".");

  const child = spawn(process.execPath, [serverPath], { cwd: pluginRoot, stdio: ["pipe", "pipe", "inherit"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "research_source_status", arguments: {} } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "resources/list", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "resources/templates/list", params: {} })}\n`);
  child.stdin.end();
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0);
  const messages = output.trim().split("\n").map(JSON.parse);
  const byId = new Map(messages.map((message) => [message.id, message]));
  assert.equal(byId.get(1).result.serverInfo.name, "onpeople-research-sources");
  assert.equal(byId.get(2).result.tools.length, 7);
  assert.equal(byId.get(3).result.structuredContent.access, "read-only");
  assert.deepEqual(byId.get(4).result.resources, []);
  assert.deepEqual(byId.get(5).result.resourceTemplates, []);
  console.log("research sources MCP checks passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
