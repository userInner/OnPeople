import {
  AppWindow,
  BookOpen,
  Check,
  ChevronDown,
  FileImage,
  FileSpreadsheet,
  FileText,
  Globe2,
  Monitor,
  Plus,
  Presentation,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import { errorMessage } from "../lib/errors";
import type { ProviderKind, SettingsRoute } from "../types";
import { CustomSelect } from "./ui/CustomSelect";

type ResourceRecord = Record<string, unknown>;

interface SettingsActionPanelProps {
  route: SettingsRoute;
  resource: unknown;
  cwd: string;
  threadId: string;
  onRefresh: () => Promise<void> | void;
}

export function SettingsActionPanel(props: SettingsActionPanelProps) {
  switch (props.route) {
    case "models":
      return <ModelProviderSettings {...props} />;
    case "computer":
      return <PolicySettings {...props} />;
    case "profile":
      return <AgentProfileSettings {...props} />;
    case "usage":
      return <UsageSettings {...props} />;
    case "account":
      return <CloudAccountSettings {...props} />;
    case "snapshots":
      return <MemorySettings {...props} />;
    case "plugins":
      return <PluginSettings {...props} />;
    case "hooks":
      return <HookSettings {...props} />;
    case "connections":
      return <SecretSettings {...props} />;
    case "worktrees":
      return <WorktreeSettings {...props} />;
    case "archived":
      return <ArchivedSettings {...props} />;
    default:
      return null;
  }
}

const providerOptions: Array<[ProviderKind, string]> = [
  ["onpeople", "OnPeople"],
  ["openai", "OpenAI"],
  ["deepseek", "DeepSeek"],
  ["minimax", "MiniMax"],
  ["kimi", "Kimi"],
  ["grok", "Grok"],
  ["compatible", "OpenAI 兼容接口"],
  ["ollama", "Ollama"],
  ["lmstudio", "LM Studio"],
];

interface ProviderDraft {
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  apiKeySet: boolean;
  scope: "global" | "thread";
  extra: Record<string, unknown>;
}

function ModelProviderSettings({
  resource,
  threadId,
  onRefresh,
}: SettingsActionPanelProps) {
  const source = record(resource);
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    providerDraft(source.provider),
  );
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const { busy, message, run } = useSettingsMutation(onRefresh);
  const models = recordsAt(source.catalog, "models").filter(
    (model) => text(model.provider) === draft.kind,
  );

  const changeProvider = async (value: string) => {
    const kind = value as ProviderKind;
    setProviderLoading(true);
    setProviderError(null);
    setValidation(null);
    try {
      const provider = await desktopClient.getProviderSettings(kind);
      const next = providerDraft(provider);
      setDraft({ ...next, scope: draft.scope });
    } catch (error) {
      setProviderError(errorMessage(error));
      setDraft((current) => ({ ...current, kind }));
    } finally {
      setProviderLoading(false);
    }
  };

  const validate = async () => {
    if (!draft.model.trim()) {
      setValidation("请先输入模型 ID");
      return;
    }
    setProviderLoading(true);
    setValidation(null);
    try {
      const result = await desktopClient.validateModel(
        draft.kind,
        draft.model.trim(),
      );
      setValidation(
        result.valid === true
          ? "模型已在当前目录中识别"
          : "目录中未发现该模型；兼容接口仍可保存自定义模型 ID",
      );
    } catch (error) {
      setValidation(errorMessage(error));
    } finally {
      setProviderLoading(false);
    }
  };

  return (
    <section className="settings-section">
      <h2>模型与提供商</h2>
      <p className="settings-copy">
        配置默认模型和 API；Composer 中的模型选择会覆盖当前任务设置。
      </p>
      <div className="settings-card settings-provider-card">
        <SelectSetting
          label="提供商"
          hint="选择云端、本地或兼容模型服务"
          value={draft.kind}
          options={providerOptions}
          onChange={(value) => void changeProvider(value)}
        />
        <label className="settings-row settings-provider-input-row">
          <span>
            <strong>模型 ID</strong>
            <small>用于新任务的默认模型</small>
          </span>
          <span className="settings-provider-control">
            <input
              list="onpeople-provider-models"
              value={draft.model}
              onChange={(event) =>
                setDraft({ ...draft, model: event.target.value })
              }
              placeholder="例如 gpt-5.6"
            />
          </span>
          <datalist id="onpeople-provider-models">
            {models.map((model) => {
              const id = text(model.id);
              return id ? <option value={id} key={id} /> : null;
            })}
          </datalist>
        </label>
        <label className="settings-row settings-provider-input-row">
          <span>
            <strong>API 地址</strong>
            <small>服务端点的 Base URL</small>
          </span>
          <span className="settings-provider-control">
            <input
              value={draft.baseUrl}
              inputMode="url"
              onChange={(event) =>
                setDraft({ ...draft, baseUrl: event.target.value })
              }
              placeholder="https://api.example.com/v1"
            />
          </span>
        </label>
        {draft.kind === "onpeople" ? (
          <div className="settings-provider-note">
            <Sparkles size={15} aria-hidden="true" />
            <span>
              <strong>由 OnPeople 管理凭据</strong>
              <small>
                登录后自动同步模型目录并使用账户生成的模型 Key，无需填写 OpenAI
                Key。
              </small>
            </span>
          </div>
        ) : (
          <PasswordField
            label={
              draft.apiKeySet ? "API Key（已保存，留空则保留）" : "API Key"
            }
            value={draft.apiKey}
            onChange={(apiKey) => setDraft({ ...draft, apiKey })}
          />
        )}
        {threadId ? (
          <SelectSetting
            label="保存范围"
            hint="全局默认，或仅覆盖当前任务"
            value={draft.scope}
            options={[
              ["global", "所有新任务"],
              ["thread", "仅当前任务"],
            ]}
            onChange={(scope) =>
              setDraft({ ...draft, scope: scope as ProviderDraft["scope"] })
            }
          />
        ) : null}
        <ActionSetting
          label="模型目录"
          hint={
            models.length > 0
              ? `${models.length} 个 ${providerOptions.find(([id]) => id === draft.kind)?.[1] ?? draft.kind} 模型`
              : "可使用自定义模型 ID，或刷新本地服务目录"
          }
        >
          <button
            type="button"
            disabled={providerLoading || !draft.model.trim()}
            onClick={() => void validate()}
          >
            验证
          </button>
        </ActionSetting>
        <div className="settings-provider-footer">
          <span>更改将在保存后应用于所选范围</span>
          <div className="settings-form-actions">
            <button
              type="button"
              disabled={providerLoading}
              onClick={() => void onRefresh()}
            >
              刷新目录
            </button>
            <button
              className="settings-primary-button"
              type="button"
              disabled={busy !== null || providerLoading || !draft.model.trim()}
              onClick={() =>
                void run(
                  "provider",
                  () =>
                    desktopClient.saveProvider({
                      kind: draft.kind,
                      model: draft.model.trim(),
                      baseUrl: draft.baseUrl.trim(),
                      apiKey: draft.apiKey.trim() || null,
                      threadId:
                        draft.scope === "thread" && threadId ? threadId : null,
                      extra: draft.extra,
                    }),
                  draft.scope === "thread"
                    ? "当前任务的模型设置已保存"
                    : "默认模型设置已保存",
                )
              }
            >
              {busy === "provider" ? "保存中…" : "保存模型设置"}
            </button>
          </div>
        </div>
      </div>
      {validation ? <p className="settings-copy">{validation}</p> : null}
      {providerError ? (
        <p className="settings-mutation-message is-error">{providerError}</p>
      ) : null}
      <MutationMessage message={message} />
    </section>
  );
}

