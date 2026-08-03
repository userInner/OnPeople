const assert = require("node:assert/strict");
const http = require("node:http");
const { ModelGateway } = require("../src/model-gateway.cjs");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function collect(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, raw }));
    });
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

async function main() {
  let refreshCount = 0;
  let staleRequestCount = 0;
  let refreshedRequestCount = 0;
  const betaHeaders = new Map();
  const searchRequests = [];
  const upstream = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const authorization = request.headers.authorization || "";
      const requestBody = JSON.parse(raw);
      if (request.url.startsWith("/v1/alpha/search")) {
        searchRequests.push({
          authorization,
          body: requestBody,
          headers: request.headers,
          url: request.url,
        });
        response.writeHead(207, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, max-age=5",
        });
        response.end(JSON.stringify({ type: "computer_initialize_state", id: "search-result" }));
        return;
      }
      if (request.url === "/v1/responses") {
        betaHeaders.set(requestBody.model, request.headers["x-codex-beta-features"] || "");
        if (authorization.endsWith("stale")) {
          staleRequestCount += 1;
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "invalid key" } }));
          return;
        }
        if (authorization.endsWith("refreshed")) refreshedRequestCount += 1;
        else assert.equal(authorization.endsWith("gamma"), true);
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\ndata: [DONE]\n\n');
        return;
      }
      assert.equal(requestBody.stream, true);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: authorization.endsWith("alpha") ? "A" : "B" } }] })}\n\n`);
      setTimeout(() => {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "!" } }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } })}\n\n`);
        response.end("data: [DONE]\n\n");
      }, 10);
    });
  });
  const port = await listen(upstream);
  const gateway = new ModelGateway(null, {
    refreshSettings: async (settings) => {
      refreshCount += 1;
      assert.equal(settings.apiKey, "stale");
      return { ...settings, apiKey: "refreshed" };
    },
  });
  await gateway.start();
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  assert.throws(
    () => gateway.registerRoute("missing-onpeople-key", { type: "onpeople", baseUrl, apiKey: "", protocol: "responses" }),
    /credentials are unavailable/,
  );
  const routeA = gateway.registerRoute("thread-a", { baseUrl, apiKey: "alpha" });
  const routeB = gateway.registerRoute("thread-b", { baseUrl, apiKey: "beta" });
  const routeC = gateway.registerRoute("thread-c", {
    baseUrl,
    apiKey: "gamma",
    protocol: "responses",
    remoteCompactionV2: true,
  });
  const routeWithoutRemoteCompaction = gateway.registerRoute("thread-no-remote-compaction", {
    baseUrl,
    apiKey: "gamma",
    protocol: "responses",
    remoteCompactionV2: false,
  });
  const routeD = gateway.registerRoute("thread-d", {
    type: "onpeople",
    baseUrl,
    apiKey: "stale",
    protocol: "responses",
  });
  const requestBody = {
    model: "test",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
  };
  const [a, b, c, d] = await Promise.all([
    collect(`${routeA}/responses`, requestBody),
    collect(`${routeB}/responses`, requestBody),
    collect(`${routeC}/responses`, { ...requestBody, model: "remote-v2" }, {
      "x-codex-beta-features": "responses_websockets_v2,remote_compaction_v2",
    }),
    collect(`${routeD}/responses`, requestBody),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.match(a.raw, /"delta":"A"/);
  assert.doesNotMatch(a.raw, /"delta":"B"/);
  assert.match(b.raw, /"delta":"B"/);
  assert.match(a.raw, /response\.completed/);
  assert.match(a.raw, /"total_tokens":4/);
  assert.equal(c.status, 200);
  assert.match(c.raw, /response\.completed/);
  assert.match(betaHeaders.get("remote-v2"), /remote_compaction_v2/);
  await collect(`${routeWithoutRemoteCompaction}/responses`, { ...requestBody, model: "local-compact" }, {
    "x-codex-beta-features": "remote_compaction_v2",
  });
  assert.equal(betaHeaders.get("local-compact"), "", "non-OpenAI routes must not advertise remote compaction upstream");
  assert.equal(d.status, 200);
  assert.equal(refreshCount, 1);
  assert.equal(staleRequestCount, 1);
  assert.equal(refreshedRequestCount, 1);
  const reused = await collect(`${routeD}/responses`, requestBody);
  assert.equal(reused.status, 200);
  assert.equal(refreshCount, 1, "a refreshed route must reuse the repaired credential");
  assert.equal(staleRequestCount, 1);
  assert.equal(refreshedRequestCount, 2);
  const searchBody = { query: "OpenAI announcements", limit: 5 };
  const search = await collect(`${routeA}/alpha/search?locale=zh-CN`, searchBody, {
    "x-codex-turn-metadata": "thread=test;turn=search",
    originator: "onpeople",
  });
  assert.equal(search.status, 207);
  assert.match(search.headers["content-type"], /^application\/json/);
  assert.deepEqual(JSON.parse(search.raw), { type: "computer_initialize_state", id: "search-result" });
  assert.equal(searchRequests.length, 1);
  assert.equal(searchRequests[0].authorization, "Bearer alpha");
  assert.deepEqual(searchRequests[0].body, searchBody);
  assert.equal(searchRequests[0].url, "/v1/alpha/search?locale=zh-CN");
  assert.equal(searchRequests[0].headers["x-codex-turn-metadata"], "thread=test;turn=search");
  assert.equal(searchRequests[0].headers.originator, "onpeople");
  const missingSearchRoute = await collect(
    `${gateway.url}/routes/missing/v1/alpha/search`,
    searchBody,
  );
  assert.equal(missingSearchRoute.status, 404);
  assert.match(missingSearchRoute.raw, /Model route not found/);
  gateway.stop();
  upstream.close();
  process.stdout.write("model gateway checks passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
