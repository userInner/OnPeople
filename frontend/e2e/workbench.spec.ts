import { expect, test } from "@playwright/test";

test("renders the final workbench shell without overlapping primary regions", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "OnPeople" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新对话", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /新对话/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "工具舱" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "工具舱" })
      .getByText("输出", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "任务输入" })).toBeVisible();
  await page.getByRole("button", { name: "搜索" }).click();
  await page.getByRole("searchbox", { name: "搜索任务" }).fill("不存在的任务");
  await expect(page.getByText("没有匹配的任务", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索任务" }).fill("");
  await page.getByRole("button", { name: "搜索" }).click();
  if ((page.viewportSize()?.width ?? 0) <= 820) {
    await page
      .getByRole("complementary", { name: "工具舱" })
      .getByRole("button", { name: "显示/隐藏工具舱" })
      .click();
  }
  await page.getByRole("button", { name: "添加文件、技能与能力" }).click();
  const toolsMenu = page.getByRole("menu", {
    name: "添加文件、技能与能力",
  });
  await expect(toolsMenu).toBeVisible();
  await expect(
    toolsMenu.getByRole("menuitem", { name: /添加文件或图片/ }),
  ).toBeVisible();
  await expect(
    toolsMenu.getByRole("menuitem", { name: /计划模式/ }),
  ).toBeVisible();
  await expect(
    toolsMenu.getByRole("menuitem", { name: /电脑操控/ }),
  ).toBeVisible();
  await expect(
    toolsMenu.getByRole("menuitem", { name: /图像生成/ }),
  ).toBeVisible();
  await toolsMenu.getByRole("menuitem", { name: /电脑操控/ }).click();
  await expect(page.getByTitle("能力：电脑操控")).toBeVisible();
  await expect(page.getByRole("button", { name: "上一个对话" })).toBeDisabled();
  await page.getByRole("button", { name: "任务操作" }).click();
  await expect(page.getByRole("menu", { name: "任务操作" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /新对话/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /新对话/ }).click();
  await expect(page.getByRole("menu", { name: "任务操作" })).toBeHidden();
  await page.getByRole("button", { name: "任务操作" }).click();
  await page.getByRole("button", { name: "OnPeople" }).first().click();
  await expect(page.getByRole("menu", { name: "任务操作" })).toBeHidden();
  await expect(page.getByRole("menu", { name: "OnPeople 菜单" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "任务操作" })).toBeHidden();
  if (page.viewportSize()?.width && page.viewportSize()!.width > 820) {
    await page.getByRole("button", { name: "打开工具舱" }).click();
  }

  if (page.viewportSize()?.width && page.viewportSize()!.width > 820) {
    const sidebar = await page.locator(".sidebar").boundingBox();
    const main = await page.locator(".main-column").boundingBox();
    const utility = await page.locator(".utility-pane").boundingBox();
    if (sidebar && main)
      expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(main.x + 1);
    if (main && utility)
      expect(main.x + main.width).toBeLessThanOrEqual(utility.x + 2);
  }
});

test("renders active Codex-style task state and contextual output", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "OnPeople" }).first(),
  ).toBeVisible();

  await page.evaluate(() => {
    const now = new Date().toISOString();
    window.__ONPEOPLE_DEV__?.setWorkbenchState({
      initialized: true,
      loading: false,
      error: null,
      selectedThreadId: "demo",
      threadList: {
        threads: [
          {
            id: "demo",
            title: "重构 OnPeople 为 Tauri",
            cwd: "/Users/demo/OnPeople",
            projectPath: "/Users/demo/OnPeople",
            status: "ready",
            pinned: true,
            archived: false,
            unread: false,
            model: "gpt-5.6",
            reasoningEffort: "xhigh",
            createdAt: now,
            updatedAt: now,
          },
        ],
        projects: [
          {
            name: "OnPeople",
            path: "/Users/demo/OnPeople",
            pinned: false,
            hidden: false,
            threadCount: 1,
            archivedThreadCount: 0,
            updatedAt: now,
          },
        ],
      },
      timeline: [
        {
          id: "user",
          role: "user",
          kind: "message",
          text: "将 UI 和所有工作流完整对齐 Codex。",
          timestamp: new Date(Date.now() - 12_000).toISOString(),
        },
        {
          id: "reasoning",
          role: "assistant",
          kind: "reasoning",
          title: "正在检查界面与交互",
          text: "逐项核对侧栏、执行流、输入框和输出面板。",
          pending: true,
        },
        {
          id: "files",
          role: "tool",
          kind: "file-change",
          title: "已修改 2 个文件",
          text: "frontend/src/App.tsx\nfrontend/src/codex-parity.css",
          status: "completed",
          stats: { files: 2, added: 18, removed: 4 },
        },
        {
          id: "agent",
          role: "tool",
          kind: "tool",
          title: "Agent 协作",
          text: "检查设置与快捷键",
          status: "completed",
        },
        {
          id: "source",
          role: "tool",
          kind: "tool",
          title: "搜索网页",
          text: "https://openai.com/codex",
          status: "completed",
        },
        {
          id: "command",
          role: "tool",
          kind: "command",
          title: "正在运行命令",
          text: "npm test",
          status: "进行中",
          pending: true,
        },
      ],
      runtime: {
        state: "working",
        threadId: "demo",
        turnId: "turn-1",
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
      status: {
        ready: true,
        runtime: "codex-app-server",
        version: "0.30.0",
        defaultCwd: "/Users/demo/OnPeople",
        windowThreadId: "demo",
        goal: {
          id: "goal",
          threadId: "demo",
          objective: "UI 功能完全对齐 Codex",
          status: "active",
          tokenBudget: null,
          tokensUsed: 0n,
          createdAt: now,
          updatedAt: now,
        },
        provider: {
          kind: "onpeople",
          name: "OnPeople",
          protocol: "responses",
          baseUrl: "",
          model: "gpt-5.6",
          vision: true,
          apiKeySet: true,
          extra: {},
        },
        policy: {
          sandbox: "danger-full-access",
          approvalPolicy: "never",
          reviewer: "user",
          network: true,
          multiAgent: true,
          maxConcurrentAgents: 4,
        },
        capabilities: {},
      },
      utilityOpen: true,
      toolView: "activity",
    });
  });

  await expect(
    page.getByText("重构 OnPeople 为 Tauri", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText("进行中的目标")).toBeVisible();
  await expect(page.getByRole("button", { name: "停止任务" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) <= 820) {
    await page
      .getByRole("complementary", { name: "工具舱" })
      .getByRole("button", { name: "显示/隐藏工具舱" })
      .click();
  }
  const activity = page.locator("main .timeline");
  const executionHeadline = activity.locator(
    ".activity-summary > summary strong",
  );
  await expect(executionHeadline).toHaveText("正在运行 npm test");
  await expect(activity.getByText("正在处理", { exact: true })).toBeVisible();
  await expect(activity.getByText(/1\d+s/, { exact: true })).toBeVisible();
  await executionHeadline.click();
  await expect(
    activity.getByText("已修改 2 个文件", { exact: true }),
  ).toHaveCount(1);
  await expect(
    activity.getByText("frontend/src/App.tsx", { exact: true }),
  ).toHaveCount(1);
  await expect(
    activity.getByText("https://openai.com/codex", { exact: true }),
  ).toHaveCount(1);

  const threadRow = page
    .getByRole("menu", { name: "切换项目" })
    .getByRole("menuitem", { name: /重构 OnPeople 为 Tauri/ })
    .first();
  await threadRow.click({ button: "right" });
  const threadMenu = page.getByRole("menu", {
    name: "任务操作：重构 OnPeople 为 Tauri",
  });
  await expect(threadMenu).toBeVisible();
  await expect(
    threadMenu.getByRole("menuitem", { name: "重命名任务" }),
  ).toBeVisible();
  await expect(
    threadMenu.getByRole("menuitem", { name: "复制深度链接" }),
  ).toBeVisible();
  await expect(
    threadMenu.getByRole("menuitem", { name: "在新窗口中打开" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    window.__ONPEOPLE_DEV__?.setWorkbenchState({
      runtime: {
        state: "ready",
        threadId: "demo",
        turnId: null,
        queuedMessages: 0,
        pendingApprovals: 0,
        context: null,
      },
    });
  });
  await page.getByRole("button", { name: /5\.6 Luna.*极高/ }).click();
  await expect(page.getByText("模型", { exact: true })).toBeVisible();
  await expect(page.getByText("推理强度", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /推理强度/ }).click();
  await expect(
    page.getByRole("button", { name: "极高", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "极高", exact: true }).click();
  await page.locator("button.model-selector").click();
  await page.getByRole("button", { name: /速度/ }).click();
  await expect(
    page.getByRole("button", { name: "快速", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "快速", exact: true }).click();
});

test("shows approval decisions and queue semantics during an active turn", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.__ONPEOPLE_DEV__?.setWorkbenchState({
      initialized: true,
      loading: false,
      selectedThreadId: "approval-thread",
      runtime: {
        state: "waiting-approval",
        threadId: "approval-thread",
        turnId: "turn-approval",
        queuedMessages: 2,
        pendingApprovals: 1,
        context: null,
      },
      timeline: [
        {
          id: "approval-request-7",
          role: "tool",
          kind: "approval",
          title: "批准命令执行",
          text: "npm test\n工作目录：/Users/demo/OnPeople",
          meta: "item/commandExecution/requestApproval",
          status: "需要确认",
          pending: true,
          requestId: "request-7",
          approvalMethod: "item/commandExecution/requestApproval",
        },
      ],
    });
  });

  await expect(page.getByText("批准命令执行", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "拒绝" })).toBeVisible();
  await expect(page.getByRole("button", { name: "允许一次" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "本次会话允许" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "任务输入" })).toHaveAttribute(
    "placeholder",
    /加入队列/,
  );

  await page.getByRole("textbox", { name: "任务输入" }).fill("完成后继续检查");
  await expect(
    page.getByRole("button", { name: "加入消息队列" }),
  ).toBeVisible();
});

