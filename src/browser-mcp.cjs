const readline = require("node:readline");

const bridgeUrl = process.env.INTERNAL_BROWSER_BRIDGE_URL;
const bridgeToken = process.env.INTERNAL_BROWSER_BRIDGE_TOKEN;

if (!bridgeUrl || !bridgeToken) {
  process.stderr.write("Browser bridge configuration is missing.\n");
  process.exit(1);
}

const tools = [
  {
    name: "browser_navigate",
    description: "Navigate the embedded browser to an HTTP(S) URL. The user must approve a host by visiting it manually first.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute HTTP(S) URL" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    description: "Read the embedded browser's current URL, title, visible text, and interactive elements.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_click",
    description: "Click an interactive element returned by browser_snapshot.",
    inputSchema: {
      type: "object",
      properties: { elementId: { type: "string" } },
      required: ["elementId"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_fill",
    description: "Fill an input or textarea returned by browser_snapshot and dispatch input/change events.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        text: { type: "string" },
      },
      required: ["elementId", "text"],
      additionalProperties: false,
    },
  },
];

async function callBridge(action, args = {}) {
  const response = await fetch(`${bridgeUrl}/command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-browser-token": bridgeToken,
    },
    body: JSON.stringify({ action, args }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Browser bridge failed with HTTP ${response.status}`);
  }
  return result.value;
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;

  try {
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "internal-embedded-browser", version: "0.1.0" },
        },
      });
      return;
    }

    if (message.method === "tools/list") {
      write({ jsonrpc: "2.0", id: message.id, result: { tools } });
      return;
    }

    if (message.method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      const actions = {
        browser_navigate: "navigate",
        browser_snapshot: "snapshot",
        browser_click: "click",
        browser_fill: "fill",
      };
      if (!actions[name]) throw new Error(`Unknown browser tool: ${name}`);
      const value = await callBridge(actions[name], args);
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] },
      });
      return;
    }

    throw new Error(`Unsupported MCP method: ${message.method}`);
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line));
  } catch (error) {
    process.stderr.write(`Invalid MCP message: ${error.message}\n`);
  }
});