function useSettingsMutation(onRefresh: () => Promise<void> | void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const run = async (
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(id);
    setMessage(null);
    try {
      await action();
      await onRefresh();
      setMessage({ kind: "success", text: success });
      return true;
    } catch (error) {
      setMessage({
        kind: "error",
        text: errorMessage(error),
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  return { busy, message, run };
}

function MutationMessage({
  message,
}: {
  message: { kind: "success" | "error"; text: string } | null;
}) {
  if (!message) return null;
  return (
    <p className={`settings-mutation-message is-${message.kind}`} role="status">
      {message.text}
    </p>
  );
}

function PolicySettings({
  resource,
  threadId,
  onRefresh,
}: SettingsActionPanelProps) {
  const policy = record(resource).policy;
  const [draft, setDraft] = useState(() => policyDraft(policy));
  const { busy, message, run } = useSettingsMutation(onRefresh);

  return (
    <>
      <section className="settings-section">
        <h2>执行权限</h2>
        <div className="settings-card">
          <SelectSetting
            label="沙盒"
            hint="控制 Agent 可写入的文件范围"
            value={draft.sandbox}
            options={[
              ["read-only", "只读"],
              ["workspace-write", "工作区可写"],
              ["danger-full-access", "完整访问"],
            ]}
            onChange={(sandbox) => setDraft({ ...draft, sandbox })}
          />
          <SelectSetting
            label="审批策略"
            hint="决定哪些系统操作需要人工确认"
            value={draft.approvalPolicy}
            options={[
              ["untrusted", "不受信任操作审批"],
              ["on-request", "按需审批"],
              ["never", "从不审批"],
            ]}
            onChange={(approvalPolicy) =>
              setDraft({ ...draft, approvalPolicy })
            }
          />
          <ToggleSetting
            label="允许网络访问"
            hint="允许 Agent 和工具连接外部服务"
            value={draft.network}
            onChange={(network) => setDraft({ ...draft, network })}
          />
          <ToggleSetting
            label="允许多 Agent"
            hint="控制 Codex 原生 spawn_agent 协作工具"
            value={draft.multiAgent}
            onChange={(multiAgent) => setDraft({ ...draft, multiAgent })}
          />
          <SelectSetting
            label="并行 Agent 上限"
            hint="限制每个主任务同时打开的子 Agent 线程"
            value={String(draft.maxConcurrentAgents)}
            options={[
              ["2", "2 个"],
              ["4", "4 个"],
              ["6", "6 个"],
              ["8", "8 个"],
            ]}
            onChange={(value) =>
              setDraft({ ...draft, maxConcurrentAgents: Number(value) })
            }
          />
        </div>
        <div className="settings-form-actions">
          <button
            className="settings-primary-button"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "policy",
                () => desktopClient.savePolicy(threadId, draft),
                "权限策略已保存",
              )
            }
          >
            {busy === "policy" ? "保存中…" : "保存权限策略"}
          </button>
        </div>
        <MutationMessage message={message} />
      </section>
    </>
  );
}

interface AgentProfileDraft {
  id: string;
  name: string;
  description: string;
  role: string;
  model: string;
  effort: string;
  sandbox: string;
  instructions: string;
  builtIn: boolean;
}

const emptyAgentProfile: AgentProfileDraft = {
  id: "",
  name: "",
  description: "",
  role: "general",
  model: "",
  effort: "medium",
  sandbox: "workspace-write",
  instructions: "",
  builtIn: false,
};

function AgentProfileSettings({
  resource,
  onRefresh,
}: SettingsActionPanelProps) {
  const profiles = recordsAt(resource, "profiles");
  const [draft, setDraft] = useState<AgentProfileDraft>(emptyAgentProfile);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { busy, message, run } = useSettingsMutation(onRefresh);

  const edit = (profile: ResourceRecord) => {
    setDraft({
      id: text(profile.id),
      name: text(profile.name),
      description: text(profile.description, text(profile.name)),
      role: text(profile.role, "general"),
      model: text(profile.model),
      effort: text(profile.effort, "medium"),
      sandbox: text(profile.sandbox, "workspace-write"),
      instructions: text(profile.instructions),
      builtIn: Boolean(profile.builtIn),
    });
    setEditorOpen(true);
  };

  const create = () => {
    setDraft(emptyAgentProfile);
    setEditorOpen(true);
  };

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h2>Agent 配置</h2>
        <button type="button" onClick={create}>
          新建配置
        </button>
      </div>
      <div className="settings-card settings-selectable-list">
        {profiles.map((profile, index) => {
          const id = text(profile.id, `profile-${index}`);
          return (
            <div className="settings-resource-item" key={id}>
              <button
                className="settings-item-main"
                type="button"
                onClick={() => edit(profile)}
              >
                <strong>{text(profile.name, "未命名 Agent")}</strong>
                <small>
                  {text(profile.role, "general")} ·{" "}
                  {text(profile.effort, "medium")}
                </small>
              </button>
              {profile.builtIn ? (
                <em>内置</em>
              ) : deleteId === id ? (
                <span className="settings-confirm-actions">
                  <button type="button" onClick={() => setDeleteId(null)}>
                    取消
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `delete-profile-${id}`,
                        () => desktopClient.deleteAgentProfile(id),
                        "Agent 配置已删除",
                      ).then((ok) => ok && setDeleteId(null))
                    }
                  >
                    确认删除
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setDeleteId(id)}>
                  删除
                </button>
              )}
            </div>
          );
        })}
      </div>
      {editorOpen ? (
        <div className="settings-editor-card settings-profile-editor">
          <header className="settings-editor-heading">
            <div>
              <h3>{draft.id ? "编辑 Agent" : "新建 Agent"}</h3>
              <p>定义身份、模型、权限和协作边界。</p>
            </div>
            <button
              type="button"
              aria-label="关闭 Agent 编辑器"
              onClick={() => setEditorOpen(false)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="settings-form-grid">
            <TextField
              label="名称"
              value={draft.name}
              onChange={(name) => setDraft({ ...draft, name })}
            />
            <TextField
              label="角色 ID"
              value={draft.role}
              onChange={(role) => setDraft({ ...draft, role })}
            />
            <TextField
              label="使用说明"
              value={draft.description}
              onChange={(description) => setDraft({ ...draft, description })}
            />
            <TextField
              label="模型（可选）"
              value={draft.model}
              onChange={(model) => setDraft({ ...draft, model })}
            />
            <SelectField
              label="推理强度"
              value={draft.effort}
              options={[
                ["low", "低"],
                ["medium", "中"],
                ["high", "高"],
                ["xhigh", "极高"],
              ]}
              onChange={(effort) => setDraft({ ...draft, effort })}
            />
            <SelectField
              label="文件访问"
              value={draft.sandbox}
              options={[
                ["read-only", "只读"],
                ["workspace-write", "工作区可写"],
                ["danger-full-access", "完整访问"],
              ]}
              onChange={(sandbox) => setDraft({ ...draft, sandbox })}
            />
          </div>
          <label className="settings-field">
            <span>协作指令</span>
            <textarea
              rows={5}
              value={draft.instructions}
              onChange={(event) =>
                setDraft({ ...draft, instructions: event.target.value })
              }
              placeholder="描述这个 Agent 的职责和约束"
            />
          </label>
          <div className="settings-form-actions">
            <button type="button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button
              className="settings-primary-button"
              type="button"
              disabled={!draft.name.trim() || busy !== null}
              onClick={() =>
                void run(
                  "save-profile",
                  () =>
                    desktopClient.saveAgentProfile({
                      ...(draft.id ? { id: draft.id } : {}),
                      name: draft.name.trim(),
                      description:
                        draft.description.trim() || draft.name.trim(),
                      role: draft.role.trim() || "general",
                      model: draft.model.trim(),
                      effort: draft.effort,
                      sandbox: draft.sandbox,
                      instructions: draft.instructions,
                      builtIn: draft.builtIn,
                    }),
                  "Agent 配置已保存",
                ).then((ok) => ok && setEditorOpen(false))
              }
            >
              {busy === "save-profile" ? "保存中…" : "保存配置"}
            </button>
          </div>
        </div>
      ) : null}
      <MutationMessage message={message} />
    </section>
  );
}

