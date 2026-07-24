const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");

const workspaceRoot = path.resolve(process.env.ONPEOPLE_WORKSPACE_ROOT || process.cwd());
const baseUrl = String(process.env.ONPEOPLE_IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const apiKey = String(process.env.ONPEOPLE_IMAGE_API_KEY || "");
const defaultModel = String(process.env.ONPEOPLE_IMAGE_MODEL || "gpt-image-2");
const outputRoot = path.join(workspaceRoot, ".onpeople", "generated-images");
const supportedFormats = new Set(["png", "jpeg", "webp"]);
const supportedQualities = new Set(["auto", "low", "medium", "high"]);
const supportedBackgrounds = new Set(["auto", "opaque", "transparent"]);
const MAX_IMAGE_BYTES = 48 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000];
const MAX_CONCURRENT_GENERATIONS = 2;
let activeGenerations = 0;
const generationWaiters = [];

function imageEndpoint(value = baseUrl) {
  const parsed = new URL(String(value || ""));
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Image API Base URL must use HTTP(S)");
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  if (/\/images\/generations$/i.test(cleanPath)) return parsed.toString().replace(/\/+$/, "");
  parsed.pathname = `${cleanPath}/images/generations`.replace(/\/{2,}/g, "/");
  return parsed.toString();
}

function safeName(value, fallback = "image") {
  const clean = String(value || fallback)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 72);
  return clean || fallback;
}

function outputPath(requested, format, index = 0) {
  const extension = format === "jpeg" ? ".jpg" : `.${format}`;
  const suffix = index ? `-${index + 1}` : "";
  const defaultName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const requestedName = safeName(path.basename(String(requested || defaultName), path.extname(String(requested || ""))), defaultName);
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  return path.join(outputRoot, `${requestedName}${suffix}${extension}`);
}

function decodeImage(value) {
  const encoded = String(value || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  if (!encoded || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) throw new Error("Image provider returned invalid Base64 data");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error("Generated image is empty or exceeds the 48 MB safety limit");
  return buffer;
}

function providerError(status, payload) {
  const message = payload?.error?.message || payload?.message || `Image provider returned HTTP ${status}`;
  const code = payload?.error?.code || payload?.code;
  return new Error(code ? `${message} (${code})` : message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableNetworkError(error) {
  if (!error || new Set(["AbortError", "TimeoutError"]).has(error.name)) return false;
  return error.name === "TypeError" || /fetch failed|socket|ECONNRESET|EAI_AGAIN|ETIMEDOUT/i.test(`${error.message || ""} ${error.cause?.code || ""}`);
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function retryDelay(response, attempt, configured) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 30_000);
  return configured[Math.min(attempt - 1, configured.length - 1)] ?? 5_000;
}

async function requestImagePayload(body, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const endpoint = options.endpoint || imageEndpoint(options.baseUrl);
  const requestApiKey = options.apiKey ?? apiKey;
  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  const retryDelays = options.retryDelays || DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep || wait;
  const idempotencyKey = options.idempotencyKey || crypto.randomUUID();
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requestApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !retryableNetworkError(error)) {
        if (retryableNetworkError(error)) {
          throw new Error(`Image provider network request failed after ${attempt} attempts: ${error.message || error}`, { cause: error });
        }
        throw error;
      }
      await sleep(retryDelay(null, attempt, retryDelays));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    lastError = providerError(response.status, payload);
    if (attempt >= maxAttempts || !retryableStatus(response.status)) throw lastError;
    await sleep(retryDelay(response, attempt, retryDelays));
  }
  throw lastError || new Error("Image provider request failed");
}

async function withGenerationSlot(task) {
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    await new Promise((resolve) => generationWaiters.push(resolve));
  }
  activeGenerations += 1;
  try {
    return await task();
  } finally {
    activeGenerations -= 1;
    generationWaiters.shift()?.();
  }
}

