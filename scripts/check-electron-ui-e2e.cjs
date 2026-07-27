const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let electronApi;
try {
  ({ _electron: electronApi } = require("playwright-core"));
} catch {
  throw new Error("需要 playwright-core；请先安装项目开发依赖");
}

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-electron-e2e-"));
const userData = path.join(temporary, "user-data");
const defaultWorkspace = path.join(temporary, "default-workspace");
const alternateWorkspace = path.join(temporary, "alternate-workspace");
fs.mkdirSync(defaultWorkspace, { recursive: true });
fs.mkdirSync(alternateWorkspace, { recursive: true });

async function run() {
  const executablePath = process.platform === "darwin"
    ? path.join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
    : require("electron");
  const application = await electronApi.launch({
    executablePath,
    args: [root],
    env: {
      ...process.env,
      INTERNAL_AGENT_WORKSPACE: defaultWorkspace,
      ONPEOPLE_TEST_USER_DATA: userData,
    },
    timeout: 30_000,
  });
  const errors = [];
  try {
    const page = await application.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForSelector("#cwd", { state: "attached" });
    await page.waitForFunction((expected) => document.querySelector("#cwd")?.value === expected, defaultWorkspace);
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), true);
    assert.equal(await page.locator("#utility-panel").getAttribute("aria-hidden"), "true");
    assert.equal(await page.locator('[data-tool-view="browser"]').getAttribute("aria-pressed"), "false");
    assert.match(await page.locator("#prompt").getAttribute("placeholder"), /今天帮你做些什么/);
    const brandMarkBounds = await page.locator(".brand-mark").boundingBox();
    const welcomeMarkBounds = await page.locator(".welcome-mark").boundingBox();
    assert.ok(brandMarkBounds.width >= 30, "sidebar brand mark should be visually prominent");
    assert.ok(welcomeMarkBounds.width >= 58, "welcome mark should anchor the empty state");
    assert.equal(await page.locator(".topbar .permission-control").count(), 0);
    assert.equal(await page.locator(".composer-context-row .permission-control").isVisible(), true);
    assert.equal(await page.locator("#composer-workspace-label").textContent(), path.basename(defaultWorkspace));
    const attachBounds = await page.locator("#attach-image").boundingBox();
    const sendBounds = await page.locator("#send").boundingBox();
    const surfaceBounds = await page.locator(".composer-surface").boundingBox();
    const contextBounds = await page.locator(".composer-context-row").boundingBox();
    assert.ok(attachBounds.x < sendBounds.x, "add control should sit to the left of send");
    assert.ok(contextBounds.y >= surfaceBounds.y + surfaceBounds.height, "workspace and permission controls should sit below the input surface");
    const permissionTrigger = page.locator(".composer-permission .op-select-trigger");
    await permissionTrigger.click();
    assert.equal(await page.locator('#onpeople-select-popover .op-select-option[data-value="ask"]').isVisible(), true);
    assert.equal(await page.locator('#onpeople-select-popover .op-select-option[data-value="auto_review"]').isVisible(), true);
    assert.equal(await page.locator('#onpeople-select-popover .op-select-option[data-value="full_access"]').isVisible(), true);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: "/tmp/onpeople-electron-composer.png" });

    await page.evaluate(() => {
      document.querySelector("#prompt").style.height = "150px";
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      for (let index = 0; index < 14; index += 1) {
        addEvent("tool", "PERMISSIONS", `权限状态 ${index + 1}`);
      }
      scrollTimelineToBottomImmediately();
    });
    await page.waitForTimeout(100);
    const latestEventBounds = await page.locator("#timeline > .event").last().boundingBox();
    const composerDockBounds = await page.locator(".composer-dock").boundingBox();
    assert.ok(
      latestEventBounds.y + latestEventBounds.height <= composerDockBounds.y - 12,
      `latest timeline event should remain visible above the resized composer: ${JSON.stringify({ latestEventBounds, composerDockBounds })}`,
    );
    await page.screenshot({ path: "/tmp/onpeople-electron-composer-clearance.png" });
    await page.evaluate(() => {
      document.querySelector("#prompt").style.height = "";
      resetTimeline();
    });

    await page.locator('[data-tool-view="browser"]').click();
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), false);
    assert.equal(await page.locator("#utility-panel").getAttribute("aria-hidden"), "false");
    await page.waitForTimeout(250);
    await page.screenshot({ path: "/tmp/onpeople-electron-utility-visible.png" });
    await page.locator("#utility-close").click();
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), true);
    assert.equal(await page.locator('[data-tool-view="browser"]').getAttribute("aria-pressed"), "false");
    await page.waitForTimeout(250);
    await page.screenshot({ path: "/tmp/onpeople-electron-utility-hidden.png" });

    await page.locator("details.runtime-settings summary").click();
    await page.locator("#cwd").fill(alternateWorkspace);
    await page.locator("#cwd").dispatchEvent("change");
    assert.equal(await page.locator("#cwd").inputValue(), alternateWorkspace);
    await page.locator('[data-tool-view="browser"]').click();
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), false);
    await page.locator("#new-task").click();
    await page.waitForFunction((expected) => document.querySelector("#cwd")?.value === expected, defaultWorkspace);
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), true);

    await page.locator('[data-tool-view="control"]').click();
    await page.waitForFunction(() => document.querySelector('[data-view="control"]')?.classList.contains("active"));
    assert.equal(await page.locator('[data-control-view="agents"]').isHidden(), true);
    assert.equal(await page.locator('[data-control-panel="scheduled"]').isVisible(), true);
    await page.screenshot({ path: "/tmp/onpeople-electron-agents-hidden.png" });

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.locator("#command-palette-search").fill("新建共享任务");
    await page.getByRole("button", { name: /新建共享任务/ }).click();
    assert.equal(await page.locator('[data-control-view="agents"]').isVisible(), true);
    assert.equal(await page.locator('[data-control-panel="agents"]').isVisible(), true);
    assert.equal(await page.locator("#agent-create").isVisible(), true);
    const boardLabels = await page.locator("[data-agent-board-state] span").allTextContents();
    assert.deepEqual(boardLabels, ["待领取", "运行中", "被依赖阻塞", "等待用户", "已完成", "失败"]);
    assert.match(await page.locator(".agent-dependency-field").innerText(), /依赖任务/);
    await page.screenshot({ path: "/tmp/onpeople-electron-board.png" });

    await page.locator("#control-advanced-toggle").click();
    const advancedTrigger = page.locator("#control-advanced-select").locator("xpath=..").locator(".op-select-trigger");
    await advancedTrigger.click();
    await page.locator('#onpeople-select-popover .op-select-option[data-value="policy"]').click();
    assert.equal(await page.locator("#control-advanced-select").inputValue(), "policy");
    assert.equal(await page.locator('[data-control-panel="policy"]').isVisible(), true);
    assert.equal(await page.locator('[data-control-view="agents"]').isHidden(), true);

    await page.evaluate(() => {
      renderAgents([{ id: "native-agent", status: "running" }], 4, { tasks: [], counts: {}, states: [] });
    });
    assert.equal(await page.locator('[data-control-view="agents"]').isVisible(), true);
    await page.evaluate(() => {
      renderAgents([], 4, { tasks: [], counts: {}, states: [] });
    });
    assert.equal(await page.locator('[data-control-view="agents"]').isHidden(), true);

    await page.evaluate(() => {
      window.__onpeopleE2EConfirm = null;
      window.OnPeopleUI.confirm("验证 OnPeople 自定义模态框", {
        title: "自定义确认框",
        confirmLabel: "确认测试",
      }).then((value) => { window.__onpeopleE2EConfirm = value; });
    });
    const dialog = page.locator("#onpeople-action-dialog");
    await dialog.waitFor({ state: "visible" });
    assert.equal(await dialog.locator("#op-dialog-title").textContent(), "自定义确认框");
    await page.screenshot({ path: "/tmp/onpeople-electron-dialog.png" });
    await dialog.locator(".op-dialog-confirm").click();
    await page.waitForFunction(() => window.__onpeopleE2EConfirm === true);

    await page.evaluate(() => {
      window.__onpeopleE2EDangerConfirm = null;
      window.OnPeopleUI.confirm(
        "OnPeople 将直接使用文件系统、网络、命令和普通工具，不再逐次请求批准。\n\n公开发布、购买和删除外部数据仍会单独向你确认。",
        {
          kicker: "权限范围",
          title: "开启完全访问",
          confirmLabel: "开启",
          cancelLabel: "保持请求批准",
          tone: "danger",
        },
      ).then((value) => { window.__onpeopleE2EDangerConfirm = value; });
    });
    await dialog.waitFor({ state: "visible" });
    assert.equal(await dialog.locator("#op-dialog-kicker").textContent(), "权限范围");
    assert.equal(await dialog.locator("#op-dialog-title").textContent(), "开启完全访问");
    assert.equal(await dialog.locator(".op-dialog-message p").count(), 2);
    assert.equal(await dialog.locator(".op-dialog-rail").isHidden(), true);
    const dangerDialogBounds = await dialog.boundingBox();
    assert.ok(dangerDialogBounds.width <= 390, "danger dialog should remain compact");
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/onpeople-electron-danger-dialog.png" });
    await dialog.locator(".op-dialog-cancel").click();
    await page.waitForFunction(() => window.__onpeopleE2EDangerConfirm === false);

    await page.screenshot({ path: "/tmp/onpeople-electron-e2e.png" });
    assert.deepEqual(errors, []);
    console.log("Electron UI E2E checks passed.");
  } finally {
    await application.close();
  }
}

run()
  .finally(() => fs.rmSync(temporary, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
