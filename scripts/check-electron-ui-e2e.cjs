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
  const packagedExecutablePath = String(process.env.ONPEOPLE_E2E_EXECUTABLE_PATH || "").trim();
  const executablePath = packagedExecutablePath || (process.platform === "darwin"
    ? path.join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
    : require("electron"));
  const application = await electronApi.launch({
    executablePath,
    args: packagedExecutablePath ? [] : [root],
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
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    await page.waitForSelector("#cwd", { state: "attached" });
    await page.waitForFunction(() => document.querySelector("#cwd")?.value === "");
    assert.doesNotMatch(await page.locator("#task-list").innerText(), /Error invoking remote method|Cannot read properties of undefined/);
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), true);
    assert.equal(await page.locator("#utility-panel").getAttribute("aria-hidden"), "true");
    assert.equal(await page.locator('[data-tool-view="browser"]').getAttribute("aria-pressed"), "false");
    assert.match(await page.locator("#prompt").getAttribute("placeholder"), /今天帮你做些什么/);
    await page.evaluate(() => {
      cloudAccountState = {
        ...cloudAccountState,
        signedIn: true,
        modelsLive: true,
        modelsError: null,
        account: { email: "test@onpeople.local", balanceUSD: 10, group: { id: 3, name: "Sol" } },
      };
      PROVIDER_PRESETS.onpeople.models = [
        { id: "gpt-5.6-terra", name: "gpt-5.6-terra", groupId: 4, groupName: "Terra" },
        { id: "gpt-5.6-sol", name: "gpt-5.6-sol", groupId: 3, groupName: "Sol" },
      ];
      providerSelect.value = "onpeople";
      modelInput.value = "";
      renderModelSource("onpeople");
      renderOnPeopleModelOptions(PROVIDER_PRESETS.onpeople.models);
      updateProviderFields();
    });
    assert.equal(await page.locator("#model").inputValue(), "gpt-5.6-sol");
    assert.equal(await page.locator("#task-model-picker").isVisible(), true);
    assert.equal(await page.locator("#task-model-label").textContent(), "5.6 Sol");
    assert.equal(await page.locator("#task-effort-label").textContent(), "高");
    await page.locator("#task-model-trigger").click();
    assert.equal(await page.locator("#task-model-popover").isVisible(), true);
    assert.equal(await page.locator("#task-model-options [data-model-id]").count(), 2);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      cloudAccountState = {
        ...cloudAccountState,
        signedIn: false,
        modelsLive: false,
        models: [],
        account: null,
      };
      PROVIDER_PRESETS.onpeople.models = [];
      renderProvider({ type: "openai", model: "gpt-5.6-terra", baseUrl: "https://api.openai.com/v1" });
    });
    await page.evaluate(() => {
      const panel = document.querySelector("#live-call-panel");
      panel.hidden = false;
      panel.classList.add("is-connecting");
      document.querySelector("#composer").classList.add("live-active");
      document.querySelector("#live-call-title").textContent = "正在连接 GPT-Live";
      document.querySelector("#live-call-status").textContent = "正在检查账户与语音权限";
      document.querySelector("#live-call-transcript").textContent = "建立安全的实时音频连接…";
    });
    const livePanelBounds = await page.locator("#live-call-panel").boundingBox();
    assert.ok(livePanelBounds.height <= 64, "GPT-Live status bar should remain compact");
    assert.equal(await page.locator("#live-mute svg").count(), 1);
    assert.equal(await page.locator("#live-end i").count(), 1);
    await page.screenshot({ path: "/tmp/onpeople-electron-live-bar.png" });
    const liveCompletionRecovery = await page.evaluate(() => {
      const sent = [];
      currentThreadId = "live-completion-test";
      currentTurnStartedAt = Date.now() - 5_000;
      setRunning(true);
      ensureProcessFlow();
      liveConversation = {
        sessionId: "new-live-session",
        dataChannel: {
          readyState: "open",
          send: (value) => sent.push(JSON.parse(value)),
        },
      };
      pendingLiveDelegation = {
        itemId: "delegation-from-old-session",
        native: true,
        source: "native",
        text: "读取 package.json",
        liveSessionId: "old-live-session",
        traceId: "live-completion-recovery",
        threadId: currentThreadId,
        turnStarted: true,
        waitTimer: null,
      };
      const recovered = reconcileCurrentThreadTerminalState({
        threadId: currentThreadId,
        status: "idle",
        completedAt: Date.now(),
        finalText: "name=internal-agent-workbench version=0.29.18",
      });
      return {
        recovered,
        running,
        pending: pendingLiveDelegation,
        sent,
        flowLabel: document.querySelector(".process-flow:last-of-type .process-flow-toggle strong")?.textContent,
        panelTitle: document.querySelector("#live-call-title")?.textContent,
      };
    });
    assert.equal(liveCompletionRecovery.recovered, true);
    assert.equal(liveCompletionRecovery.running, false);
    assert.equal(liveCompletionRecovery.pending, null);
    assert.equal(liveCompletionRecovery.sent.length, 0, "an old delegation must not write into a newer Live session");
    assert.equal(liveCompletionRecovery.flowLabel, "已处理");
    assert.equal(liveCompletionRecovery.panelTitle, "任务结果已记录");
    const delegatedTaskSurvivesLiveEnd = await page.evaluate(() => {
      const delegation = {
        itemId: "delegation-in-flight",
        native: true,
        source: "native",
        text: "继续执行",
        liveSessionId: "closing-live-session",
        traceId: "live-survives-close",
        threadId: "live-completion-test",
        turnStarted: true,
        waitTimer: null,
      };
      pendingLiveDelegation = delegation;
      liveConversation = {
        sessionId: "closing-live-session",
        callId: null,
        dataChannel: { readyState: "closed", close() {} },
        peerConnection: { close() {} },
        localStream: { getTracks: () => [] },
        durationTimer: null,
      };
      releaseLiveConversation();
      const survived = pendingLiveDelegation === delegation;
      pendingLiveDelegation = null;
      return survived;
    });
    assert.equal(delegatedTaskSurvivesLiveEnd, true, "ending Live must not cancel or forget the delegated task");
    await page.evaluate(() => {
      currentThreadId = null;
      currentTurnStartedAt = null;
      liveConversation = null;
      pendingLiveDelegation = null;
      resetTimeline();
      setRunning(false);
      document.querySelector("#live-call-panel").hidden = true;
      document.querySelector("#live-call-panel").classList.remove("is-connecting");
      document.querySelector("#composer").classList.remove("live-active");
    });
    const brandMarkBounds = await page.locator(".brand-mark").boundingBox();
    const welcomeMarkBounds = await page.locator(".welcome-mark").boundingBox();
    assert.ok(brandMarkBounds.width >= 30, "sidebar brand mark should be visually prominent");
    assert.ok(welcomeMarkBounds.width >= 58, "welcome mark should anchor the empty state");
    await page.locator("#cloud-account-open").click();
    assert.equal(await page.locator("#settings-center").isVisible(), true);
    assert.equal(await page.locator("#app-shell").getAttribute("aria-hidden"), "true");
    assert.equal(await page.locator("#settings-profile-page").isVisible(), true);
    assert.equal(await page.locator("#usage-profile-view").isVisible(), true);
    assert.equal(await page.locator(".app-sidebar > .runtime-settings").count(), 0);
    await page.locator("#usage-profile-account").click();
    assert.equal(await page.locator("#cloud-account-dialog").evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator("#settings-center").isVisible(), true);
    await page.locator("#cloud-account-close").click();
    assert.equal(await page.locator("#cloud-account-dialog").evaluate((dialog) => dialog.open), false);
    assert.equal(await page.locator("#settings-center").isVisible(), true);
    assert.equal(await page.locator("#settings-profile-page").isVisible(), true);
    await page.screenshot({ path: "/tmp/onpeople-electron-profile-center.png" });
    await page.locator("[data-settings-route='general']").click();
    assert.equal(await page.locator("[data-settings-permission]").count(), 3);
    assert.equal(await page.locator("[data-settings-permission][aria-checked='true']").count(), 1);
    await page.locator("[data-settings-route='plugins']").click();
    assert.equal(await page.locator("#settings-live-title").textContent(), "插件");
    assert.equal(await page.locator("#settings-live-host .extensions-view").isVisible(), true);
    assert.equal(await page.locator("#settings-live-host [data-extension-list='plugins']").isVisible(), true);
    await page.locator("[data-settings-route='hooks']").click();
    await page.waitForFunction(() => document.querySelector("#settings-live-title")?.textContent === "钩子");
    assert.equal(await page.locator("#settings-live-title").textContent(), "钩子");
    assert.equal(await page.locator("#settings-live-host .settings-hooks-manager").isVisible(), true);
    assert.equal(await page.locator("#settings-hook-create").isVisible(), true);
    await page.locator("#settings-hook-event").click();
    assert.equal(await page.locator("#settings-hook-event-menu").isVisible(), true);
    await page.locator("#settings-hook-event-menu button", { hasText: "PostToolUse" }).click();
    assert.equal(await page.locator("#settings-hook-event strong").textContent(), "PostToolUse");
    await page.locator("[data-settings-route='connections']").click();
    assert.equal(await page.locator("#settings-live-title").textContent(), "连接");
    assert.equal(await page.locator("#settings-live-host [data-control-panel='config']").isVisible(), true);
    await page.locator("[data-settings-route='hooks']").click();
    await page.waitForFunction(() => document.querySelector("#settings-live-title")?.textContent === "钩子");
    assert.equal(await page.locator("#settings-live-title").textContent(), "钩子");
    assert.equal(await page.locator("#settings-live-host .settings-hooks-manager").isVisible(), true);
    await page.locator("[data-settings-route='environment']").click();
    assert.equal(await page.locator("#settings-live-title").textContent(), "环境");
    assert.equal(await page.locator("#settings-live-host [data-control-panel='config']").isVisible(), true);
    await page.locator("[data-settings-route='git']").click();
    await page.waitForFunction(() => document.querySelector("#settings-live-title")?.textContent === "Git");
    assert.equal(await page.locator("#settings-live-title").textContent(), "Git");
    assert.equal(await page.locator("#settings-live-host .settings-git-manager").isVisible(), true);
    assert.equal(await page.locator("#settings-git-open").isVisible(), true);
    await page.waitForFunction(() => document.querySelector("#settings-git-heading")?.textContent !== "正在读取当前工作区…");
    await page.locator("[data-settings-route='environment']").click();
    assert.equal(await page.locator("#settings-live-title").textContent(), "环境");
    await page.locator("[data-settings-route='git']").click();
    await page.waitForFunction(() => document.querySelector("#settings-live-title")?.textContent === "Git");
    assert.equal(await page.locator("#settings-live-title").textContent(), "Git");
    assert.equal(await page.locator("#settings-live-host .settings-git-manager").isVisible(), true);
    await page.locator("[data-settings-route='worktrees']").click();
    assert.equal(await page.locator("#settings-live-page").isVisible(), true);
    assert.equal(await page.locator("#settings-live-title").textContent(), "工作树");
    assert.equal(await page.locator("#settings-live-host [data-control-panel='worktrees']").isVisible(), true);
    assert.equal(await page.locator("#worktree-create").isVisible(), true);
    await page.waitForFunction(() => document.querySelector("#worktree-root")?.textContent.includes("不是 Git 项目"));
    assert.equal(await page.locator('#worktree-create button[type="submit"]').isDisabled(), true);
    assert.match(await page.locator("#worktree-root").textContent(), /不是 Git 项目/);
    assert.match(await page.locator("#worktree-list").textContent(), /选择一个 Git 项目|初始化当前目录/);
    await page.locator("[data-settings-route='general']").click();
    assert.equal(await page.locator(".control-view [data-control-panel='worktrees']").count(), 1);
    await page.locator("[data-settings-toggle='preventSleepWhileRunning']").click();
    assert.equal(
      await page.locator("[data-settings-toggle='preventSleepWhileRunning']").getAttribute("aria-checked"),
      "true",
    );
    await page.locator("[data-settings-route='appearance']").click();
    assert.equal(await page.locator("#settings-appearance-page").isVisible(), true);
    await page.locator("#settings-theme").selectOption("dark");
    await page.waitForFunction(() => document.documentElement.dataset.resolvedTheme === "dark");
    await page.locator("#settings-density").selectOption("compact");
    assert.equal(await page.locator("html").getAttribute("data-density"), "compact");
    await page.locator("[data-settings-toggle='reduceMotion']").click();
    assert.equal(await page.locator("html").getAttribute("data-reduce-motion"), "true");
    await page.locator("#settings-theme").selectOption("light");
    await page.locator("#settings-density").selectOption("comfortable");
    await page.locator("[data-settings-toggle='reduceMotion']").click();

    await page.locator("[data-settings-route='voice']").click();
    assert.equal(await page.locator("#settings-voice-page").isVisible(), true);
    await page.waitForFunction(() => !document.querySelector("#settings-live-refresh")?.disabled);
    assert.match(await page.locator("#settings-live-status-title").textContent(), /GPT-Live/);
    await page.locator("#settings-live-voice").selectOption("cove");
    assert.equal((await page.evaluate(() => window.workbench.getPreferences())).liveVoice, "cove");
    await page.locator("[data-settings-toggle='liveNoiseSuppression']").click();
    assert.equal(
      (await page.evaluate(() => window.workbench.getPreferences())).liveNoiseSuppression,
      false,
    );

    await page.locator("[data-settings-route='personalization']").click();
    assert.equal(await page.locator("#settings-personalization-page").isVisible(), true);
    await page.locator("#settings-custom-instructions").fill("回答使用中文，并在交付前运行验证。");
    await page.locator("#settings-personalization-save").click();
    await page.waitForFunction(() => document.querySelector("#settings-personalization-status")?.textContent.includes("已保存"));
    assert.equal(
      (await page.evaluate(() => window.workbench.getPreferences())).customInstructions,
      "回答使用中文，并在交付前运行验证。",
    );
    await page.locator("#settings-memory-generate").click();
    assert.equal(await page.locator("#settings-memory-generate").getAttribute("aria-checked"), "true");

    await page.locator("[data-settings-route='pet']").click();
    assert.equal(await page.locator("#settings-pet-page").isVisible(), true);
    assert.ok(await page.locator("#settings-pet-skin option").count() >= 1);

    await page.locator("[data-settings-route='shortcuts']").click();
    assert.equal(await page.locator("#settings-shortcuts-page").isVisible(), true);
    assert.ok(await page.locator("#settings-shortcuts-list .settings-shortcut-row").count() >= 6);
    await page.locator("#settings-shortcuts-search").fill("浏览器");
    assert.ok(await page.locator("#settings-shortcuts-list .settings-shortcut-row").count() >= 1);
    assert.match(await page.locator("#settings-shortcuts-list").innerText(), /浏览器/);

    await page.locator("[data-settings-route='browser']").click();
    assert.equal(await page.locator("#settings-browser-page").isVisible(), true);
    await page.locator("[data-settings-toggle='browserEnabled']").click();
    assert.equal(await page.locator("html").evaluate((element) => element.classList.contains("browser-disabled")), true);
    assert.equal(await page.locator('[data-tool-view="browser"]').isHidden(), true);
    await page.locator("[data-settings-toggle='browserEnabled']").click();
    assert.equal(await page.locator('[data-tool-view="browser"]').isVisible(), true);
    await page.screenshot({ path: "/tmp/onpeople-electron-settings.png" });
    await page.locator("#settings-close").click();
    assert.equal(await page.locator("#settings-center").isHidden(), true);
    assert.equal(await page.locator("#app-shell").getAttribute("aria-hidden"), null);
    assert.equal(await page.locator(".topbar .permission-control").count(), 0);
    assert.equal(await page.locator(".composer-context-row .permission-control").isVisible(), true);
    assert.equal(await page.locator("#composer-workspace-label").textContent(), "独立空间");
    await page.locator("#composer-workspace").click();
    assert.equal(await page.locator("#composer-workspace-menu").isVisible(), true);
    assert.deepEqual(
      await page.locator("#composer-workspace-menu [data-workspace-mode] strong").allTextContents(),
      ["新建工作空间", "打开本地文件夹", "Git Worktree"],
    );
    assert.equal(await page.locator("#composer-workspace-search").isVisible(), false);
    assert.equal(await page.locator(".composer-workspace-section").isVisible(), false);
    assert.equal(
      await page.locator('#composer-workspace-menu [data-workspace-mode="isolated"]').getAttribute("aria-checked"),
      "true",
    );
    await page.waitForTimeout(180);
    await page.screenshot({ path: "/tmp/onpeople-electron-workspace-menu.png" });
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      selectedProjectPath = "/workspace/project-b";
      renderThreads([
        {
          id: "pinned-from-another-project",
          name: "全局置顶任务",
          preview: "全局置顶任务",
          projectPath: "/workspace/project-a",
          cwd: "/workspace/project-a",
          pinned: true,
          status: { type: "saved" },
        },
        {
          id: "regular-project-task",
          name: "项目 B 普通任务",
          preview: "项目 B 普通任务",
          projectPath: "/workspace/project-b",
          cwd: "/workspace/project-b",
          pinned: false,
          status: { type: "saved" },
        },
        {
          id: "regular-other-project-task",
          name: "项目 A 普通任务",
          preview: "项目 A 普通任务",
          projectPath: "/workspace/project-a",
          cwd: "/workspace/project-a",
          pinned: false,
          status: { type: "saved" },
        },
      ]);
    });
    assert.equal(await page.locator("#pinned-section").isVisible(), true);
    assert.equal(await page.locator("#pinned-task-list .task-row").count(), 1);
    assert.match(await page.locator("#pinned-task-list").innerText(), /全局置顶任务/);
    assert.equal(await page.locator("#task-list .task-row").count(), 2);
    assert.match(await page.locator("#task-list").innerText(), /项目 B 普通任务/);
    assert.match(await page.locator("#task-list").innerText(), /项目 A 普通任务/);
    const canScrollSidebar = await page.evaluate(() => {
      const nav = document.querySelector(".task-nav");
      nav.style.flex = "none";
      nav.style.height = "220px";
      selectedProjectPath = "/workspace/project-b";
      renderThreads(Array.from({ length: 24 }, (_, index) => ({
        id: `scroll-task-${index}`,
        name: `滚动任务 ${index + 1}`,
        preview: `滚动任务 ${index + 1}`,
        projectPath: index % 2 ? "/workspace/project-a" : "/workspace/project-b",
        cwd: index % 2 ? "/workspace/project-a" : "/workspace/project-b",
        pinned: index === 0,
        status: { type: "saved" },
      })));
      const overflowed = nav.scrollHeight > nav.clientHeight;
      nav.scrollTop = 120;
      return overflowed && nav.scrollTop > 0;
    });
    assert.equal(canScrollSidebar, true);
    await page.evaluate(() => {
      const nav = document.querySelector(".task-nav");
      nav.style.flex = "";
      nav.style.height = "";
      selectedProjectPath = null;
      renderThreads([]);
    });
    const attachBounds = await page.locator("#attach-image").boundingBox();
    const sendBounds = await page.locator("#send").boundingBox();
    const surfaceBounds = await page.locator(".composer-surface").boundingBox();
    const contextBounds = await page.locator(".composer-context-row").boundingBox();
    assert.ok(attachBounds.x < sendBounds.x, "add control should sit to the left of send");
    assert.equal(await page.locator("#stop").count(), 0, "stop and send should use one primary action");
    assert.equal(await page.locator("#send").getAttribute("data-action"), "send");
    await page.evaluate(() => setRunning(true));
    assert.equal(await page.locator("#send").getAttribute("data-action"), "stop");
    assert.equal(await page.locator("#send").getAttribute("aria-label"), "停止当前任务");
    await page.locator("#prompt").fill("补充一条指令");
    assert.equal(await page.locator("#send").getAttribute("data-action"), "send");
    assert.equal(await page.locator("#send").getAttribute("aria-label"), "发送补充指令");
    await page.locator("#prompt").fill("");
    assert.equal(await page.locator("#send").getAttribute("data-action"), "stop");
    await page.evaluate(() => setRunning(false));
    assert.equal(await page.locator("#send").getAttribute("data-action"), "send");
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

    await page.locator("#cloud-account-open").click();
    await page.locator("[data-settings-route='configuration']").click();
    assert.equal(await page.locator("#settings-runtime-page").isVisible(), true);
    assert.equal(await page.locator("details.runtime-settings").getAttribute("open"), "");
    await page.screenshot({ path: "/tmp/onpeople-electron-runtime-settings.png" });
    await page.locator("#cwd").fill(alternateWorkspace);
    await page.locator("#cwd").dispatchEvent("change");
    assert.equal(await page.locator("#cwd").inputValue(), alternateWorkspace);
    assert.equal(await page.locator("#composer-workspace-label").textContent(), `本地项目 · ${path.basename(alternateWorkspace)}`);
    await page.locator("#settings-close").click();
    await page.locator("#composer-workspace").click();
    assert.equal(await page.locator("#composer-workspace-menu").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.evaluate((workspace) => {
      setThreadHeader({
        id: "019fa000-0000-7000-8000-000000000001",
        name: "已有任务",
        cwd: workspace,
        workspaceMode: "local",
        workspaceBaseCwd: workspace,
      });
    }, alternateWorkspace);
    assert.equal(await page.locator("#composer-workspace").isEnabled(), true);
    await page.locator("#composer-workspace").click();
    assert.equal(await page.locator("#composer-workspace-menu").isVisible(), true);
    await page.locator('#composer-workspace-menu [data-workspace-mode="isolated"]').click();
    await page.waitForFunction(() => document.querySelector("#thread-label")?.textContent === "NEW THREAD");
    assert.equal(await page.locator("#composer-workspace-label").textContent(), "独立空间");
    await page.locator('[data-tool-view="browser"]').click();
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), false);
    await page.locator("#new-task").click();
    await page.waitForFunction(() => document.querySelector("#cwd")?.value === "");
    assert.equal(await page.locator("#composer-workspace-label").textContent(), "独立空间");
    assert.equal(await page.locator("#content-area").evaluate((element) => element.classList.contains("utility-collapsed")), true);

    await page.locator('[data-tool-view="control"]').click();
    await page.waitForFunction(() => document.querySelector('[data-view="control"]')?.classList.contains("active"));
    assert.equal(await page.locator('[data-control-view="agents"]').isHidden(), true);
    assert.equal(await page.locator('[data-control-panel="diagnostics"]').isVisible(), true);
    assert.equal(await page.locator('[data-control-view="scheduled"]').count(), 0);
    await page.screenshot({ path: "/tmp/onpeople-electron-agents-hidden.png" });

    await page.locator("#scheduled-nav").click();
    assert.equal(await page.locator("#scheduled-center").isVisible(), true);
    assert.equal(await page.locator("#scheduled-inbox-view").isVisible(), true);
    assert.equal(await page.locator("#scheduled-runs-section").isHidden(), true);
    await page.locator("#scheduled-create-open").click();
    assert.equal(await page.locator("#scheduled-create-view").isVisible(), true);
    assert.match(await page.locator("#scheduled-create-view").innerText(), /任务描述/);
    assert.match(await page.locator("#scheduled-create-view").innerText(), /项目/);
    assert.match(await page.locator("#scheduled-create-view").innerText(), /执行频率/);
    assert.equal(await page.locator("#scheduled-advanced").getAttribute("open"), null);
    await page.locator("#scheduled-center").screenshot({ path: "/tmp/onpeople-electron-scheduled-create.png" });
    await page.locator("#scheduled-center-close").click();
    assert.equal(await page.locator("#scheduled-center").isHidden(), true);
    await page.evaluate((workspace) => {
      document.querySelector("#cwd").value = workspace;
    }, defaultWorkspace);
    await page.locator("#prompt").fill("每天 9 点检查项目");
    await page.locator("#composer").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector("#timeline")?.textContent.includes("已创建"));
    await page.locator("#scheduled-nav").click();
    assert.match(await page.locator("#scheduled-task-list").innerText(), /检查项目/);
    await page.locator("#scheduled-center-close").click();

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
    await page.locator("#control-advanced-select").selectOption("policy");
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
    if (process.platform === "darwin") {
      await page.close();
      const reopenedWindow = application.waitForEvent("window", { timeout: 10_000 });
      await application.evaluate(({ app }) => app.emit("activate"));
      const reopenedPage = await reopenedWindow;
      await reopenedPage.waitForSelector("#new-task");
      assert.equal(await reopenedPage.title(), "OnPeople");
      assert.equal(await reopenedPage.locator("body").isVisible(), true);
    }
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
