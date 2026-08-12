import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "..");
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "onpeople-browser-acceptance-"),
);
const downloadRoot = path.join(temporaryRoot, "downloads");
const uploadPath = path.join(temporaryRoot, "upload.txt");
await mkdir(downloadRoot, { recursive: true });
await writeFile(uploadPath, "OnPeople upload acceptance\n");

const server = createServer((request, response) => {
  if (request.url === "/download.txt") {
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="onpeople-download.txt"',
    });
    response.end("OnPeople download acceptance\n");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Set-Cookie": "onpeople_acceptance=ready; Path=/; SameSite=Lax",
  });
  response.end(`<!doctype html>
    <html><head><title>OnPeople Browser Test</title></head>
    <body>
      <h1>OnPeople Browser Test</h1>
      <a id="popup" target="_blank" href="/popup">Open popup</a>
      <a id="download" href="/download.txt" download>Download fixture</a>
      <label for="text-input">Text input</label>
      <input id="text-input" type="text" />
      <input id="upload" type="file" />
    </body></html>`);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

const electronApp = await electron.launch({
  args: [path.join(moduleRoot, "main.mjs"), `--user-data-dir=${temporaryRoot}`],
  cwd: repositoryRoot,
  env: {
    ...process.env,
    ONPEOPLE_BROWSER_DOWNLOAD_DIR: downloadRoot,
    ONPEOPLE_DATA_ROOT: path.join(temporaryRoot, "runtime-data"),
  },
  timeout: 30_000,
});