function UsageSettings({ resource, onRefresh }: SettingsActionPanelProps) {
  const state = record(resource);
  const prices = record(state.prices);
  const [key, setKey] = useState("");
  const [price, setPrice] = useState("");
  const { busy, message, run } = useSettingsMutation(onRefresh);

  return (
    <section className="settings-section">
      <h2>用量汇总</h2>
      <div className="settings-card">
        {Object.keys(record(state.totals)).length === 0 ? (
          <EmptyRow text="还没有模型调用记录" />
        ) : (
          Object.entries(record(state.totals)).map(([name, value]) => (
            <ActionSetting key={name} label={name} hint="累计用量">
              <strong>{String(value)}</strong>
            </ActionSetting>
          ))
        )}
      </div>
      <div className="settings-editor-card">
        <h3>自定义计价</h3>
        <div className="settings-form-grid">
          <TextField label="计价键" value={key} onChange={setKey} />
          <TextField
            label="单价"
            value={price}
            inputMode="decimal"
            onChange={setPrice}
          />
        </div>
        {Object.keys(prices).length > 0 ? (
          <p className="settings-form-hint">
            当前：
            {Object.entries(prices)
              .map(([name, value]) => `${name} = ${String(value)}`)
              .join(" · ")}
          </p>
        ) : null}
        <div className="settings-form-actions">
          <button
            className="settings-primary-button"
            type="button"
            disabled={
              !key.trim() ||
              price.trim() === "" ||
              !Number.isFinite(Number(price)) ||
              Number(price) < 0 ||
              busy !== null
            }
            onClick={() =>
              void run(
                "usage-price",
                () => desktopClient.saveUsagePrice(key.trim(), Number(price)),
                "计价已保存",
              )
            }
          >
            保存计价
          </button>
        </div>
      </div>
      <MutationMessage message={message} />
    </section>
  );
}

function CloudAccountSettings({
  resource,
  onRefresh,
}: SettingsActionPanelProps) {
  const accountState = record(resource);
  const account = record(accountState.account);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const { busy, message, run } = useSettingsMutation(onRefresh);
  const signedIn = Boolean(accountState.signedIn);

  return (
    <section className="settings-section">
      <h2>OnPeople 云端</h2>
      {signedIn ? (
        <>
          <p className="settings-copy">
            已登录。模型列表和 sub2api 模型 Key 会自动同步到 OnPeople 运行时。
          </p>
          <div className="settings-card">
            <ActionSetting
              label={text(account.name, text(account.email, "已登录"))}
              hint={text(
                account.email,
                text(accountState.serviceUrl, "云端账号"),
              )}
            >
              <span className="settings-inline-actions">
                <button
                  type="button"
                  onClick={() => void desktopClient.openCloudConsole()}
                >
                  控制台
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      "cloud-logout",
                      () => desktopClient.logoutCloudAccount(),
                      "已退出云端账号",
                    )
                  }
                >
                  退出登录
                </button>
              </span>
            </ActionSetting>
          </div>
          <div className="settings-editor-card">
            <h3>兑换码</h3>
            <div className="settings-inline-form">
              <input
                value={redeemCode}
                onChange={(event) => setRedeemCode(event.target.value)}
                placeholder="输入兑换码"
                aria-label="兑换码"
              />
              <button
                className="settings-primary-button"
                type="button"
                disabled={!redeemCode.trim() || busy !== null}
                onClick={() =>
                  void run(
                    "cloud-redeem",
                    () => desktopClient.redeemCloudCode(redeemCode.trim()),
                    "兑换码已提交",
                  )
                }
              >
                兑换
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="settings-editor-card">
          <h3>登录</h3>
          <div className="settings-form-grid">
            <TextField
              label="邮箱"
              value={email}
              inputMode="email"
              onChange={setEmail}
            />
            <PasswordField
              label="密码"
              value={password}
              onChange={setPassword}
            />
          </div>
          <div className="settings-form-actions">
            <button
              className="settings-primary-button"
              type="button"
              disabled={!email.trim() || !password || busy !== null}
              onClick={() =>
                void run(
                  "cloud-login",
                  () =>
                    desktopClient.loginCloudAccount({
                      email: email.trim(),
                      password,
                    }),
                  "登录成功",
                )
              }
            >
              {busy === "cloud-login" ? "登录中…" : "登录"}
            </button>
            <button
              type="button"
              onClick={() => void desktopClient.openCloudConsole()}
            >
              打开注册页面
            </button>
          </div>
        </div>
      )}
      <MutationMessage message={message} />
    </section>
  );
}

interface DocumentDraft {
  id: string;
  title: string;
  content: string;
  scope: "global" | "project";
}

const emptyDocument: DocumentDraft = {
  id: "",
  title: "",
  content: "",
  scope: "project",
};

function memoryTypeLabel(value: string) {
  switch (value) {
    case "preference":
      return "偏好";
    case "constraint":
      return "约束";
    case "decision":
      return "决定";
    default:
      return "事实";
  }
}

