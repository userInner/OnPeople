import {
  Archive,
  ArrowLeft,
  Boxes,
  BrainCircuit,
  Check,
  CircleUserRound,
  Cloud,
  Code2,
  Download,
  FolderGit2,
  Gauge,
  GitBranch,
  Globe2,
  Keyboard,
  Mic2,
  Palette,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  UserRound,
  Webhook,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import { errorMessage } from "../lib/errors";
import { useWorkbenchStore } from "../store/workbenchStore";
import type {
  AppUpdateState,
  Policy,
  Preferences,
  SettingsRoute,
} from "../types";
import { IconButton } from "./IconButton";
import { SettingsActionPanel } from "./SettingsActionPanels";
import { CustomSelect } from "./ui/CustomSelect";

type Icon = typeof Settings2;

interface RouteDefinition {
  id: SettingsRoute;
  label: string;
  icon: Icon;
  description: string;
}

interface RouteGroup {
  label: string;
  routes: RouteDefinition[];
}

const routeGroups: RouteGroup[] = [
  {
    label: "个人",
    routes: [
      {
        id: "general",
        label: "常规",
        icon: Settings2,
        description: "权限、文件、面板与运行偏好",
      },
      {
        id: "models",
        label: "模型与提供商",
        icon: BrainCircuit,
        description: "模型目录、API 和任务级配置",
      },
      {
        id: "import",
        label: "导入",
        icon: Download,
        description: "导入浏览器资料和旧版数据",
      },
      {
        id: "profile",
        label: "个人资料",
        icon: CircleUserRound,
        description: "Agent 身份与协作配置",
      },
      {
        id: "appearance",
        label: "外观",
        icon: Palette,
        description: "主题、密度与动态效果",
      },
      {
        id: "voice",
        label: "语音",
        icon: Mic2,
        description: "实时语音和声音选择",
      },
      {
        id: "config",
        label: "配置",
        icon: Code2,
        description: "查看当前生效配置",
      },
      {
        id: "personalization",
        label: "个性化",
        icon: UserRound,
        description: "长期协作偏好和记忆",
      },
      {
        id: "shortcuts",
        label: "键盘快捷键",
        icon: Keyboard,
        description: "快速操作和编辑器快捷键",
      },
      {
        id: "usage",
        label: "使用情况和计费",
        icon: Gauge,
        description: "模型调用与成本统计",
      },
      {
        id: "account",
        label: "账户",
        icon: Cloud,
        description: "OnPeople 云端账户与团队",
      },
    ],
  },
  {
    label: "集成",
    routes: [
      {
        id: "snapshots",
        label: "记忆",
        icon: Sparkles,
        description: "个人记忆、项目记忆和对话控制",
      },
      {
        id: "plugins",
        label: "插件",
        icon: Plug,
        description: "插件、Skills 与 MCP 服务",
      },
      {
        id: "browser",
        label: "浏览器",
        icon: Globe2,
        description: "隔离浏览器、资料与下载",
      },
      {
        id: "computer",
        label: "电脑操控",
        icon: ShieldCheck,
        description: "沙盒、网络和审批策略",
      },
    ],
  },
  {
    label: "编码",
    routes: [
      {
        id: "hooks",
        label: "钩子",
        icon: Webhook,
        description: "全局和项目自动化钩子",
      },
      {
        id: "connections",
        label: "连接",
        icon: Boxes,
        description: "凭据、密钥与外部服务",
      },
      {
        id: "git",
        label: "Git",
        icon: GitBranch,
        description: "当前项目仓库状态",
      },
      {
        id: "environment",
        label: "环境",
        icon: SquareTerminal,
        description: "运行目录与环境配置",
      },
      {
        id: "worktrees",
        label: "工作树",
        icon: FolderGit2,
        description: "隔离工作树与任务交接",
      },
    ],
  },
  {
    label: "已归档",
    routes: [
      {
        id: "archived",
        label: "已归档的聊天",
        icon: Archive,
        description: "查看和恢复归档任务",
      },
    ],
  },
];

const allRoutes = routeGroups.flatMap((group) => group.routes);

const interactiveSettingsRoutes = new Set<SettingsRoute>([
  "models",
  "import",
  "profile",
  "usage",
  "account",
  "snapshots",
  "plugins",
  "computer",
  "hooks",
  "connections",
  "worktrees",
  "archived",
]);

export function SettingsCenter() {
  const open = useWorkbenchStore((state) => state.settingsOpen);
  const preferences = useWorkbenchStore((state) => state.preferences);
  const savePreferences = useWorkbenchStore((state) => state.savePreferences);
  const status = useWorkbenchStore((state) => state.status);
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const route = useWorkbenchStore((state) => state.settingsRoute);
  const setRoute = useWorkbenchStore((state) => state.setSettingsRoute);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [resource, setResource] = useState<unknown>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<
    "idle" | "available" | "downloaded"
  >("idle");

  const close = useCallback(
    () => useWorkbenchStore.getState().setSettingsOpen(false),
    [],
  );

  const applyUpdateState = useCallback((state: AppUpdateState) => {
    const status = state.status.toLocaleLowerCase();
    setUpdateBusy(
      status === "checking" ||
        status === "downloading" ||
        status === "installing",
    );
    if (status === "downloaded") setUpdatePhase("downloaded");
    else if (status === "available" || status === "downloading")
      setUpdatePhase("available");
    else if (status === "installing") setUpdatePhase("downloaded");
    else setUpdatePhase("idle");
    const progress =
      status === "downloading" && state.progress !== null
        ? ` ${Math.round(state.progress * 100)}%`
        : "";
    setUpdateMessage(
      state.message ??
        (state.availableVersion
          ? `版本 ${state.availableVersion}${progress}`
          : `当前版本 ${state.currentVersion}`),
    );
  }, []);

  useEffect(() => {
    let active = true;
    const subscription = desktopClient.onAppUpdateState((state) => {
      if (active) applyUpdateState(state);
    });
    void desktopClient
      .appUpdateState()
      .then((state) => {
        if (active) applyUpdateState(state);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten());
    };
  }, [applyUpdateState]);

  useEffect(() => {
    if (!open) return;
    setDraft(preferences);
    setSaveState("idle");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open, preferences]);

  const loadRoute = useCallback(async () => {
    if (!open) return;
    setResourceLoading(true);
    setResourceError(null);
    try {
      const cwd = status?.defaultCwd ?? "";
      let value: unknown = null;
      switch (route) {
        case "general":
        case "computer":
          value = await desktopClient.getPolicy();
          break;
        case "models": {
          const kind = status?.provider.kind ?? "onpeople";
          const [provider, catalog] = await Promise.all([
            desktopClient.getProviderSettings(kind),
            desktopClient.discoverModels(),
          ]);
          value = {
            provider,
            catalog,
            activeThreadId: selectedThreadId,
          };
          break;
        }
        case "import":
          value = await desktopClient.listBrowserImportProfiles();
          break;
        case "profile":
          value = await desktopClient.listAgentProfiles();
          break;
        case "voice":
          value = await desktopClient.liveStatus();
          break;
        case "config":
        case "environment":
          value = await desktopClient.getEffectiveConfig({ cwd });
          break;
        case "usage":
          value = await desktopClient.getUsageLedger();
          break;
        case "account":
          value = await desktopClient.getCloudAccount();
          break;
        case "snapshots":
          value = await desktopClient.listMemories(cwd, selectedThreadId);
          break;
        case "plugins":
          value = await desktopClient.listExtensions(cwd);
          break;
        case "browser":
          value = {
            session: await desktopClient.getBrowserSessionStatus("settings"),
            import: await desktopClient.listBrowserImportProfiles(),
          };
          break;
        case "hooks":
          value = {
            global: await desktopClient.listHooks(cwd),
            local: await desktopClient.listLocalHooks(cwd),
          };
          break;
        case "connections":
          value = await desktopClient.listSecrets();
          break;
        case "git":
          value = cwd
            ? await desktopClient.gitState(cwd)
            : { status: "未选择项目" };
          break;
        case "worktrees":
          value = cwd
            ? await desktopClient.listWorktrees(cwd)
            : { worktrees: [] };
          break;
        case "archived":
          value = await desktopClient.listThreads({
            archived: true,
            limit: 100,
          });
          break;
        case "appearance":
        case "personalization":
        case "shortcuts":
          value = null;
          break;
      }
      setResource(value);
    } catch (error) {
      setResource(null);
      setResourceError(errorMessage(error));
    } finally {
      setResourceLoading(false);
    }
  }, [
    open,
    route,
    selectedThreadId,
    status?.defaultCwd,
    status?.provider.kind,
  ]);

  useEffect(() => {
    void loadRoute();
  }, [loadRoute]);

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return routeGroups;
    return routeGroups
      .map((group) => ({
        ...group,
        routes: group.routes.filter((item) =>
          `${item.label} ${item.description}`
            .toLocaleLowerCase()
            .includes(normalized),
        ),
      }))
      .filter((group) => group.routes.length > 0);
  }, [query]);

  if (!open) return null;

  const routeDefinition =
    allRoutes.find((item) => item.id === route) ?? allRoutes[0];
  const voiceStatus = readableVoiceStatus(resource);
  const browserStatus = readableBrowserStatus(resource);

  const persist = async (next: Preferences) => {
    setDraft(next);
    setSaveState("saving");
    try {
      await savePreferences(next);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch {
      setSaveState("error");
    }
  };

  const patch = (value: Partial<Preferences>) =>
    void persist({ ...draft, ...value });

  const checkUpdate = async () => {
    setUpdateBusy(true);
    try {
      const result = await desktopClient.checkForAppUpdate();
      setUpdateMessage(
        result.available
          ? `发现版本 ${String(result.version ?? "")}`
          : "当前已是最新版本",
      );
      setUpdatePhase(result.available ? "available" : "idle");
    } catch (error) {
      setUpdateMessage(errorMessage(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const downloadUpdate = async () => {
    setUpdateBusy(true);
    try {
      const result = await desktopClient.downloadAppUpdate();
      if (!result.available) {
        setUpdateMessage("当前已是最新版本");
        setUpdatePhase("idle");
        return;
      }
      setUpdateMessage(`版本 ${String(result.version ?? "")} 已下载，可安装`);
      setUpdatePhase("downloaded");
    } catch (error) {
      setUpdateMessage(errorMessage(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    setUpdateBusy(true);
    try {
      const result = await desktopClient.installAppUpdate();
      setUpdateMessage(
        `版本 ${String(result.version ?? "")} 已安装，重新打开应用后生效`,
      );
      setUpdatePhase("idle");
    } catch (error) {
      setUpdateMessage(errorMessage(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="OnPeople 设置"
    >
      <aside className="settings-sidebar">
        <button className="settings-back" type="button" onClick={close}>
          <ArrowLeft size={15} aria-hidden="true" />
          返回应用
        </button>
        <label className="settings-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索设置…"
            aria-label="搜索设置"
          />
          {query ? (
            <button
              type="button"
              aria-label="清除设置搜索"
              onClick={() => setQuery("")}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <nav className="settings-nav" aria-label="设置导航">
          {filteredGroups.map((group) => (
            <div className="settings-nav-group" key={group.label}>
              <span>{group.label}</span>
              {group.routes.map(({ id, label, icon: RouteIcon }) => (
                <button
                  className={route === id ? "is-active" : ""}
                  type="button"
                  key={id}
                  onClick={() => setRoute(id)}
                >
                  <RouteIcon size={15} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="settings-main">
        <header className="settings-header">
          <div>
            <h1>{routeDefinition?.label}</h1>
            <p>{routeDefinition?.description}</p>
          </div>
          <div className="settings-header-actions">
            {saveState !== "idle" ? (
              <span className={`settings-save-state is-${saveState}`}>
                {saveState === "saving" ? "正在保存…" : null}
                {saveState === "saved" ? (
                  <>
                    <Check size={13} /> 已保存
                  </>
                ) : null}
                {saveState === "error" ? "保存失败" : null}
              </span>
            ) : null}
            <IconButton icon={X} label="关闭设置" onClick={close} />
          </div>
        </header>

        {route === "general" ? (
          <>
            <SettingsSection title="权限">
              <GeneralPolicyCard
                key={policyFingerprint(resource)}
                value={resource}
                threadId={selectedThreadId ?? status?.windowThreadId ?? ""}
                loading={resourceLoading}
                error={resourceError}
                onRefresh={loadRoute}
              />
            </SettingsSection>
            <SettingsSection title="常规">
              <div className="settings-card">
                <SelectRow
                  label="默认文件打开目标"
                  hint="默认打开文件和文件夹的位置"
                  value={draft.defaultFileOpener}
                  options={[
                    { value: "smart", label: "智能选择" },
                    { value: "system", label: "系统默认" },
                  ]}
                  onChange={(value) => patch({ defaultFileOpener: value })}
                />
                <ToggleRow
                  label="底部面板"
                  hint="在应用标题栏中显示底部面板控制"
                  value={draft.showComposerFooter}
                  onChange={(value) => patch({ showComposerFooter: value })}
                />
                <ToggleRow
                  label="环境建议"
                  hint="搜索项目文件和已连接能力，建议下一步操作"
                  value={draft.showSuggestions}
                  onChange={(value) => patch({ showSuggestions: value })}
                />
                <ActionRow
                  label="应用更新"
                  hint={updateMessage ?? "使用签名更新包保持 OnPeople 最新"}
                >
                  <button
                    type="button"
                    disabled={updateBusy}
                    onClick={() => {
                      if (updatePhase === "available") void downloadUpdate();
                      else if (updatePhase === "downloaded")
                        void installUpdate();
                      else void checkUpdate();
                    }}
                  >
                    {updateBusy
                      ? updatePhase === "available"
                        ? "下载中…"
                        : updatePhase === "downloaded"
                          ? "安装中…"
                          : "检查中…"
                      : updatePhase === "available"
                        ? "下载"
                        : updatePhase === "downloaded"
                          ? "安装"
                          : "检查"}
                  </button>
                </ActionRow>
              </div>
            </SettingsSection>
          </>
        ) : null}

        {route === "appearance" ? (
          <SettingsSection title="界面">
            <div className="settings-card">
              <SelectRow
                label="主题"
                hint="跟随系统或固定主题"
                value={draft.theme}
                options={[
                  { value: "system", label: "跟随系统" },
                  { value: "light", label: "浅色" },
                  { value: "dark", label: "深色" },
                ]}
                onChange={(value) => patch({ theme: value })}
              />
              <SelectRow
                label="信息密度"
                hint="调整列表和工具舱的间距"
                value={draft.density}
                options={[
                  { value: "comfortable", label: "舒适" },
                  { value: "compact", label: "紧凑" },
                ]}
                onChange={(value) => patch({ density: value })}
              />
              <ToggleRow
                label="减少动态效果"
                hint="关闭非必要的过渡动画"
                value={draft.reduceMotion}
                onChange={(value) => patch({ reduceMotion: value })}
              />
            </div>
          </SettingsSection>
        ) : null}

        {route === "personalization" ? (
          <SettingsSection title="个人指令">
            <p className="settings-copy">
              这些内容会进入新任务的 Agent 上下文。
            </p>
            <textarea
              className="settings-textarea"
              rows={10}
              value={draft.customInstructions}
              onChange={(event) =>
                setDraft({ ...draft, customInstructions: event.target.value })
              }
              onBlur={() => void persist(draft)}
              placeholder="输入长期协作偏好"
            />
          </SettingsSection>
        ) : null}

        {route === "voice" ? (
          <SettingsSection title="实时语音">
            <div className="settings-card">
              <SelectRow
                label="声音"
                hint="用于实时语音会话的默认声音"
                value={draft.liveVoice}
                options={[
                  { value: "cove", label: "Cove" },
                  { value: "alloy", label: "Alloy" },
                  { value: "verse", label: "Verse" },
                ]}
                onChange={(value) => patch({ liveVoice: value })}
              />
              <ActionRow label="实时语音状态" hint={voiceStatus.hint}>
                <span className={`settings-status-pill is-${voiceStatus.tone}`}>
                  {voiceStatus.label}
                </span>
              </ActionRow>
            </div>
          </SettingsSection>
        ) : null}

        {route === "browser" ? (
          <SettingsSection title="浏览器">
            <div className="settings-card">
              <ToggleRow
                label="启用内嵌浏览器"
                hint="为任务提供隔离浏览器路由"
                value={draft.browserEnabled}
                onChange={(value) => patch({ browserEnabled: value })}
              />
              <SelectRow
                label="链接打开方式"
                hint="网页请求新窗口时的处理方式"
                value={draft.browserOpenLinks}
                options={[
                  { value: "internal", label: "OnPeople 标签" },
                  { value: "system", label: "系统浏览器" },
                ]}
                onChange={(value) => patch({ browserOpenLinks: value })}
              />
              <ActionRow
                label="下载位置"
                hint={draft.downloadDirectory ?? "系统下载文件夹"}
              >
                <button
                  type="button"
                  onClick={() =>
                    void desktopClient.pickDirectory().then((path) => {
                      if (path)
                        return persist({ ...draft, downloadDirectory: path });
                      return undefined;
                    })
                  }
                >
                  选择
                </button>
              </ActionRow>
              <ActionRow
                label="浏览器数据"
                hint="清理隔离 Profile 中的 Cookie、存储和站点权限"
              >
                <button
                  type="button"
                  onClick={() =>
                    void desktopClient
                      .clearBrowserDataFromSettings()
                      .then(loadRoute)
                  }
                >
                  清除
                </button>
              </ActionRow>
              <ActionRow label="Browser Host" hint={browserStatus.hint}>
                <span
                  className={`settings-status-pill is-${browserStatus.tone}`}
                >
                  {browserStatus.label}
                </span>
              </ActionRow>
            </div>
          </SettingsSection>
        ) : null}

        {route === "shortcuts" ? <ShortcutSettings /> : null}

        {interactiveSettingsRoutes.has(route) ? (
          resourceLoading || resourceError ? (
            <SettingsSection title={routeDefinition?.label ?? "设置"}>
              <ResourcePanel
                value={resource}
                loading={resourceLoading}
                error={resourceError}
                onRefresh={() => void loadRoute()}
              />
            </SettingsSection>
          ) : (
            <div className="settings-route-content">
              <SettingsActionPanel
                route={route}
                resource={resource}
                cwd={status?.defaultCwd ?? ""}
                threadId={selectedThreadId ?? status?.windowThreadId ?? ""}
                onRefresh={loadRoute}
              />
            </div>
          )
        ) : null}

        {route !== "general" &&
        route !== "appearance" &&
        route !== "personalization" &&
        route !== "voice" &&
        route !== "browser" &&
        route !== "shortcuts" &&
        !interactiveSettingsRoutes.has(route) ? (
          <SettingsSection title={routeDefinition?.label ?? "设置"}>
            <ResourcePanel
              value={resource}
              loading={resourceLoading}
              error={resourceError}
              onRefresh={() => void loadRoute()}
            />
          </SettingsSection>
        ) : null}
      </main>
    </div>
  );
}

function GeneralPolicyCard({
  value,
  threadId,
  loading,
  error,
  onRefresh,
}: {
  value: unknown;
  threadId: string;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void> | void;
}) {
  const policy = policyFromResource(value);
  const [draft, setDraft] = useState<Policy>(policy);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  const apply = async (next: Policy) => {
    setDraft(next);
    setState("saving");
    setMessage(null);
    try {
      await desktopClient.savePolicy(threadId, next);
      setState("saved");
      await onRefresh();
      window.setTimeout(() => setState("idle"), 1400);
    } catch (saveError) {
      setState("error");
      setMessage(errorMessage(saveError));
    }
  };

  if (loading) {
    return (
      <div className="settings-card settings-card-loading">正在读取权限…</div>
    );
  }

  if (error) {
    return (
      <div className="settings-card settings-card-error" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => void onRefresh()}>
          重试
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="settings-card">
        <SelectRow
          label="默认权限"
          hint="控制 Agent 默认可以读取和修改的文件范围"
          value={draft.sandbox}
          options={[
            { value: "read-only", label: "只读" },
            { value: "workspace-write", label: "工作区访问" },
            { value: "danger-full-access", label: "完整访问" },
          ]}
          onChange={(sandbox) => void apply({ ...draft, sandbox })}
        />
        <SelectRow
          label="审批"
          hint="决定系统操作何时需要你的确认"
          value={draft.approvalPolicy}
          options={[
            { value: "untrusted", label: "不受信任操作" },
            { value: "on-request", label: "按需" },
            { value: "never", label: "从不" },
          ]}
          onChange={(approvalPolicy) =>
            void apply({ ...draft, approvalPolicy })
          }
        />
        <ToggleRow
          label="网络访问"
          hint="允许 Agent 和工具连接外部服务"
          value={draft.network}
          onChange={(network) => void apply({ ...draft, network })}
        />
        <ToggleRow
          label="多 Agent"
          hint={`允许并行委派，当前上限为 ${draft.maxConcurrentAgents} 个 Agent`}
          value={draft.multiAgent}
          onChange={(multiAgent) => void apply({ ...draft, multiAgent })}
        />
      </div>
      {state !== "idle" ? (
        <div className="settings-inline-save" role="status">
          <span className={`settings-inline-save-state is-${state}`}>
            {state === "saving" ? "正在保存…" : null}
            {state === "saved" ? "已保存" : null}
            {state === "error" ? message : null}
          </span>
        </div>
      ) : null}
    </>
  );
}

function policyFromResource(value: unknown): Policy {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const nested =
    typeof source.policy === "object" && source.policy !== null
      ? (source.policy as Record<string, unknown>)
      : source;
  return {
    sandbox:
      typeof nested.sandbox === "string" ? nested.sandbox : "workspace-write",
    approvalPolicy:
      typeof nested.approvalPolicy === "string"
        ? nested.approvalPolicy
        : "on-request",
    reviewer: typeof nested.reviewer === "string" ? nested.reviewer : "user",
    network: nested.network !== false,
    multiAgent: nested.multiAgent !== false,
    maxConcurrentAgents:
      typeof nested.maxConcurrentAgents === "number"
        ? nested.maxConcurrentAgents
        : 4,
  };
}

function policyFingerprint(value: unknown): string {
  return JSON.stringify(policyFromResource(value));
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-row">
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <CustomSelect
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      className="settings-row toggle-row"
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <span className={`toggle ${value ? "is-on" : ""}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function ActionRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row settings-action-row">
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <span>{children}</span>
    </div>
  );
}

function ShortcutSettings() {
  const shortcuts = [
    ["新任务", "⌘ N"],
    ["聚焦输入框", "⌘ L"],
    ["打开命令面板", "⌘ K"],
    ["打开设置", "⌘ ,"],
    ["切换底部面板", "⌘ J"],
    ["换行", "⇧ Enter"],
  ];
  return (
    <SettingsSection title="键盘快捷键">
      <div className="settings-card shortcut-list">
        {shortcuts.map(([label, key]) => (
          <div key={label}>
            <span>{label}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

function readableVoiceStatus(value: unknown): {
  label: string;
  hint: string;
  tone: "ready" | "muted" | "warning";
} {
  const state = settingsRecord(value);
  const message =
    typeof state.message === "string" && state.message.trim()
      ? state.message.trim()
      : null;
  if (state.available === true) {
    return {
      label: "可用",
      hint: message ?? "麦克风和实时语音服务均已就绪",
      tone: "ready",
    };
  }
  if (state.available === false) {
    return {
      label: "不可用",
      hint: message ?? "检查麦克风权限或实时语音服务",
      tone: "warning",
    };
  }
  return {
    label: "未检查",
    hint: message ?? "开始语音会话时自动检查服务状态",
    tone: "muted",
  };
}

function readableBrowserStatus(value: unknown): {
  label: string;
  hint: string;
  tone: "ready" | "muted" | "warning";
} {
  const root = settingsRecord(value);
  const session = settingsRecord(root.session);
  const rawStatus =
    typeof session.status === "string"
      ? session.status.toLocaleLowerCase()
      : "";
  const ready =
    session.connected === true ||
    session.ready === true ||
    ["ready", "connected", "active", "running"].includes(rawStatus);
  const failed =
    session.error ||
    ["failed", "error", "disconnected", "stopped"].includes(rawStatus);
  if (ready) {
    return {
      label: "已就绪",
      hint: "Browser Host 已连接，任务可以使用隔离浏览器",
      tone: "ready",
    };
  }
  if (failed) {
    return {
      label: "需要检查",
      hint:
        typeof session.error === "string"
          ? session.error
          : "Browser Host 当前未连接",
      tone: "warning",
    };
  }
  return {
    label: "按需启动",
    hint: "打开浏览器面板时自动连接 Browser Host",
    tone: "muted",
  };
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function ResourcePanel({
  value,
  loading,
  error,
  onRefresh,
}: {
  value: unknown;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="settings-resource-panel">
      <div className="settings-resource-toolbar">
        <span>{loading ? "正在读取…" : "当前状态"}</span>
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>
      {error ? <p className="settings-resource-error">{error}</p> : null}
      {!error && !loading ? <ResourceSummary value={value} /> : null}
    </div>
  );
}

function ResourceSummary({
  value,
  compact = false,
}: {
  value: unknown;
  compact?: boolean;
}) {
  if (value === null || value === undefined) {
    return compact ? null : <p className="settings-empty">暂无数据</p>;
  }
  const entries = resourceEntries(value);
  if (entries.length === 0) return <p className="settings-empty">暂无数据</p>;
  return (
    <div className={`settings-resource-list ${compact ? "is-compact" : ""}`}>
      {entries.slice(0, 80).map((entry) => (
        <div className="settings-resource-item" key={entry.key}>
          <span>
            <strong>{entry.title}</strong>
            <small>{entry.detail}</small>
          </span>
          {entry.badge ? <em>{entry.badge}</em> : null}
        </div>
      ))}
    </div>
  );
}

function resourceEntries(
  value: unknown,
): Array<{ key: string; title: string; detail: string; badge?: string }> {
  const result: Array<{
    key: string;
    title: string;
    detail: string;
    badge?: string;
  }> = [];
  const visit = (current: unknown, prefix: string) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          const title = String(
            record.name ??
              record.title ??
              record.path ??
              record.id ??
              `${prefix} ${index + 1}`,
          );
          const detailSource =
            record.description ??
            record.status ??
            record.branch ??
            record.scope ??
            "已配置";
          const detail = readableSettingValue(
            detailSource,
            record.status !== undefined ? "status" : "",
          );
          const badge =
            typeof record.enabled === "boolean"
              ? record.enabled
                ? "已启用"
                : "已停用"
              : undefined;
          result.push({
            key: `${prefix}-${index}-${title}`,
            title,
            detail,
            ...(badge ? { badge } : {}),
          });
        } else {
          result.push({
            key: `${prefix}-${index}`,
            title: `${prefix} ${index + 1}`,
            detail: String(item),
          });
        }
      });
      return;
    }
    if (typeof current === "object" && current !== null) {
      Object.entries(current as Record<string, unknown>).forEach(
        ([key, child]) => {
          if (Array.isArray(child)) visit(child, labelForKey(key));
          else if (typeof child === "object" && child !== null)
            visit(child, labelForKey(key));
          else if (child !== null && child !== undefined) {
            result.push({
              key: `${prefix}-${key}`,
              title: labelForKey(key),
              detail: readableSettingValue(child, key),
            });
          }
        },
      );
      return;
    }
    result.push({
      key: prefix,
      title: prefix,
      detail: readableSettingValue(current),
    });
  };
  visit(value, "状态");
  return result;
}

function labelForKey(key: string): string {
  const labels: Record<string, string> = {
    approvalPolicy: "审批策略",
    sandbox: "文件访问",
    maxConcurrentAgents: "并行 Agent 上限",
    reviewer: "审批人",
    network: "网络访问",
    multiAgent: "多 Agent",
    signedIn: "登录状态",
    available: "可用状态",
    enabled: "启用状态",
    status: "运行状态",
    message: "状态说明",
    voice: "默认声音",
    model: "默认模型",
    provider: "模型提供商",
    serviceUrl: "服务地址",
    baseUrl: "API 地址",
    source: "配置来源",
    cwd: "运行目录",
    root: "项目目录",
    path: "路径",
    branch: "分支",
    head: "当前提交",
    shell: "终端",
    profiles: "可导入资料",
    plugins: "插件",
    skills: "Skills",
    mcpServers: "MCP 服务",
    threads: "归档聊天",
    worktrees: "工作树",
    entries: "快照",
    secrets: "连接",
    theme: "主题",
    density: "信息密度",
    reduceMotion: "减少动态效果",
  };
  return labels[key] ?? key.replace(/([A-Z])/g, " $1").trim();
}

function readableSettingValue(value: unknown, key = ""): string {
  if (typeof value === "boolean") return value ? "已启用" : "已停用";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    const values: Record<string, string> = {
      available: "可用",
      ready: "已就绪",
      connected: "已连接",
      disconnected: "未连接",
      unavailable: "不可用",
      enabled: "已启用",
      disabled: "已停用",
      active: "运行中",
      inactive: "未运行",
      healthy: "正常",
      user: "用户",
      project: "项目",
      session: "会话",
      "on-request": "按需审批",
      "workspace-write": "工作区可写",
      "read-only": "只读",
      "danger-full-access": "完整访问",
      system: "跟随系统",
      comfortable: "舒适",
      compact: "紧凑",
    };
    if (values[normalized]) return values[normalized];
    if (key === "signedIn") return normalized === "true" ? "已登录" : "未登录";
    return value || "未设置";
  }
  return String(value);
}