try {
  const page = await electronApp.firstWindow();
  await page.waitForFunction(async () => {
    const metrics = await window.onpeopleElectron?.metrics();
    return metrics?.rendererReadyMs !== null;
  });
  const idleMetrics = await page.evaluate(() =>
    window.onpeopleElectron.metrics(),
  );
  const agentBridge = await electronApp.evaluate(() => ({
    address: process.env.ONPEOPLE_BROWSER_AGENT_BRIDGE,
    token: process.env.ONPEOPLE_BROWSER_AGENT_TOKEN,
  }));
  assert(agentBridge.address, "browser agent bridge address was not published");
  assert(agentBridge.token, "browser agent bridge token was not published");
  const agentSnapshot = await mcpBrowserCall(
    agentBridge.address,
    agentBridge.token,
    "browser_open",
    { urlOrQuery: fixtureUrl },
  );
  assert.equal(agentSnapshot.title, "OnPeople Browser Test");
  try {
    await page.getByLabel("地址和搜索").waitFor({ timeout: 5_000 });
  } catch (error) {
    process.stderr.write(
      `${(await page.locator("body").innerText()).slice(0, 4_000)}\n`,
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), "onpeople-browser-acceptance-failure.png"),
    });
    throw error;
  }

  const initialMetrics = await page.evaluate(() =>
    window.onpeopleElectron.metrics(),
  );
  const browserIncrementKb =
    initialMetrics.totalWorkingSetKb - idleMetrics.totalWorkingSetKb;
  assert(
    browserIncrementKb < 250 * 1024,
    `opening one browser tab added more than 250 MiB: ${Math.round(browserIncrementKb / 1024)} MiB`,
  );
  const active = await activeBrowser(page);
  const session = await browserInvoke(page, "session-status", {
    tabId: active.tabId,
  });
  assert(
    session.cookies.some((cookie) => cookie.name === "onpeople_acceptance"),
    "persistent session did not expose the fixture cookie",
  );

  const domSnapshot = await browserInvoke(page, "dom-snapshot", {
    tabId: active.tabId,
  });
  assert.equal(domSnapshot.title, "OnPeople Browser Test");
  assert(
    domSnapshot.viewport.height > 0,
    "guest viewport height must be non-zero",
  );
  assert(
    domSnapshot.nodes.some((node) => node.name === "OnPeople Browser Test"),
  );

  const visualSnapshot = await browserInvoke(page, "visual-snapshot", {
    tabId: active.tabId,
  });
  assert(visualSnapshot.width > 0 && visualSnapshot.height > 0);
  assert(visualSnapshot.dataUrl.startsWith("data:image/png;base64,"));

  const firstText = await focusAndTypeInGuest(
    electronApp,
    active.webContentsId,
    "#text-input",
    "first",
  );
  assert.equal(
    firstText.focused,
    true,
    "browser guest did not own keyboard focus",
  );
  assert.equal(firstText.value, "first");

  await page.getByLabel("地址和搜索").click();
  await page.waitForFunction(
    async (webContentsId) =>
      !(await window.onpeopleBrowser.invoke("state")).attachedPages.find(
        (item) => item.webContentsId === webContentsId,
      )?.focused,
    active.webContentsId,
  );

  const resumedText = await focusAndTypeInGuest(
    electronApp,
    active.webContentsId,
    "#text-input",
    "-second",
  );
  assert.equal(
    resumedText.focused,
    true,
    "browser guest did not reclaim focus after using the address bar",
  );
  assert.equal(resumedText.value, "first-second");

  await setUploadFile(electronApp, active.webContentsId, uploadPath);
  const uploadName = await executeInGuest(
    electronApp,
    active.webContentsId,
    `document.querySelector("#upload").files[0]?.name || ""`,
  );
  assert.equal(uploadName, path.basename(uploadPath));

  await executeInGuest(
    electronApp,
    active.webContentsId,
    `document.querySelector("#download").click()`,
  );
  const completedDownload = await waitForCompletedDownload(page);
  assert.equal(
    (await readFile(completedDownload.path, "utf8")).trim(),
    "OnPeople download acceptance",
  );

  await executeInGuest(
    electronApp,
    active.webContentsId,
    `document.querySelector("#popup").click()`,
  );
  await page.waitForFunction(async () => {
    const value = await window.onpeopleBrowser.invoke("state");
    return value.attachedTabs.length >= 2;
  });
  await page
    .getByRole("tab", { name: /OnPeople Browser Test/ })
    .first()
    .click();

  for (let index = 0; index < 30; index += 1) {
    try {
      await page.getByRole("button", { name: "新建标签页" }).click();
      await navigate(page, `${fixtureUrl}?cycle=${index}`);
      const selected = page.locator(".browser-tab.is-active");
      await selected.getByRole("button", { name: /^关闭 / }).click();
    } catch (error) {
      process.stderr.write(`browser cycle ${index + 1}/30 failed\n`);
      process.stderr.write(
        `${JSON.stringify(await browserInvoke(page, "state"), null, 2)}\n`,
      );
      process.stderr.write(
        `${JSON.stringify(await page.evaluate(() => window.onpeopleElectron.metrics()), null, 2)}\n`,
      );
      process.stderr.write(
        `${(await page.locator("body").innerText()).slice(0, 8_000)}\n`,
      );
      await page.screenshot({
        path: path.join(os.tmpdir(), "onpeople-browser-cycle-failure.png"),
      });
      throw error;
    }
  }

  const cycleState = await browserInvoke(page, "state");
  assert(
    cycleState.attachedTabs.length <= 3,
    `resident tab budget exceeded: ${cycleState.attachedTabs.length}`,
  );
  assert.equal(cycleState.crashCount, 0, "browser crashed during 30 cycles");

  const originalAfterCycles = await activeBrowser(page);
  await electronApp.evaluate(({ webContents }, webContentsId) => {
    webContents.fromId(webContentsId)?.forcefullyCrashRenderer();
  }, originalAfterCycles.webContentsId);
  await page.waitForFunction(async () => {
    const value = await window.onpeopleBrowser.invoke("state");
    return value.crashCount === 1;
  });
  const crashedState = await browserInvoke(page, "state");
  if (crashedState.recoveryCount === 0) {
    await browserInvoke(page, "recover", {
      tabId: originalAfterCycles.tabId,
    });
  }
  await page.waitForFunction(async () => {
    const value = await window.onpeopleBrowser.invoke("state");
    return value.recoveryCount === 1;
  });
  await page
    .getByRole("tab", { name: /OnPeople Browser Test/, selected: true })
    .waitFor();

  const finalMetrics = await page.evaluate(() =>
    window.onpeopleElectron.metrics(),
  );
  const finalBrowserState = await browserInvoke(page, "state");
  assert.equal(finalMetrics.rustHostRestartCount, 0);
  assert.equal(finalMetrics.windowCrashCount, 0);
  assert.equal(finalBrowserState.crashCount, 1);
  assert.equal(finalBrowserState.recoveryCount, 1);

  const memoryGrowthKb =
    finalMetrics.totalWorkingSetKb - initialMetrics.totalWorkingSetKb;
  assert(
    memoryGrowthKb < 200 * 1024,
    `30-cycle memory growth exceeded 200 MiB: ${Math.round(memoryGrowthKb / 1024)} MiB`,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        fixtureUrl,
        cycles: 30,
        upload: uploadName,
        download: completedDownload.path,
        idleWorkingSetKb: idleMetrics.totalWorkingSetKb,
        initialWorkingSetKb: initialMetrics.totalWorkingSetKb,
        browserIncrementKb,
        finalWorkingSetKb: finalMetrics.totalWorkingSetKb,
        memoryGrowthKb,
        browser: finalBrowserState,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await electronApp.close();
  server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function navigate(page, url) {
  const addressInput = page.getByLabel("地址和搜索");
  await addressInput.fill(url);
  await addressInput.evaluate((input) => input.form?.requestSubmit());
  try {
    await page
      .getByRole("tab", { selected: true })
      .filter({ hasText: "OnPeople Browser Test" })
      .waitFor({ timeout: 5_000 });
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(await browserInvoke(page, "state"))}\n`,
    );
    process.stderr.write(
      `${(await page.locator("body").innerText()).slice(0, 4_000)}\n`,
    );
    throw error;
  }
}

async function mcpBrowserCall(address, token, name, argumentsValue = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(repositoryRoot, "target", "debug", "onpeople-mcp-host"),
      ["browser"],
      {
        env: {
          ...process.env,
          ONPEOPLE_BROWSER_AGENT_BRIDGE: address,
          ONPEOPLE_BROWSER_AGENT_TOKEN: token,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("browser MCP call timed out"));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0, stderr);
        const envelope = JSON.parse(stdout.trim());
        assert.equal(envelope.result?.isError, false, stdout);
        resolve(JSON.parse(envelope.result.content[0].text));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: argumentsValue },
      })}\n`,
    );
  });
}