function MemorySettings({
  resource,
  cwd,
  threadId,
  onRefresh,
}: SettingsActionPanelProps) {
  const entries = recordsAt(resource, "entries");
  const candidates = recordsAt(resource, "candidates");
  const settings = record(record(resource).settings);
  const chatSettings = record(record(resource).chatSettings);
  const effectiveSettings = record(record(resource).effectiveSettings);
  const lastRecall = record(record(resource).lastRecall);
  const lifecycle = record(record(resource).lifecycle);
  const scopeCwd = text(record(resource).scopeCwd, cwd);
  const [draft, setDraft] = useState<DocumentDraft>(emptyDocument);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { busy, message, run } = useSettingsMutation(onRefresh);

  const create = () => {
    setDraft(emptyDocument);
    setEditorOpen(true);
  };

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <div>
          <h2>记忆控制</h2>
          <p className="settings-copy">
            项目规则仍由 AGENTS.md 管理；记忆只用于召回以前工作中的有用背景。
          </p>
        </div>
      </div>
      <div className="settings-card">
        <MemoryToggleRow
          title="使用已有记忆"
          description="在后续任务中召回已启用的个人与当前项目记忆"
          enabled={settings.useMemories === true}
          busy={busy !== null}
          onChange={(useMemories) =>
            void run(
              "memory-use",
              () =>
                desktopClient.saveMemorySettings({
                  scope: "global",
                  useMemories,
                }),
              useMemories ? "已启用记忆召回" : "已停用记忆召回",
            )
          }
        />
        <MemoryToggleRow
          title="生成未来记忆"
          description="从完成的有效任务中生成候选项，审核后才会用于后续任务"
          enabled={settings.generateMemories === true}
          busy={busy !== null}
          onChange={(generateMemories) =>
            void run(
              "memory-generate",
              () =>
                desktopClient.saveMemorySettings({
                  scope: "global",
                  generateMemories,
                }),
              generateMemories ? "已启用候选记忆" : "已停用候选记忆",
            )
          }
        />
        <MemoryToggleRow
          title="外部上下文保护"
          description="使用网页搜索、MCP 或工具搜索的任务不生成候选记忆"
          enabled={settings.disableOnExternalContext !== false}
          busy={busy !== null}
          onChange={(disableOnExternalContext) =>
            void run(
              "memory-external",
              () =>
                desktopClient.saveMemorySettings({
                  scope: "global",
                  disableOnExternalContext,
                }),
              "记忆隐私策略已更新",
            )
          }
        />
      </div>
      {threadId ? (
        <>
          <div className="settings-section-heading settings-memory-subheading">
            <h2>当前对话</h2>
          </div>
          <div className="settings-card">
            <MemoryToggleRow
              title="允许此对话使用记忆"
              description="仅覆盖当前对话，不改变全局设置"
              enabled={effectiveSettings.useMemories === true}
              busy={busy !== null}
              onChange={(useMemories) =>
                void run(
                  "memory-chat-use",
                  () =>
                    desktopClient.saveMemorySettings({
                      scope: "thread",
                      threadId,
                      useMemories,
                    }),
                  "当前对话记忆设置已更新",
                )
              }
            />
            <MemoryToggleRow
              title="允许此对话贡献记忆"
              description="完成后可生成候选记忆；仍需手动确认"
              enabled={effectiveSettings.generateMemories === true}
              busy={busy !== null}
              onChange={(generateMemories) =>
                void run(
                  "memory-chat-generate",
                  () =>
                    desktopClient.saveMemorySettings({
                      scope: "thread",
                      threadId,
                      generateMemories,
                    }),
                  "当前对话记忆设置已更新",
                )
              }
            />
          </div>
          {Object.keys(chatSettings).length > 0 ? (
            <p className="settings-memory-note">
              当前对话使用独立设置；全局设置不会覆盖这里的选择。
            </p>
          ) : null}
          {typeof lastRecall.count === "number" ? (
            <p className="settings-memory-note">
              最近一次任务召回 {lastRecall.count} 条长期记忆
              {lastRecall.usedPersonalInstructions === true
                ? "，并加载了个人指令"
                : ""}
              。
            </p>
          ) : null}
        </>
      ) : null}
      {candidates.length > 0 ? (
        <>
          <div className="settings-section-heading settings-memory-subheading">
            <div>
              <h2>建议记忆</h2>
              <p className="settings-copy">确认后才会加入项目长期记忆。</p>
            </div>
          </div>
          <div className="settings-card settings-selectable-list">
            {candidates.map((candidate, index) => {
              const id = text(candidate.id, `candidate-${index}`);
              const quality = Math.round(
                Math.max(0, Math.min(1, Number(candidate.qualityScore) || 0)) *
                  100,
              );
              const occurrences = Math.max(
                1,
                Number(candidate.occurrenceCount) || 1,
              );
              const isConflict = text(candidate.status) === "conflict";
              return (
                <div className="settings-resource-item" key={id}>
                  <span>
                    <strong>
                      {text(candidate.title, "对话建议记忆")}
                      <span className="settings-memory-badges">
                        <i>{quality}%</i>
                        <i>{memoryTypeLabel(text(candidate.memoryType))}</i>
                        {occurrences > 1 ? <i>出现 {occurrences} 次</i> : null}
                        {isConflict ? (
                          <i className="is-warning">存在冲突</i>
                        ) : null}
                      </span>
                    </strong>
                    <small>{text(candidate.content, "无内容")}</small>
                  </span>
                  <span className="settings-inline-actions">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `accept-memory-${id}`,
                          () =>
                            desktopClient.saveMemory({
                              ...candidate,
                              enabled: true,
                              kind: "durable",
                              status: "active",
                              source: "user-confirmed",
                              reviewedAt: new Date().toISOString(),
                              cwd: scopeCwd,
                            }),
                          "候选记忆已确认",
                        )
                      }
                    >
                      保留
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `dismiss-memory-${id}`,
                          () =>
                            desktopClient.saveMemory({
                              ...candidate,
                              enabled: false,
                              kind: "candidate",
                              status: "dismissed",
                              dismissedAt: new Date().toISOString(),
                              cwd: scopeCwd,
                            }),
                          "候选记忆已忽略",
                        )
                      }
                    >
                      忽略
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
      {Number(lifecycle.dismissedCount) > 0 ||
      Number(lifecycle.expiredCount) > 0 ||
      Number(lifecycle.supersededCount) > 0 ? (
        <p className="settings-memory-note">
          生命周期记录：已忽略 {Number(lifecycle.dismissedCount) || 0}{" "}
          条，已过期 {Number(lifecycle.expiredCount) || 0} 条，已被新记忆替代{" "}
          {Number(lifecycle.supersededCount) || 0} 条。
        </p>
      ) : null}
      <div className="settings-section-heading">
        <div>
          <h2>长期记忆</h2>
          <p className="settings-copy">
            个人记忆跨项目可用；项目记忆仅用于当前项目。
          </p>
        </div>
        <button type="button" onClick={create}>
          新建记忆
        </button>
      </div>
      <div className="settings-card settings-selectable-list">
        {entries.length === 0 ? <EmptyRow text="暂无记忆" /> : null}
        {entries.map((entry, index) => {
          const id = text(entry.id, `memory-${index}`);
          return (
            <div className="settings-resource-item" key={id}>
              <button
                className="settings-item-main"
                type="button"
                onClick={() => {
                  setDraft({
                    id,
                    title: text(entry.title, text(entry.name)),
                    content: text(entry.content, text(entry.text)),
                    scope:
                      text(entry.scope) === "global" ? "global" : "project",
                  });
                  setEditorOpen(true);
                }}
              >
                <strong>
                  {text(entry.title, text(entry.name, "未命名记忆"))}
                  <span className="settings-memory-badges">
                    <i>
                      {Math.round(
                        Math.max(
                          0,
                          Math.min(1, Number(entry.qualityScore) || 1),
                        ) * 100,
                      )}
                      %
                    </i>
                    {Number(entry.occurrenceCount) > 1 ? (
                      <i>验证 {Number(entry.occurrenceCount)} 次</i>
                    ) : null}
                  </span>
                </strong>
                <small>{text(entry.content, text(entry.text, "无内容"))}</small>
              </button>
              <em>{text(entry.scope) === "global" ? "个人" : "项目"}</em>
              {deleteId === id ? (
                <span className="settings-confirm-actions">
                  <button type="button" onClick={() => setDeleteId(null)}>
                    取消
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `delete-memory-${id}`,
                        () => desktopClient.deleteMemory(id),
                        "记忆已删除",
                      ).then((ok) => ok && setDeleteId(null))
                    }
                  >
                    确认删除
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setDeleteId(id)}>
                  删除
                </button>
              )}
            </div>
          );
        })}
      </div>
      {editorOpen ? (
        <div className="settings-editor-card">
          <SettingsEditorHeading
            title={draft.id ? "编辑记忆" : "新建记忆"}
            hint="保存需要跨任务保留的项目事实与协作偏好。"
            onClose={() => setEditorOpen(false)}
          />
          <TextField
            label="标题"
            value={draft.title}
            onChange={(title) => setDraft({ ...draft, title })}
          />
          <label className="settings-field">
            <span>作用范围</span>
            <CustomSelect
              ariaLabel="记忆作用范围"
              value={draft.scope}
              options={[
                { value: "project", label: "当前项目" },
                { value: "global", label: "所有项目" },
              ]}
              onChange={(scope) =>
                setDraft({
                  ...draft,
                  scope: scope === "global" ? "global" : "project",
                })
              }
            />
          </label>
          <label className="settings-field">
            <span>内容</span>
            <textarea
              rows={6}
              value={draft.content}
              onChange={(event) =>
                setDraft({ ...draft, content: event.target.value })
              }
              placeholder="记录需要跨任务保留的项目事实或协作偏好"
            />
          </label>
          <div className="settings-form-actions">
            <button type="button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button
              className="settings-primary-button"
              type="button"
              disabled={
                !draft.title.trim() || !draft.content.trim() || busy !== null
              }
              onClick={() =>
                void run(
                  "save-memory",
                  () =>
                    desktopClient.saveMemory({
                      ...(draft.id ? { id: draft.id } : {}),
                      title: draft.title.trim(),
                      content: draft.content.trim(),
                      cwd: scopeCwd,
                      enabled: true,
                      scope: draft.scope,
                    }),
                  "记忆已保存",
                ).then((ok) => ok && setEditorOpen(false))
              }
            >
              保存记忆
            </button>
          </div>
        </div>
      ) : null}
      <MutationMessage message={message} />
    </section>
  );
}

