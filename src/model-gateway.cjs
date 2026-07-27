const http = require("node:http");
const crypto = require("node:crypto");

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content.map((part) => {
    if (part?.type === "input_text" || part?.type === "output_text" || part?.type === "text") return part.text || "";
    if (part?.type === "input_image" && part.image_url) {
      return { type: "image_url", image_url: { url: part.image_url, ...(part.detail ? { detail: part.detail } : {}) } };
    }
    return null;
  }).filter(Boolean);
}

function responseInputToMessages(instructions, input = []) {
  const messages = [];
  if (instructions) messages.push({ role: "system", content: instructions });
  for (const item of input) {
    if (item?.type === "message") {
      messages.push({ role: item.role === "developer" ? "system" : item.role, content: textContent(item.content) });
    } else if (item?.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id || item.id,
          type: "function",
          function: { name: item.name, arguments: item.arguments || "{}" },
        }],
      });
    } else if (item?.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: item.call_id, content: textContent(item.output) });
    }
  }
  return messages;
}

function responseToolsToChat(tools = []) {
  return tools.filter((tool) => tool?.type === "function").map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.parameters || { type: "object", properties: {} },
    },
  }));
}

function toChatRequest(body, stream = true) {
  const tools = responseToolsToChat(body.tools);
  return {
    model: body.model,
    messages: responseInputToMessages(body.instructions, body.input),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(body.max_output_tokens ? { max_tokens: body.max_output_tokens } : {}),
    ...(Number.isFinite(body.temperature) ? { temperature: body.temperature } : {}),
    ...(Number.isFinite(body.top_p) ? { top_p: body.top_p } : {}),
    ...(tools.length ? { tools, tool_choice: body.tool_choice === "none" ? "none" : "auto" } : {}),
  };
}

function usageFromChat(usage = {}) {
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0 },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0 },
    total_tokens: usage.total_tokens || inputTokens + outputTokens,
  };
}

function writeEvent(response, name, data) {
  response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function baseResponse(body, id, createdAt) {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "in_progress",
    error: null,
    incomplete_details: null,
    instructions: body.instructions || null,
    max_output_tokens: body.max_output_tokens || null,
    model: body.model,
    output: [],
    parallel_tool_calls: body.parallel_tool_calls !== false,
    previous_response_id: body.previous_response_id || null,
    reasoning: body.reasoning || null,
    store: false,
    temperature: body.temperature ?? null,
    text: body.text || { format: { type: "text" } },
    tool_choice: body.tool_choice || "auto",
    tools: body.tools || [],
    top_p: body.top_p ?? null,
    truncation: body.truncation || "disabled",
    usage: null,
    metadata: body.metadata || {},
  };
}

class ResponsesStreamWriter {
  constructor(response, requestBody) {
    this.response = response;
    this.state = baseResponse(
      requestBody,
      `resp_${crypto.randomUUID().replaceAll("-", "")}`,
      Math.floor(Date.now() / 1000),
    );
    this.sequence = 0;
    this.outputs = [];
    this.message = null;
    this.textPart = null;
    this.toolCalls = new Map();
    this.usage = null;
  }

  event(name, data) {
    writeEvent(this.response, name, { type: name, ...data, sequence_number: this.sequence++ });
  }

  start() {
    this.response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    this.event("response.created", { response: this.state });
    this.event("response.in_progress", { response: this.state });
  }

  ensureMessage() {
    if (this.message) return this.message;
    const item = {
      id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [],
    };
    const outputIndex = this.outputs.length;
    this.message = { item, outputIndex, text: "" };
    this.outputs.push(item);
    this.event("response.output_item.added", { output_index: outputIndex, item });
    this.textPart = { type: "output_text", text: "", annotations: [] };
    this.event("response.content_part.added", {
      item_id: item.id,
      output_index: outputIndex,
      content_index: 0,
      part: this.textPart,
    });
    return this.message;
  }

  text(delta) {
    if (!delta) return;
    const message = this.ensureMessage();
    message.text += delta;
    this.event("response.output_text.delta", {
      item_id: message.item.id,
      output_index: message.outputIndex,
      content_index: 0,
      delta,
    });
  }

  tool(index, delta = {}) {
    let tool = this.toolCalls.get(index);
    if (!tool) {
      const item = {
        id: `fc_${crypto.randomUUID().replaceAll("-", "")}`,
        type: "function_call",
        status: "in_progress",
        call_id: delta.id || `call_${crypto.randomUUID().replaceAll("-", "")}`,
        name: delta.function?.name || "unknown_tool",
        arguments: "",
      };
      tool = { item, outputIndex: this.outputs.length };
      this.toolCalls.set(index, tool);
      this.outputs.push(item);
      this.event("response.output_item.added", { output_index: tool.outputIndex, item });
    }
    if (delta.id) tool.item.call_id = delta.id;
    if (delta.function?.name) tool.item.name = delta.function.name;
    const args = delta.function?.arguments || "";
    if (args) {
      tool.item.arguments += args;
      this.event("response.function_call_arguments.delta", {
        item_id: tool.item.id,
        output_index: tool.outputIndex,
        delta: args,
      });
    }
  }