async function browserInvoke(page, command, payload = {}) {
  return page.evaluate(
    ({ command: method, payload: params }) =>
      window.onpeopleBrowser.invoke(method, params),
    { command, payload },
  );
}

async function waitForCompletedDownload(page) {
  const deadline = Date.now() + 15_000;
  let latest = [];
  while (Date.now() < deadline) {
    latest = await browserInvoke(page, "downloads");
    const completed = latest.find((item) => item.state === "completed");
    if (completed) return completed;
    await page.waitForTimeout(50);
  }
  throw new Error(`download did not complete: ${JSON.stringify(latest)}`);
}

async function activeBrowser(page) {
  const state = await browserInvoke(page, "state");
  const activePage = state.attachedPages.find(
    (item) => item.tabId === state.activeTabId,
  );
  assert(activePage, "no active browser guest");
  return activePage;
}

async function executeInGuest(appHandle, webContentsId, expression) {
  return appHandle.evaluate(
    ({ webContents }, input) =>
      webContents
        .fromId(input.webContentsId)
        ?.executeJavaScript(input.expression),
    { webContentsId, expression },
  );
}

async function focusAndTypeInGuest(appHandle, webContentsId, selector, text) {
  return appHandle.evaluate(
    async ({ webContents }, input) => {
      const guest = webContents.fromId(input.webContentsId);
      if (!guest) throw new Error("browser guest not found");
      const serializedSelector = JSON.stringify(input.selector);
      const rect = await guest.executeJavaScript(
        `(() => {
          const node = document.querySelector(${serializedSelector});
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        })()`,
      );
      if (!rect) throw new Error(`browser input not found: ${input.selector}`);
      const x = Math.round(rect.x + rect.width / 2);
      const y = Math.round(rect.y + rect.height / 2);
      guest.sendInputEvent({
        type: "mouseDown",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      guest.sendInputEvent({
        type: "mouseUp",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      guest.insertText(input.text);
      return {
        focused: guest.isFocused(),
        value: await guest.executeJavaScript(
          `document.querySelector(${serializedSelector})?.value ?? ""`,
        ),
      };
    },
    { webContentsId, selector, text },
  );
}

async function setUploadFile(appHandle, webContentsId, filePath) {
  await appHandle.evaluate(
    async ({ webContents }, input) => {
      const guest = webContents.fromId(input.webContentsId);
      if (!guest) throw new Error("browser guest not found");
      if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
      const document = await guest.debugger.sendCommand("DOM.getDocument");
      const inputNode = await guest.debugger.sendCommand("DOM.querySelector", {
        nodeId: document.root.nodeId,
        selector: "#upload",
      });
      await guest.debugger.sendCommand("DOM.setFileInputFiles", {
        nodeId: inputNode.nodeId,
        files: [input.filePath],
      });
    },
    { webContentsId, filePath },
  );
}
