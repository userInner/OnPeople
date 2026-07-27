const readline = require("node:readline");

const bridgeUrl = process.env.INTERNAL_BROWSER_BRIDGE_URL;
const bridgeToken = process.env.INTERNAL_BROWSER_BRIDGE_TOKEN;
const bridgeRouteId = process.env.INTERNAL_BROWSER_ROUTE_ID;

if (!bridgeUrl || !bridgeToken || !bridgeRouteId) {
  process.stderr.write("Browser bridge configuration is missing.\n");
  process.exit(1);
}

const tools = [
  {
    name: "browser_navigate",
    description: "Open a URL in OnPeople's embedded browser. Public HTTPS sites can be opened directly; local, private, or plain-HTTP hosts must first be approved from the address bar.",
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
    name: "browser_visual_snapshot",
    description: "Capture the embedded browser viewport as a PNG together with URL, title, visible text, and interactive elements. Use it to verify rendered layout or visual state after navigation and actions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_annotations",
    description: "Read the user's saved visual comments for the page currently open in OnPeople's embedded browser.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_developer_inspect",
    description: "Inspect the current page's DOM summary, recent console messages, sanitized network request outcomes, and navigation performance. This controlled developer inspection never returns request headers, cookies, storage, or response bodies.",
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
    description: "Fill an input, textarea, ARIA textbox, or contenteditable rich-text field returned by browser_snapshot and dispatch compatible editing events.",
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
  {
    name: "browser_press_key",
    description: "Press a keyboard key in the page, optionally focusing a snapshot element first. Returns post-action verification state.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, elementId: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_select",
    description: "Select an option by value from a select element returned by browser_snapshot.",
    inputSchema: {
      type: "object",
      properties: { elementId: { type: "string" }, value: { type: "string" } },
      required: ["elementId", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or a snapshot element and verify the resulting scroll state.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_hover",
    description: "Move the pointer over a snapshot element.",
    inputSchema: {
      type: "object",
      properties: { elementId: { type: "string" } },
      required: ["elementId"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_wait",
    description: "Wait for a duration or until visible page text appears.",
    inputSchema: {
      type: "object",
      properties: {
        milliseconds: { type: "number" },
        text: { type: "string" },
        timeout: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_upload",
    description: "Set one or more existing local files on a file input returned by browser_snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
      },
      required: ["elementId", "paths"],
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
      "x-internal-browser-route-id": bridgeRouteId,
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
          serverInfo: { name: "internal-embedded-browser", version: "0.3.0" },
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
        browser_visual_snapshot: "visual_snapshot",
        browser_annotations: "annotations",
        browser_developer_inspect: "developer_inspect",
        browser_click: "click",
        browser_fill: "fill",
        browser_press_key: "press_key",
        browser_select: "select",
        browser_scroll: "scroll",
        browser_hover: "hover",
        browser_wait: "wait",
        browser_upload: "upload",
      };
      if (!actions[name]) throw new Error(`Unknown browser tool: ${name}`);
      const value = await callBridge(actions[name], args);
      if (name === "browser_visual_snapshot") {
        const { imageBase64, mimeType, ...metadata } = value;
        write({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [
              { type: "text", text: JSON.stringify(metadata, null, 2) },
              { type: "image", data: imageBase64, mimeType: mimeType || "image/png" },
            ],
          },
        });
        return;
      }
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