  accept(chunk) {
    if (chunk?.usage) this.usage = chunk.usage;
    for (const choice of chunk?.choices || []) {
      const delta = choice.delta || {};
      if (typeof delta.content === "string") this.text(delta.content);
      for (const toolCall of delta.tool_calls || []) this.tool(toolCall.index ?? 0, toolCall);
    }
  }

  finish() {
    if (this.message) {
      const { item, outputIndex, text } = this.message;
      this.textPart.text = text;
      this.event("response.output_text.done", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        text,
      });
      this.event("response.content_part.done", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        part: this.textPart,
      });
      item.status = "completed";
      item.content = [this.textPart];
      this.event("response.output_item.done", { output_index: outputIndex, item });
    }
    for (const { item, outputIndex } of this.toolCalls.values()) {
      item.status = "completed";
      this.event("response.function_call_arguments.done", {
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments || "{}",
      });
      this.event("response.output_item.done", { output_index: outputIndex, item });
    }
    this.state.status = "completed";
    this.state.output = this.outputs;
    this.state.usage = usageFromChat(this.usage || {});
    this.event("response.completed", { response: this.state });
    this.response.write("data: [DONE]\n\n");
    this.response.end();
  }
}

function writeResponsesStream(response, requestBody, chatBody) {
  const writer = new ResponsesStreamWriter(response, requestBody);
  writer.start();
  const message = chatBody.choices?.[0]?.message || {};
  writer.accept({ choices: [{ delta: { content: message.content || "", tool_calls: message.tool_calls || [] } }], usage: chatBody.usage });
  writer.finish();
}

function readJson(request, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes > limit) request.destroy(new Error("Request body is too large"));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

async function consumeSse(readable, onData) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of readable) {
    buffer += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      onData(JSON.parse(data));
    }
  }
  // Flush a final block that was not followed by the terminating blank line.
  const tail = buffer.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (tail && tail !== "[DONE]") onData(JSON.parse(tail));
}

class ModelGateway {
  constructor(getFallbackSettings = null) {
    this.getFallbackSettings = getFallbackSettings;
    this.routes = new Map();
    this.server = null;
    this.url = null;
  }

  registerRoute(routeId, settings) {
    const id = String(routeId || "").trim();
    if (!id) throw new Error("Model gateway route id is required");
    if (settings?.type === "onpeople" && !String(settings.apiKey || "").trim()) {
      throw new Error("OnPeople route credentials are unavailable");
    }
    this.routes.set(id, { ...settings });
    return this.url ? `${this.url}/routes/${encodeURIComponent(id)}/v1` : null;
  }

  removeRoute(routeId) {
    this.routes.delete(String(routeId || ""));
  }

  routeBaseUrl(routeId) {
    const id = String(routeId || "").trim();
    if (!this.url || !id) return null;
    return `${this.url}/routes/${encodeURIComponent(id)}/v1`;
  }

  resolveSettings(url) {
    if (url === "/v1/responses" && this.getFallbackSettings) return this.getFallbackSettings();
    const match = /^\/routes\/([^/]+)\/v1\/responses(?:\?.*)?$/.exec(url || "");
    return match ? this.routes.get(decodeURIComponent(match[1])) || null : null;
  }

  async start() {
    if (this.server) return this.url;
    this.server = http.createServer((request, response) => void this.handle(request, response));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    this.url = `http://127.0.0.1:${address.port}`;
    return this.url;
  }

  async handle(request, response) {
    const settings = request.method === "POST" ? this.resolveSettings(request.url) : null;
    if (!settings) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Model route not found" } }));
      return;
    }
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const body = await readJson(request);
      if (settings.protocol === "responses") {
        const upstream = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/responses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream, application/json",
            ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        response.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "cache-control": upstream.headers.get("cache-control") || "no-cache",
        });
        if (upstream.body) {
          for await (const chunk of upstream.body) response.write(chunk);
        }
        response.end();
        return;
      }
      const upstream = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream, application/json",
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify(toChatRequest(body, true)),
        signal: controller.signal,
      });
      if (!upstream.ok) {
        const raw = await upstream.text();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        response.writeHead(upstream.status, { "content-type": "application/json" });
        response.end(JSON.stringify(parsed || { error: { message: raw || `Upstream returned ${upstream.status}` } }));
        return;
      }
      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        writeResponsesStream(response, body, await upstream.json());
        return;
      }
      const writer = new ResponsesStreamWriter(response, body);
      writer.start();
      await consumeSse(upstream.body, (chunk) => writer.accept(chunk));
      if (!controller.signal.aborted) writer.finish();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (response.headersSent) response.destroy(error);
      else {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
      }
    }
  }

  stop() {
    this.server?.close();
    this.server = null;
    this.url = null;
    this.routes.clear();
  }
}

module.exports = {
  ModelGateway,
  ResponsesStreamWriter,
  consumeSse,
  toChatRequest,
  writeResponsesStream,
};
