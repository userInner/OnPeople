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

function collect(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: { "content-type": "application/json" },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, raw }));
    });
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

async function main() {
  let refreshCount = 0;
  let staleRequestCount = 0;
  let refreshedRequestCount = 0;
  const upstream = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const authorization = request.headers.authorization || "";
      const requestBody = JSON.parse(raw);
      if (request.url === "/v1/responses") {
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
  const routeC = gateway.registerRoute("thread-c", { baseUrl, apiKey: "gamma", protocol: "responses" });
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
    collect(`${routeC}/responses`, requestBody),
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
  assert.equal(d.status, 200);
  assert.equal(refreshCount, 1);
  assert.equal(staleRequestCount, 1);
  assert.equal(refreshedRequestCount, 1);
  const reused = await collect(`${routeD}/responses`, requestBody);
  assert.equal(reused.status, 200);
  assert.equal(refreshCount, 1, "a refreshed route must reuse the repaired credential");
  assert.equal(staleRequestCount, 1);
  assert.equal(refreshedRequestCount, 2);
  gateway.stop();
  upstream.close();
  process.stdout.write("model gateway checks passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
