const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-imagegen-"));
process.env.ONPEOPLE_WORKSPACE_ROOT = temporary;
process.env.ONPEOPLE_IMAGE_BASE_URL = "https://images.example.test/v1";
process.env.ONPEOPLE_IMAGE_API_KEY = "test-key";
process.env.ONPEOPLE_IMAGE_MODEL = "gpt-image-2";

const { generateImage, imageEndpoint, requestImagePayload, safeName, tools, withGenerationSlot } = require("../src/image-generation-mcp.cjs");

async function main() {
  assert.equal(imageEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/images/generations");
  assert.equal(imageEndpoint("https://api.openai.com/v1/images/generations"), "https://api.openai.com/v1/images/generations");
  assert.equal(safeName("../../poster: launch"), "poster-launch");
  assert.equal(tools[0].name, "image_generate");

  let request;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: png.toString("base64"), revised_prompt: "A clean launch poster" }], usage: { total_tokens: 12 } }),
    };
  };
  const result = await generateImage({
    prompt: "A clean launch poster",
    output: "../../launch-poster",
    size: "1024x1024",
    quality: "medium",
  }, { fetch });

  assert.equal(request.url, "https://images.example.test/v1/images/generations");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.ok(request.options.headers["Idempotency-Key"]);
  assert.equal(request.body.model, "gpt-image-2");
  assert.equal(request.body.prompt, "A clean launch poster");
  assert.equal(result.kind, "generated-image");
  assert.equal(result.images.length, 1);
  assert.equal(
    fs.realpathSync(path.dirname(result.images[0].output)),
    fs.realpathSync(path.join(temporary, ".onpeople", "generated-images")),
  );
  assert.equal(fs.readFileSync(result.images[0].output).compare(png), 0);
  assert.match(tools[0].description, /ONE tool call and set count/);

  let retryAttempts = 0;
  const idempotencyKeys = [];
  const retryPayload = await requestImagePayload({ model: "gpt-image-2", prompt: "retry" }, {
    apiKey: "retry-key",
    baseUrl: "https://images.example.test/v1",
    retryDelays: [0, 0],
    sleep: async () => {},
    fetch: async (_url, options) => {
      retryAttempts += 1;
      idempotencyKeys.push(options.headers["Idempotency-Key"]);
      if (retryAttempts === 1) {
        return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: { message: "temporarily unavailable" } }) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ b64_json: png.toString("base64") }] }) };
    },
  });
  assert.equal(retryAttempts, 2);
  assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
  assert.equal(retryPayload.data.length, 1);

  let networkAttempts = 0;
  await requestImagePayload({ model: "gpt-image-2", prompt: "network retry" }, {
    apiKey: "retry-key",
    baseUrl: "https://images.example.test/v1",
    retryDelays: [0, 0],
    sleep: async () => {},
    fetch: async () => {
      networkAttempts += 1;
      if (networkAttempts < 3) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ b64_json: png.toString("base64") }] }) };
    },
  });
  assert.equal(networkAttempts, 3);

  let active = 0;
  let maximumActive = 0;
  await Promise.all(Array.from({ length: 5 }, () => withGenerationSlot(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  })));
  assert.equal(maximumActive, 2);

  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.match(html, /data-capability="imagegen"/);
  assert.match(renderer, /renderGeneratedImagesFromToolItem/);
  assert.match(renderer, /复制图片/);
  assert.match(mainSource, /image_generation/);
  assert.match(mainSource, /tool_timeout_sec: 360/);
  assert.match(mainSource, /use one image_generate call with count/);
  assert.match(mainSource, /generated-image:read/);

  fs.rmSync(temporary, { recursive: true, force: true });
  console.log("image generation checks passed");
}

main().catch((error) => {
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {}
  console.error(error);
  process.exitCode = 1;
});