test("keeps Codex keyboard surfaces and settings navigation available", async ({
  page,
}) => {
  await page.goto("/");

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("button", { name: /打开终端/ })).toBeVisible();
  await expect(
    palette.getByRole("button", { name: /打开文件夹/ }),
  ).toBeVisible();
  await expect(
    palette.getByRole("button", { name: /打开已安排任务/ }),
  ).toBeVisible();
  await expect(
    palette.getByRole("button", { name: /打开任务管理器/ }),
  ).toBeVisible();
  await expect(
    palette.getByRole("button", { name: /管理连接与 MCP/ }),
  ).toBeVisible();
  const paletteSearch = palette.getByRole("textbox", { name: "搜索命令" });
  await paletteSearch.fill("故障");
  await expect(
    palette.getByRole("button", { name: /打开环境与故障排除/ }),
  ).toBeVisible();
  await paletteSearch.press("Enter");
  await expect(palette).toBeHidden();
  const diagnosticsSettings = page.getByRole("dialog", {
    name: "OnPeople 设置",
  });
  await expect(
    diagnosticsSettings.getByRole("heading", {
      name: "环境",
      level: 1,
    }),
  ).toBeVisible();
  await diagnosticsSettings.getByRole("button", { name: "关闭设置" }).click();

  await page.keyboard.press("Control+k");
  await paletteSearch.fill("打开");
  await paletteSearch.press("ArrowDown");
  await paletteSearch.press("ArrowDown");
  const selectedCommand = palette.locator("button.is-selected");
  await expect(selectedCommand).toHaveCount(1);
  await expect(selectedCommand).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+j");
  const bottomPanel = page.getByRole("region", { name: "底部面板" });
  await expect(bottomPanel).toBeVisible();
  await expect(
    bottomPanel.getByText("终端", { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(bottomPanel).toBeHidden();

  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "OnPeople 设置" });
  await expect(settings).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "电脑操控" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Git", exact: true }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "外观" }).click();
  await expect(settings.getByRole("heading", { name: "外观" })).toBeVisible();
  await expect(settings.getByRole("combobox").first()).toBeVisible();
  await settings.getByRole("button", { name: "关闭设置" }).click();
  await expect(settings).toBeHidden();

  await page.getByRole("button", { name: "OnPeople" }).first().click();
  await expect(page.getByRole("menu", { name: "OnPeople 菜单" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /扩展与运行时/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("menu", { name: "OnPeople 菜单" })).toBeHidden();
  await page.getByRole("button", { name: "OnPeople" }).first().click();
  await expect(page.getByRole("menu", { name: "OnPeople 菜单" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "OnPeople 菜单" })).toBeHidden();
});

test("opens functional primary workspaces instead of placeholder cards", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "OnPeople" }).first(),
  ).toBeVisible();

  await page.evaluate(() => {
    const now = new Date().toISOString();
    window.__ONPEOPLE_DEV__?.setWorkbenchState({
      initialized: true,
      loading: false,
      status: {
        ready: true,
        runtime: "codex-app-server",
        version: "0.30.0",
        defaultCwd: "/Users/demo/OnPeople",
        windowThreadId: null,
        goal: null,
        provider: {
          kind: "onpeople",
          name: "OnPeople",
          protocol: "responses",
          baseUrl: "",
          model: "gpt-5.6",
          vision: true,
          apiKeySet: true,
          extra: {},
        },
        policy: {
          sandbox: "danger-full-access",
          approvalPolicy: "never",
          reviewer: "user",
          network: true,
          multiAgent: true,
          maxConcurrentAgents: 4,
        },
        capabilities: {},
      },
      scheduler: {
        unread: 1,
        tasks: [
          {
            id: "daily-review",
            name: "每日项目检查",
            prompt: "检查测试、类型和未提交更改。",
            cwd: "/Users/demo/OnPeople",
            enabled: true,
            schedule: { kind: "interval", intervalMinutes: 1440 },
            runtime: { mode: "local" },
            nextRunAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ],
        runs: [
          {
            id: "run-1",
            taskId: "daily-review",
            status: "completed",
            startedAt: now,
            finishedAt: now,
            threadId: null,
            message: "检查完成",
            unread: true,
          },
        ],
      },
      browser: {
        hostReady: true,
        hostStatus: "ready",
        activeRouteId: "route-docs",
        profilePath: "/tmp/onpeople-browser-profile",
        tabs: [
          {
            routeId: "route-docs",
            threadId: "main",
            url: "https://openai.com/codex",
            title: "Codex",
            faviconUrl: null,
            loading: false,
            canGoBack: false,
            canGoForward: false,
            crashed: false,
          },
          {
            routeId: "route-app",
            threadId: "main",
            url: "http://127.0.0.1:1420",
            title: "OnPeople",
            faviconUrl: null,
            loading: false,
            canGoBack: true,
            canGoForward: false,
            crashed: false,
          },
        ],
      },
    });
  });

  await page
    .locator(".codex-primary-nav")
    .getByRole("button", { name: /^已安排/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "已安排", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "计划任务" })).toBeVisible();
  await expect(
    page.locator(".scheduled-list").getByText("每日项目检查"),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "运行历史" })).toBeVisible();

  await page.getByRole("button", { name: "拉取请求", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "拉取请求", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "准备拉取请求" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "站点", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "站点", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "浏览器地址" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Codex" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "OnPeople" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建浏览器标签页" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "标注", exact: true }).click();
  const annotations = page.getByRole("region", { name: "页面标注" });
  await expect(annotations).toBeVisible();
  await expect(
    annotations.getByRole("textbox", { name: "标注内容" }),
  ).toBeVisible();
  await annotations.getByRole("button", { name: "关闭页面标注" }).click();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  const browserSession = page.getByRole("region", {
    name: "登录与浏览器数据",
  });
  await expect(
    browserSession.getByRole("button", { name: "打开登录页" }),
  ).toBeVisible();
  await expect(
    browserSession.getByRole("button", { name: "填充已保存凭据" }),
  ).toBeVisible();
  await browserSession
    .getByRole("button", { name: "关闭登录与浏览器数据" })
    .click();

  await page.evaluate(() => {
    if (!window.__ONPEOPLE_DEV__) return;
    window.__ONPEOPLE_DEV__.invoke = async (command) => {
      if (command === "list_extensions") {
        return {
          plugins: [],
          skills: [],
          mcpServers: [],
          connectors: [],
        };
      }
      throw new Error(`Unexpected E2E desktop command: ${command}`);
    };
  });
  await page.getByRole("button", { name: "插件", exact: true }).click();
  await expect(page.locator(".primary-workspace-plugins")).toBeVisible();
  await expect(page.locator(".extensions-workspace")).toBeVisible();
  await expect(page.getByText("管理计划任务")).toHaveCount(0);
});
