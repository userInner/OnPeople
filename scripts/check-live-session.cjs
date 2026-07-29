const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  buildLiveSession,
  closeLiveCall,
  createLiveCall,
  normalizeLiveInitialItems,
  normalizeLiveVoice,
} = require("../src/live-session.cjs");
const {
  LiveSidebandConnection,
  resolveLiveSidebandUrl,
} = require("../src/live-sideband.cjs");
const {
  isDelegationCommitment,
  normalizeTranscript,
  shouldRecoverDelegation,
} = require("../src/live-delegation.js");

assert.equal(normalizeLiveVoice("COVE"), "cove");
assert.equal(normalizeLiveVoice("unknown"), "cove");
assert.deepEqual(normalizeLiveInitialItems([
  { role: "developer", text: "Preference" },
  { role: "assistant", text: "Understood" },
  { role: "invalid", text: "Question" },
]), [
  { type: "message", role: "developer", content: [{ type: "input_text", text: "Preference" }] },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "Understood" }] },
  { type: "message", role: "user", content: [{ type: "input_text", text: "Question" }] },
]);

const session = buildLiveSession({
  instructions: "Speak concisely.",
  voice: "cove",
  initialItems: [{ role: "user", text: "Continue." }],
});
assert.equal(session.audio.output.voice, "cove");
assert.equal(session.delegation.type, "client");
assert.equal(session.initial_items[0].content[0].text, "Continue.");
assert.equal(Object.hasOwn(session, "model"), false, "Frameless GPT-Live payload must not force a model");
assert.equal(normalizeTranscript("  我   找找看。 "), "我 找找看。");
assert.equal(isDelegationCommitment("我找找看。"), true);
assert.equal(isDelegationCommitment("好，我这就帮你查一下。"), true);
assert.equal(isDelegationCommitment("我已经找到三条新闻。"), false);
assert.equal(shouldRecoverDelegation({ assistantText: "我找找看。", userText: "八卦新闻" }), true);
assert.equal(shouldRecoverDelegation({ assistantText: "我找找看。", userText: "" }), false);
assert.equal(
  resolveLiveSidebandUrl("https://voice.example/v1", "/v1/live/call_test"),
  "wss://voice.example/v1/live/call_test",
);
assert.equal(resolveLiveSidebandUrl("http://127.0.0.1:8080/v1", "live/call_test"), "ws://127.0.0.1:8080/v1/live/call_test");

class MockWebSocket extends EventEmitter {
  static OPEN = 1;

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  send(value) {
    this.sent.push(value);
  }

  close(code, reason) {
    this.readyState = 3;
    this.emit("close", code, Buffer.from(reason || ""));
  }
}
MockWebSocket.instances = [];