function MemoryToggleRow({
  title,
  description,
  enabled,
  busy,
  onChange,
}: {
  title: string;
  description: string;
  enabled: boolean;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="settings-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <button
        className={`toggle${enabled ? " is-on" : ""}`}
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={title}
        disabled={busy}
        onClick={() => onChange(!enabled)}
      >
        <span />
      </button>
    </div>
  );
}

type ExtensionDirectoryTab = "plugins" | "skills";
type PluginSourceTab = "public" | "personal";

function PluginSettings({
  resource,
  cwd,
  onRefresh,
}: SettingsActionPanelProps) {
  const state = record(resource);
  const skills = recordsAt(state, "skills");
  const catalog = recordsAt(state, "catalog");
  const catalogStatus = record(state.catalogStatus);
  const mcpServers = recordsAt(state, "mcpServers");
  const [directoryTab, setDirectoryTab] =
    useState<ExtensionDirectoryTab>("plugins");
  const [sourceTab, setSourceTab] = useState<PluginSourceTab>("public");
  const [query, setQuery] = useState("");
  const [installOpen, setInstallOpen] = useState(false);
  const [pluginId, setPluginId] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [pluginSource, setPluginSource] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const { busy, message, run } = useSettingsMutation(onRefresh);

  useEffect(() => {
    const handleError = (event: Event) => {
      setOauthError(errorMessage((event as CustomEvent).detail));
    };
    window.addEventListener("onpeople:connector-oauth-error", handleError);
    return () =>
      window.removeEventListener("onpeople:connector-oauth-error", handleError);
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (item: ResourceRecord) => {
    if (!normalizedQuery) return true;
    return [
      text(item.name),
      text(item.id),
      text(item.path),
      text(item.source),
      text(item.command),
      text(item.status),
      text(item.description),
      text(item.category),
      text(item.developer),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  };
  const visibleSkills = skills.filter(matches);
  const visibleMcpServers = mcpServers.filter(matches);
  const directoryPlugins = catalog.filter((plugin) => {
    const personal = plugin.builtin !== true && plugin.remote !== true;
    return (sourceTab === "personal" ? personal : !personal) && matches(plugin);
  });
  const installedPlugins = catalog.filter(
    (plugin) => plugin.installed === true,
  );
  const selectedPlugin =
    catalog.find((plugin) => text(plugin.id) === selectedPluginId) ?? null;
  const categories = Array.from(
    new Set(directoryPlugins.map((plugin) => text(plugin.category, "其他"))),
  );

  const submitInstall = async () => {
    const ok = await run(
      "install-plugin",
      () =>
        desktopClient.installPlugin({
          id: pluginId.trim(),
          name: pluginName.trim() || pluginId.trim(),
          source: pluginSource.trim(),
          cwd,
        }),
      "插件已安装；从下一个任务开始可用",
    );
    if (ok) {
      setPluginId("");
      setPluginName("");
      setPluginSource("");
      setInstallOpen(false);
    }
  };

  const installDirectoryPlugin = async (plugin: ResourceRecord) => {
    const id = text(plugin.id);
    if (!id) return;
    await run(
      `install-plugin-${id}`,
      () =>
        desktopClient.installPlugin({
          ...plugin,
          id,
          source: "",
          cwd,
        }),
      "插件已安装；从下一个任务开始可用",
    );
  };

  const connectPlugin = async (plugin: ResourceRecord) => {
    const id = text(plugin.id);
    if (!id) return;
    setOauthError(null);
    await run(
      `connect-plugin-${id}`,
      async () => {
        const session = await desktopClient.startConnectorOauth(id);
        const authorizationUrl = text(session.authorizationUrl);
        if (!authorizationUrl) throw new Error("授权服务没有返回登录地址");
        await desktopClient.openExternalUrl(authorizationUrl);
      },
      "已在系统浏览器打开授权页面",
    );
  };

  return (
    <section className="plugin-directory">
      <nav className="plugin-directory-topbar" aria-label="扩展类型">
        <div role="tablist">
          <button
            className={directoryTab === "plugins" ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={directoryTab === "plugins"}
            onClick={() => setDirectoryTab("plugins")}
          >
            插件
          </button>
          <button
            className={directoryTab === "skills" ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={directoryTab === "skills"}
            onClick={() => setDirectoryTab("skills")}
          >
            技能
          </button>
        </div>
        <div className="plugin-directory-actions">
          <button
            className="plugin-icon-button"
            type="button"
            aria-label="刷新插件"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "sync-catalog",
                async () => {
                  await desktopClient.syncPluginCatalog();
                  await desktopClient.reloadMcp();
                },
                "插件目录与 MCP 状态已刷新",
              )
            }
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          <button
            className="plugin-create-button"
            type="button"
            onClick={() => setInstallOpen((open) => !open)}
          >
            创建
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </div>
      </nav>

      {installOpen ? (
        <div className="plugin-install-popover">
          <div className="extensions-install-heading">
            <div>
              <strong>安装本地插件</strong>
              <span>
                读取 manifest，复制到 OnPeople 独立运行目录，并在新任务加载。
              </span>
            </div>
            <button
              className="extensions-close-button"
              type="button"
              aria-label="关闭安装表单"
              onClick={() => setInstallOpen(false)}
            >
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="extensions-install-fields">
            <label>
              <span>插件 ID</span>
              <input
                value={pluginId}
                onChange={(event) => setPluginId(event.target.value)}
                placeholder="例如 meeting-follow-up"
                autoFocus
              />
            </label>
            <label>
              <span>显示名称</span>
              <input
                value={pluginName}
                onChange={(event) => setPluginName(event.target.value)}
                placeholder="可选"
              />
            </label>
            <label className="is-wide">
              <span>来源路径或 URL</span>
              <input
                value={pluginSource}
                onChange={(event) => setPluginSource(event.target.value)}
                placeholder="/path/to/plugin 或 https://…"
              />
            </label>
          </div>
          <div className="extensions-install-actions">
            <span>支持稳定的字母、数字、点、短横线和下划线 ID。</span>
            <button
              className="extensions-install-button"
              type="button"
              disabled={
                !pluginId.trim() || !pluginSource.trim() || busy !== null
              }
              onClick={() => void submitInstall()}
            >
              <Plus size={13} aria-hidden="true" />
              {busy === "install-plugin" ? "安装中…" : "安装插件"}
            </button>
          </div>
        </div>
      ) : null}

      {directoryTab === "plugins" ? (
        <div className="plugin-directory-body">
          <header className="plugin-directory-hero">
            <h2>插件</h2>
            <p>把常用工具、文件工作流和本机能力带进 OnPeople。</p>
            <span className="plugin-catalog-status">
              {text(catalogStatus.source, "bundled") === "remote"
                ? `远程目录 · ${String(catalogStatus.count ?? catalog.length)} 个`
                : "OnPeople 内置目录"}
            </span>
          </header>
          <label className="plugin-directory-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索插件"
              aria-label="搜索插件"
            />
          </label>

          <section className="plugin-installed-section">
            <div className="plugin-section-title">
              <h3>已安装</h3>
              <span>{installedPlugins.length}</span>
            </div>
            <div className="plugin-installed-strip">
              {installedPlugins.map((plugin) => {
                const id = text(plugin.id);
                return (
                  <button
                    type="button"
                    key={id}
                    aria-label={`查看 ${text(plugin.name, id)}`}
                    title={text(plugin.name, id)}
                    onClick={() => setSelectedPluginId(id)}
                  >
                    <PluginGlyph plugin={plugin} size={21} />
                  </button>
                );
              })}
            </div>
          </section>

          <div
            className="plugin-source-tabs"
            role="tablist"
            aria-label="插件来源"
          >
            <button
              className={sourceTab === "public" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={sourceTab === "public"}
              onClick={() => setSourceTab("public")}
            >
              公开
            </button>
            <button
              className={sourceTab === "personal" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={sourceTab === "personal"}
              onClick={() => setSourceTab("personal")}
            >
              个人
            </button>
          </div>

          {categories.map((category) => (
            <section className="plugin-catalog-section" key={category}>
              <h3>{category}</h3>
              <div className="plugin-catalog-grid">
                {directoryPlugins
                  .filter(
                    (plugin) => text(plugin.category, "其他") === category,
                  )
                  .map((plugin) => {
                    const id = text(plugin.id);
                    return (
                      <article className="plugin-catalog-card" key={id}>
                        <button
                          className="plugin-card-main"
                          type="button"
                          onClick={() => setSelectedPluginId(id)}
                        >
                          <span className="plugin-card-icon">
                            <PluginGlyph plugin={plugin} size={21} />
                          </span>
                          <span>
                            <strong>{text(plugin.name, id)}</strong>
                            <small>
                              {text(plugin.description, "可用于新任务")}
                            </small>
                          </span>
                        </button>
                        <button
                          className="plugin-card-state"
                          type="button"
                          onClick={() => setSelectedPluginId(id)}
                        >
                          {plugin.installed === true ? "已安装" : "安装"}
                        </button>
                      </article>
                    );
                  })}
              </div>
            </section>
          ))}

          {directoryPlugins.length === 0 ? (
            <div className="plugin-directory-empty">
              <Puzzle size={18} aria-hidden="true" />
              <strong>
                {normalizedQuery ? "没有匹配的插件" : "还没有个人插件"}
              </strong>
              <span>
                {normalizedQuery
                  ? "换一个关键词试试。"
                  : "通过右上角“创建”安装经过审核的本地插件包。"}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="plugin-directory-body skill-directory-body">
          <header className="plugin-directory-hero">
            <h2>技能</h2>
            <p>按需加载的工作流说明，可来自项目或已安装插件。</p>
          </header>
          <label className="plugin-directory-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索技能或 MCP 服务"
              aria-label="搜索技能或 MCP 服务"
            />
          </label>
          <ExtensionSection
            icon={<Sparkles size={15} aria-hidden="true" />}
            title="Skills"
            subtitle="匹配任务时自动使用，也可以在提示词中明确指定。"
            count={visibleSkills.length}
            empty={skills.length === 0 ? "当前没有 Skills" : "没有匹配的 Skill"}
          >
            {visibleSkills.map((skill, index) => {
              const path = text(skill.path);
              const id = path || `skill-${index}`;
              const enabled = skill.enabled !== false;
              return (
                <div className="extension-row" key={id}>
                  <span className="extension-row-icon skill-icon">
                    <Sparkles size={15} aria-hidden="true" />
                  </span>
                  <div className="extension-row-main">
                    <strong>{text(skill.name, "未命名 Skill")}</strong>
                    <span title={path}>{path || "未发现路径"}</span>
                  </div>
                  <span className="extension-row-meta">
                    {text(skill.scope, "project") === "plugin"
                      ? "插件"
                      : "项目"}
                  </span>
                  <button
                    className={`extension-switch ${enabled ? "is-on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    disabled={!path || busy !== null}
                    onClick={() =>
                      void run(
                        `skill-${id}`,
                        () => desktopClient.setSkillEnabled(path, !enabled),
                        enabled ? "Skill 已停用" : "Skill 已启用",
                      )
                    }
                  >
                    <span aria-hidden="true" />
                    {enabled ? "已启用" : "已停用"}
                  </button>
                </div>
              );
            })}
          </ExtensionSection>
          <ExtensionSection
            icon={<Server size={15} aria-hidden="true" />}
            title="MCP 服务"
            subtitle="这些服务向 Agent 提供实际可调用的工具。"
            count={visibleMcpServers.length}
            empty="当前没有 MCP 服务"
          >
            {visibleMcpServers.map((server, index) => {
              const id = text(server.id, `mcp-${index}`);
              return (
                <div className="extension-row" key={id}>
                  <span className="extension-row-icon mcp-icon">
                    <Wrench size={15} aria-hidden="true" />
                  </span>
                  <div className="extension-row-main">
                    <strong>{text(server.name, id)}</strong>
                    <span>
                      {text(server.command, "由 OnPeople MCP Host 管理")}
                    </span>
                  </div>
                  <span className="extension-status is-active">
                    <Check size={12} aria-hidden="true" />
                    {text(server.status, "已配置")}
                  </span>
                </div>
              );
            })}
          </ExtensionSection>
        </div>
      )}

      {selectedPlugin ? (
        <div className="plugin-detail-backdrop" role="presentation">
          <aside className="plugin-detail-panel" aria-label="插件详情">
            <button
              className="plugin-detail-close"
              type="button"
              aria-label="关闭插件详情"
              onClick={() => {
                setSelectedPluginId(null);
                setDeleteId(null);
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
            <span className="plugin-detail-icon">
              <PluginGlyph plugin={selectedPlugin} size={27} />
            </span>
            <h3>{text(selectedPlugin.name, text(selectedPlugin.id))}</h3>
            <p>{text(selectedPlugin.description, "本地插件")}</p>
            <dl>
              <div>
                <dt>开发者</dt>
                <dd>{text(selectedPlugin.developer, "本地开发者")}</dd>
              </div>
              <div>
                <dt>运行方式</dt>
                <dd>{text(selectedPlugin.serverId, "Skills / MCP")}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  {selectedPlugin.authStatus === "connected"
                    ? "已连接账号"
                    : selectedPlugin.installed === true
                      ? "已安装"
                      : "未安装"}
                </dd>
              </div>
            </dl>
            {Array.isArray(selectedPlugin.capabilities) ? (
              <div className="plugin-capabilities">
                {(selectedPlugin.capabilities as unknown[]).map(
                  (capability) => (
                    <span key={String(capability)}>{String(capability)}</span>
                  ),
                )}
              </div>
            ) : null}
            {selectedPlugin.builtin === true ? (
              <div className="plugin-detail-note">
                <Check size={14} aria-hidden="true" />随 OnPeople
                安装，已接入当前 Agent 运行时
              </div>
            ) : selectedPlugin.installed !== true ? (
              <button
                className="plugin-connect-button"
                type="button"
                disabled={busy !== null}
                onClick={() => void installDirectoryPlugin(selectedPlugin)}
              >
                <Plus size={14} aria-hidden="true" />
                {busy === `install-plugin-${text(selectedPlugin.id)}`
                  ? "安装中…"
                  : "安装插件"}
              </button>
            ) : selectedPlugin.connector === true &&
              selectedPlugin.authStatus === "connected" ? (
              <div className="plugin-detail-actions">
                <span className="plugin-connected-state">
                  <Check size={13} aria-hidden="true" />
                  账号已连接
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `disconnect-plugin-${text(selectedPlugin.id)}`,
                      () =>
                        desktopClient.disconnectConnector(
                          text(selectedPlugin.id),
                        ),
                      "连接器账号已断开",
                    )
                  }
                >
                  断开连接
                </button>
              </div>
            ) : selectedPlugin.connector === true ? (
              <>
                <button
                  className="plugin-connect-button"
                  type="button"
                  disabled={busy !== null || !selectedPlugin.oauth}
                  onClick={() => void connectPlugin(selectedPlugin)}
                >
                  <Globe2 size={14} aria-hidden="true" />
                  {busy === `connect-plugin-${text(selectedPlugin.id)}`
                    ? "正在打开…"
                    : "连接账号"}
                </button>
                {!selectedPlugin.oauth ? (
                  <p className="plugin-auth-hint">
                    当前内置目录只提供能力说明；配置远程目录后会加载该连接器的
                    OAuth 授权信息。
                  </p>
                ) : null}
              </>
            ) : deleteId === text(selectedPlugin.id) ? (
              <div className="plugin-detail-actions">
                <button type="button" onClick={() => setDeleteId(null)}>
                  取消
                </button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `remove-plugin-${text(selectedPlugin.id)}`,
                      () =>
                        desktopClient.uninstallPlugin(text(selectedPlugin.id)),
                      "插件已卸载",
                    ).then((ok) => {
                      if (ok) {
                        setSelectedPluginId(null);
                        setDeleteId(null);
                      }
                    })
                  }
                >
                  确认卸载
                </button>
              </div>
            ) : (
              <button
                className="plugin-uninstall-button"
                type="button"
                onClick={() => setDeleteId(text(selectedPlugin.id))}
              >
                <Trash2 size={14} aria-hidden="true" />
                卸载插件
              </button>
            )}
          </aside>
        </div>
      ) : null}
      {oauthError ? (
        <p className="settings-mutation-message is-error" role="alert">
          {oauthError}
        </p>
      ) : null}
      <MutationMessage message={message} />
    </section>
  );
}

function PluginGlyph({
  plugin,
  size,
}: {
  plugin: ResourceRecord;
  size: number;
}) {
  const icon = text(plugin.icon, "plugin");
  const props = { size, "aria-hidden": true } as const;
  switch (icon) {
    case "computer":
      return <Monitor {...props} />;
    case "document":
      return <FileText {...props} />;
    case "pdf":
      return <BookOpen {...props} />;
    case "spreadsheet":
      return <FileSpreadsheet {...props} />;
    case "presentation":
      return <Presentation {...props} />;
    case "template":
      return <FileText {...props} />;
    case "site":
      return <AppWindow {...props} />;
    case "visualize":
      return <Sparkles {...props} />;
    case "image":
      return <FileImage {...props} />;
    case "research":
      return <Search {...props} />;
    case "app":
      return <AppWindow {...props} />;
    default:
      return <Puzzle {...props} />;
  }
}

function ExtensionSection({
  icon,
  title,
  subtitle,
  count,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="extension-section">
      <div className="extension-section-heading">
        <span className="extension-section-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="extension-section-count">{count}</span>
      </div>
      <div className="extension-list">
        {count === 0 ? (
          <p className="extension-empty-row">{empty}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function HookSettings({ resource, cwd, onRefresh }: SettingsActionPanelProps) {
  const state = record(resource);
  const globalHooks = asRecords(state.global);
  const localHooks = asRecords(state.local);
  const [id, setId] = useState("");
  const [event, setEvent] = useState("turn.completed");
  const [command, setCommand] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const { busy, message, run } = useSettingsMutation(onRefresh);

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h2>项目钩子</h2>
        <button type="button" onClick={() => setEditorOpen(true)}>
          新建钩子
        </button>
      </div>
      <div className="settings-card">
        {[...localHooks, ...globalHooks].length === 0 ? (
          <EmptyRow text="当前项目没有钩子" />
        ) : null}
        {localHooks.map((hook, index) => (
          <ActionSetting
            key={text(hook.id, `local-${index}`)}
            label={text(hook.id, "本地 Hook")}
            hint={text(hook.path)}
          >
            <em>项目</em>
          </ActionSetting>
        ))}
        {globalHooks.map((hook, index) => (
          <ActionSetting
            key={text(hook.id, `global-${index}`)}
            label={text(hook.id, "全局 Hook")}
            hint={text(hook.path)}
          >
            <em>全局</em>
          </ActionSetting>
        ))}
      </div>
      {editorOpen ? (
        <div className="settings-editor-card">
          <SettingsEditorHeading
            title="新建项目钩子"
            hint="在指定任务事件发生时运行一条受控命令。"
            onClose={() => setEditorOpen(false)}
          />
          <div className="settings-form-grid">
            <TextField label="Hook ID" value={id} onChange={setId} />
            <TextField label="事件" value={event} onChange={setEvent} />
          </div>
          <TextField label="命令" value={command} onChange={setCommand} />
          <div className="settings-form-actions">
            <button type="button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button
              className="settings-primary-button"
              type="button"
              disabled={!cwd || !id.trim() || !command.trim() || busy !== null}
              onClick={() =>
                void run(
                  "create-hook",
                  () =>
                    desktopClient.createHook({
                      cwd,
                      id: id.trim(),
                      event: event.trim(),
                      command: command.trim(),
                      enabled: true,
                    }),
                  "项目钩子已创建",
                ).then((ok) => ok && setEditorOpen(false))
              }
            >
              创建钩子
            </button>
          </div>
          {!cwd ? (
            <p className="settings-form-hint">请先选择项目目录。</p>
          ) : null}
        </div>
      ) : null}
      <MutationMessage message={message} />
    </section>
  );
}

function SecretSettings({ resource, onRefresh }: SettingsActionPanelProps) {
  const secrets = recordsAt(resource, "secrets");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("user");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { busy, message, run } = useSettingsMutation(onRefresh);

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h2>凭据与密钥</h2>
        <button type="button" onClick={() => setEditorOpen(true)}>
          添加连接
        </button>
      </div>
      <p className="settings-copy">
        密钥值写入系统钥匙串或 Credential Manager；界面只读取元数据。
      </p>
      <div className="settings-card">
        {secrets.length === 0 ? <EmptyRow text="还没有保存的连接" /> : null}
        {secrets.map((secret, index) => {
          const secretId = text(secret.id, `secret-${index}`);
          return (
            <ActionSetting
              key={secretId}
              label={text(secret.name, secretId)}
              hint={`${text(secret.scope, "user")} · ${text(secret.description, "已安全保存")}`}
            >
              {deleteId === secretId ? (
                <span className="settings-confirm-actions">
                  <button type="button" onClick={() => setDeleteId(null)}>
                    取消
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `delete-secret-${secretId}`,
                        () => desktopClient.deleteSecret(secretId),
                        "密钥已删除",
                      ).then((ok) => ok && setDeleteId(null))
                    }
                  >
                    确认删除
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setDeleteId(secretId)}>
                  删除
                </button>
              )}
            </ActionSetting>
          );
        })}
      </div>
      {editorOpen ? (
        <div className="settings-editor-card">
          <SettingsEditorHeading
            title="添加安全连接"
            hint="密钥值只写入系统钥匙串或 Credential Manager。"
            onClose={() => setEditorOpen(false)}
          />
          <div className="settings-form-grid">
            <TextField label="ID（可选）" value={id} onChange={setId} />
            <TextField label="名称" value={name} onChange={setName} />
            <SelectField
              label="作用域"
              value={scope}
              options={[
                ["user", "用户"],
                ["project", "项目"],
                ["session", "会话"],
              ]}
              onChange={setScope}
            />
            <PasswordField label="密钥值" value={value} onChange={setValue} />
          </div>
          <TextField
            label="说明"
            value={description}
            onChange={setDescription}
          />
          <div className="settings-form-actions">
            <button type="button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button
              className="settings-primary-button"
              type="button"
              disabled={!name.trim() || !value || busy !== null}
              onClick={() =>
                void run(
                  "save-secret",
                  () =>
                    desktopClient.saveSecret({
                      ...(id.trim() ? { id: id.trim() } : {}),
                      name: name.trim(),
                      scope,
                      value,
                      description: description.trim(),
                    }),
                  "密钥已安全保存",
                ).then((ok) => {
                  if (!ok) return;
                  setValue("");
                  setEditorOpen(false);
                })
              }
            >
              保存连接
            </button>
          </div>
        </div>
      ) : null}
      <MutationMessage message={message} />
    </section>
  );
}

function WorktreeSettings({
  resource,
  cwd,
  onRefresh,
}: SettingsActionPanelProps) {
  const worktrees = recordsAt(resource, "worktrees");
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("onpeople/task");
  const [editorOpen, setEditorOpen] = useState(false);
  const [removePath, setRemovePath] = useState<string | null>(null);
  const { busy, message, run } = useSettingsMutation(onRefresh);

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h2>隔离工作树</h2>
        <button type="button" onClick={() => setEditorOpen(true)}>
          新建工作树
        </button>
      </div>
      <div className="settings-card">
        {worktrees.length === 0 ? <EmptyRow text="当前仓库没有工作树" /> : null}
        {worktrees.map((worktree, index) => {
          const worktreePath = text(worktree.path, `worktree-${index}`);
          return (
            <ActionSetting
              key={worktreePath}
              label={text(worktree.branch, "detached")}
              hint={`${worktreePath} · ${text(worktree.head)}`}
            >
              {removePath === worktreePath ? (
                <span className="settings-confirm-actions">
                  <button type="button" onClick={() => setRemovePath(null)}>
                    取消
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `remove-worktree-${worktreePath}`,
                        () => desktopClient.removeWorktree(worktreePath, cwd),
                        "工作树已移除",
                      ).then((ok) => ok && setRemovePath(null))
                    }
                  >
                    确认移除
                  </button>
                </span>
              ) : (
                <span className="settings-inline-actions">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `snapshot-${worktreePath}`,
                        () => desktopClient.snapshotWorktree(worktreePath),
                        "工作树快照已保存",
                      )
                    }
                  >
                    快照
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `handoff-${worktreePath}`,
                        () => desktopClient.handoffWorktree(worktreePath),
                        "工作树已交接",
                      )
                    }
                  >
                    交接
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemovePath(worktreePath)}
                  >
                    移除
                  </button>
                </span>
              )}
            </ActionSetting>
          );
        })}
      </div>
      {editorOpen ? (
        <div className="settings-editor-card">
          <SettingsEditorHeading
            title="新建隔离工作树"
            hint="为并行任务创建独立目录与分支。"
            onClose={() => setEditorOpen(false)}
          />
          <div className="settings-form-grid">
            <TextField label="新目录路径" value={path} onChange={setPath} />
            <TextField label="分支" value={branch} onChange={setBranch} />
          </div>
          <div className="settings-form-actions">
            <button type="button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button
              className="settings-primary-button"
              type="button"
              disabled={!cwd || !path.trim() || !branch.trim() || busy !== null}
              onClick={() =>
                void run(
                  "create-worktree",
                  () =>
                    desktopClient.createWorktree({
                      root: cwd,
                      path: path.trim(),
                      branch: branch.trim(),
                    }),
                  "工作树已创建",
                ).then((ok) => ok && setEditorOpen(false))
              }
            >
              创建工作树
            </button>
          </div>
          {!cwd ? (
            <p className="settings-form-hint">请先选择 Git 项目。</p>
          ) : null}
        </div>
      ) : null}
      <MutationMessage message={message} />
    </section>
  );
}

function ArchivedSettings({ resource, onRefresh }: SettingsActionPanelProps) {
  const threads = recordsAt(resource, "threads");
  const { busy, message, run } = useSettingsMutation(onRefresh);

  return (
    <section className="settings-section">
      <h2>已归档的聊天</h2>
      <div className="settings-card">
        {threads.length === 0 ? <EmptyRow text="没有已归档聊天" /> : null}
        {threads.map((thread, index) => {
          const id = text(thread.id, `thread-${index}`);
          return (
            <ActionSetting
              key={id}
              label={text(thread.title, "未命名任务")}
              hint={text(thread.cwd, text(thread.updatedAt))}
            >
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    `restore-${id}`,
                    () => desktopClient.unarchiveThread(id),
                    "聊天已恢复",
                  )
                }
              >
                恢复
              </button>
            </ActionSetting>
          );
        })}
      </div>
      <MutationMessage message={message} />
    </section>
  );
}

function SettingsEditorHeading({
  title,
  hint,
  onClose,
}: {
  title: string;
  hint: string;
  onClose: () => void;
}) {
  return (
    <header className="settings-editor-heading">
      <div>
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
      <button type="button" aria-label={`关闭${title}`} onClick={onClose}>
        <X size={14} aria-hidden="true" />
      </button>
    </header>
  );
}

function SelectSetting({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: Array<[string, string]>;
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
        options={options.map(([option, title]) => ({
          value: option,
          label: title,
        }))}
        onChange={onChange}
      />
    </div>
  );
}

function ToggleSetting({
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

function ActionSetting({
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

function EmptyRow({ text: value }: { text: string }) {
  return <p className="settings-empty">{value}</p>;
}

function TextField({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-field">
      <span>{label}</span>
      <CustomSelect
        ariaLabel={label}
        value={value}
        options={options.map(([option, title]) => ({
          value: option,
          label: title,
        }))}
        onChange={onChange}
      />
    </div>
  );
}

function providerDraft(value: unknown): ProviderDraft {
  const source = record(value);
  const candidate = text(source.kind, "onpeople");
  const kind = providerOptions.some(([provider]) => provider === candidate)
    ? (candidate as ProviderKind)
    : "onpeople";
  return {
    kind,
    model: text(source.model),
    baseUrl: text(source.baseUrl),
    apiKey: "",
    apiKeySet: source.apiKeySet === true,
    scope: "global",
    extra: record(source.extra),
  };
}

function policyDraft(value: unknown) {
  const source = record(value);
  return {
    sandbox: text(source.sandbox, "workspace-write"),
    approvalPolicy: text(source.approvalPolicy, "on-request"),
    reviewer: text(source.reviewer, "user"),
    network: source.network !== false,
    multiAgent: source.multiAgent !== false,
    maxConcurrentAgents:
      typeof source.maxConcurrentAgents === "number"
        ? Math.min(16, Math.max(1, source.maxConcurrentAgents))
        : 4,
  };
}

function record(value: unknown): ResourceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ResourceRecord)
    : {};
}

function asRecords(value: unknown): ResourceRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is ResourceRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

function recordsAt(value: unknown, key: string): ResourceRecord[] {
  return asRecords(record(value)[key]);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