async function generateImage(input = {}, options = {}) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > 32_000) throw new Error("prompt must be 32,000 characters or fewer");
  const model = String(input.model || defaultModel).trim() || "gpt-image-2";
  const format = supportedFormats.has(input.outputFormat) ? input.outputFormat : "png";
  const quality = supportedQualities.has(input.quality) ? input.quality : "auto";
  const background = supportedBackgrounds.has(input.background) ? input.background : "auto";
  if (model === "gpt-image-2" && background === "transparent") {
    throw new Error("gpt-image-2 does not support transparent backgrounds; use auto or opaque");
  }
  const count = Math.max(1, Math.min(4, Number(input.count) || 1));
  const size = String(input.size || "auto").trim() || "auto";
  const compression = Math.max(0, Math.min(100, Number(input.outputCompression) || 90));
  const requestApiKey = options.apiKey ?? apiKey;
  if (!requestApiKey) throw new Error("No API Key is configured for image generation");

  const body = {
    model,
    prompt,
    n: count,
    size,
    quality,
    background,
    output_format: format,
    ...(format === "jpeg" || format === "webp" ? { output_compression: compression } : {}),
  };
  const payload = await requestImagePayload(body, { ...options, apiKey: requestApiKey });
  const values = Array.isArray(payload.data) ? payload.data.slice(0, count) : [];
  if (!values.length) throw new Error("Image provider returned no images");

  const images = values.map((item, index) => {
    const output = outputPath(input.output, format, index);
    fs.writeFileSync(output, decodeImage(item?.b64_json || item?.image_base64), { mode: 0o600 });
    return {
      output,
      mimeType: format === "jpeg" ? "image/jpeg" : `image/${format}`,
      bytes: fs.statSync(output).size,
      revisedPrompt: item?.revised_prompt || null,
    };
  });
  return {
    kind: "generated-image",
    model,
    prompt,
    size,
    quality,
    background,
    outputFormat: format,
    createdAt: new Date().toISOString(),
    images,
    usage: payload.usage || null,
  };
}

const tools = [{
  name: "image_generate",
  description: "Generate one or more images from a text prompt with the configured OpenAI-compatible Images API, save them inside .onpeople/generated-images in the active workspace, and return their local paths. For 2–4 variations of one request, make ONE tool call and set count instead of invoking this tool concurrently. Use gpt-image-2 by default. After generation, tell the user where the files were saved.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Detailed visual description of the image to create." },
      model: { type: "string", description: "Optional image model override. Defaults to gpt-image-2." },
      output: { type: "string", description: "Optional filename stem. The tool always saves inside .onpeople/generated-images." },
      count: { type: "integer", minimum: 1, maximum: 4, default: 1 },
      size: { type: "string", description: "Image size such as auto, 1024x1024, 1536x1024, or 1024x1536.", default: "auto" },
      quality: { type: "string", enum: ["auto", "low", "medium", "high"], default: "auto" },
      background: { type: "string", enum: ["auto", "opaque", "transparent"], default: "auto" },
      outputFormat: { type: "string", enum: ["png", "jpeg", "webp"], default: "png" },
      outputCompression: { type: "integer", minimum: 0, maximum: 100, default: 90 },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
}];

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  try {
    if (message.method === "initialize") {
      return write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "onpeople-image-generation", version: "0.1.0" },
        },
      });
    }
    if (message.method === "tools/list") return write({ jsonrpc: "2.0", id: message.id, result: { tools } });
    if (message.method === "tools/call") {
      const value = await withGenerationSlot(() => generateImage(message.params?.arguments || {}));
      return write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
          structuredContent: value,
        },
      });
    }
    throw new Error(`Unsupported MCP method: ${message.method}`);
  } catch (error) {
    write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message || String(error) } });
  }
}

if (require.main === module) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try { void handle(JSON.parse(line)); }
    catch (error) { process.stderr.write(`${error.message}\n`); }
  });
}

module.exports = { decodeImage, generateImage, imageEndpoint, outputPath, requestImagePayload, safeName, tools, withGenerationSlot };