async function main() {
  let request = null;
  const created = await createLiveCall({
    baseUrl: "https://voice.example/v1/",
    apiKey: "sk-secret",
    sdp: "v=0\r\no=offer\r\n",
    voice: "cove",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response("v=0\r\no=answer\r\n", {
        status: 200,
        headers: { location: "/v1/live/call_test" },
      });
    },
  });
  assert.equal(request.url, "https://voice.example/v1/live");
  assert.equal(request.options.headers.authorization, "Bearer sk-secret");
  assert.equal(JSON.parse(request.options.body).session.audio.output.voice, "cove");
  assert.equal(created.callId, "call_test");
  assert.equal(created.sidebandAvailable, true);
  assert.equal(created.sidebandUrl, "wss://voice.example/v1/live/call_test");

  const statuses = [];
  const events = [];
  const sideband = new LiveSidebandConnection({
    url: created.sidebandUrl,
    apiKey: "sk-secret",
    WebSocketImpl: MockWebSocket,
    reconnectDelaysMs: [],
    onStatus: (status) => statuses.push(status),
    onEvent: (event) => events.push(event),
  }).start();
  const socket = MockWebSocket.instances.at(-1);
  assert.equal(socket.options.headers.authorization, "Bearer sk-secret");
  socket.open();
  socket.emit("message", Buffer.from('{"type":"session.updated"}'), false);
  assert.equal(statuses.at(-1).state, "connected");
  assert.equal(events.at(-1), '{"type":"session.updated"}');
  assert.equal(sideband.send({ type: "session.update" }), true);
  assert.equal(socket.sent.at(-1), '{"type":"session.update"}');
  sideband.close();
  assert.equal(statuses.at(-1).state, "closed");

  let closeRequest = null;
  const closed = await closeLiveCall({
    baseUrl: "https://voice.example/v1/",
    apiKey: "sk-secret",
    callId: "call_test",
    fetchImpl: async (url, options) => {
      closeRequest = { url, options };
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(closed, true);
  assert.equal(closeRequest.url, "https://voice.example/v1/live/call_test");
  assert.equal(closeRequest.options.method, "DELETE");
  assert.equal(closeRequest.options.headers.authorization, "Bearer sk-secret");

  await assert.rejects(
    createLiveCall({
      baseUrl: "https://voice.example/v1",
      apiKey: "sk-secret",
      sdp: "v=0\r\n",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Live concurrency limit reached" } }), { status: 429 }),
    }),
    /concurrency limit reached/,
  );

  const root = path.resolve(__dirname, "..");
  const index = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src", "renderer.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  const packageMac = fs.readFileSync(path.join(root, "scripts", "package-mac.cjs"), "utf8");
  assert.match(index, /id="live-start"/);
  assert.match(index, /id="live-call-panel"/);
  assert.match(index, /id="settings-voice-page"/);
  assert.match(index, /src="live-delegation\.js"/);
  assert.match(renderer, /createDataChannel\("oai-events"\)/);
  assert.match(renderer, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(renderer, /delegation\.context\.append/);
  assert.match(renderer, /conversation\.item\.input_audio_transcription\.completed/);
  assert.match(renderer, /function appendLiveTranscript/);
  assert.match(renderer, /LIVE_TRANSCRIPT_DEDUPE_WINDOW_MS/);
  assert.match(renderer, /function queueLiveDelegationFallback/);
  assert.match(renderer, /LIVE → TASK/);
  assert.match(renderer, /任务已排队，等待运行/);
  assert.match(renderer, /const message = cloudErrorMessage\(error\)/);
  assert.match(mainSource, /ipcMain\.handle\("live:create"/);
  assert.match(mainSource, /ipcMain\.handle\("live:close"/);
  assert.match(mainSource, /connectLiveSideband/);
  assert.match(mainSource, /live:sideband-event/);
  assert.match(mainSource, /active\.sideband\?\.close/);
  assert.match(mainSource, /hard maximum duration of 60 minutes/);
  assert.match(mainSource, /Never say that you are checking, searching, working on it/);
  assert.match(mainSource, /create the client delegation before verbally acknowledging/);
  assert.match(mainSource, /ONPEOPLE_LIVE_API_KEY/);
  assert.match(mainSource, /async function resolveLiveCredentials\(\)/);
  assert.match(mainSource, /OnPeople 登录已失效，请重新登录后使用 GPT-Live/);
  assert.match(mainSource, /setPermissionRequestHandler/);
  assert.match(preload, /createLiveSession/);
  assert.match(preload, /closeLiveSession/);
  assert.match(preload, /onLiveSidebandEvent/);
  assert.match(preload, /onLiveSidebandStatus/);
  assert.match(renderer, /closeLiveSession\(session\.callId\)/);
  assert.match(renderer, /window\.workbench\.onLiveSidebandEvent/);
  assert.match(renderer, /nativeDelegationItemId === pendingLiveDelegation\.itemId/);
  assert.match(renderer, /function finalizePendingLiveDelegation/);
  assert.match(renderer, /function reconcileCurrentThreadTerminalState/);
  assert.match(renderer, /expectedLiveSessionId && liveConversation\?\.sessionId !== expectedLiveSessionId/);
  assert.match(renderer, /clearLiveDelegationWait\(pendingLiveDelegation\)/);
  assert.doesNotMatch(
    renderer.match(/function releaseLiveConversation[\s\S]*?\n}\n\nasync function startLiveConversation/)?.[0] || "",
    /pendingLiveDelegation = null/,
    "ending Live must not discard an in-flight delegated task",
  );
  assert.match(mainSource, /finalText: detail\.finalText \? String\(detail\.finalText\)\.slice\(-4_000\) : null/);
  assert.match(mainSource, /setThreadLifecycle\([\s\S]*?finalText,[\s\S]*?\);/);
  assert.match(packageMac, /NSMicrophoneUsageDescription/);
  process.stdout.write("GPT-Live integration checks passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
