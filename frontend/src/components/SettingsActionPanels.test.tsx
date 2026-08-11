import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../lib/desktopClient";
import { SettingsActionPanel } from "./SettingsActionPanels";

vi.mock("../lib/desktopClient", () => ({
  desktopClient: {
    savePolicy: vi.fn(),
    saveProvider: vi.fn(),
    getProviderSettings: vi.fn(),
    validateModel: vi.fn(),
    saveSecret: vi.fn(),
    unarchiveThread: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    reloadMcp: vi.fn(),
    syncPluginCatalog: vi.fn(),
    startConnectorOauth: vi.fn(),
    disconnectConnector: vi.fn(),
    openExternalUrl: vi.fn(),
  },
}));

const refresh = vi.fn(async () => undefined);

describe("SettingsActionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(desktopClient.savePolicy).mockResolvedValue({});
    vi.mocked(desktopClient.saveProvider).mockResolvedValue({
      kind: "openai",
      name: "OpenAI",
      protocol: "responses",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6",
      vision: true,
      apiKeySet: true,
      extra: {},
    });
    vi.mocked(desktopClient.getProviderSettings).mockResolvedValue({
      kind: "openai",
      name: "OpenAI",
      protocol: "responses",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6",
      vision: true,
      apiKeySet: true,
      extra: {},
    });
    vi.mocked(desktopClient.validateModel).mockResolvedValue({ valid: true });
    vi.mocked(desktopClient.saveSecret).mockResolvedValue({});
    vi.mocked(desktopClient.unarchiveThread).mockResolvedValue({});
    vi.mocked(desktopClient.installPlugin).mockResolvedValue({});
    vi.mocked(desktopClient.uninstallPlugin).mockResolvedValue({});
    vi.mocked(desktopClient.reloadMcp).mockResolvedValue({});
    vi.mocked(desktopClient.syncPluginCatalog).mockResolvedValue({});
    vi.mocked(desktopClient.startConnectorOauth).mockResolvedValue({});
    vi.mocked(desktopClient.disconnectConnector).mockResolvedValue({});
    vi.mocked(desktopClient.openExternalUrl).mockResolvedValue({});
  });

  it("installs a connector from the remote directory before authorization", async () => {
    render(
      <SettingsActionPanel
        route="plugins"
        resource={{
          skills: [],
          mcpServers: [],
          catalogStatus: { source: "remote", count: 1 },
          catalog: [
            {
              id: "gmail",
              name: "Gmail",
              description: "读取授权邮箱",
              category: "生产力",
              developer: "Google",
              connector: true,
              remote: true,
              installed: false,
              capabilities: ["邮件"],
            },
          ],
        }}
        cwd="/workspace"
        threadId="thread-1"
        onRefresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Gmail/ }));
    fireEvent.click(screen.getByRole("button", { name: "安装插件" }));

    await waitFor(() =>
      expect(desktopClient.installPlugin).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "gmail",
          source: "",
          cwd: "/workspace",
          connector: true,
        }),
      ),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("persists the edited computer-control policy", async () => {
    render(
      <SettingsActionPanel
        route="computer"
        resource={{
          policy: {
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            reviewer: "user",
            network: true,
            multiAgent: true,
            maxConcurrentAgents: 4,
          },
        }}
        cwd="/workspace"
        threadId="thread-1"
        onRefresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: /沙盒/ }));
    fireEvent.click(screen.getByRole("option", { name: "完整访问" }));
    fireEvent.click(screen.getByRole("switch", { name: /允许网络访问/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存权限策略" }));

    await waitFor(() =>
      expect(desktopClient.savePolicy).toHaveBeenCalledWith("thread-1", {
        sandbox: "danger-full-access",
        approvalPolicy: "on-request",
        reviewer: "user",
        network: false,
        multiAgent: true,
        maxConcurrentAgents: 4,
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("saves a provider and model at the selected scope", async () => {
    render(
      <SettingsActionPanel
        route="models"
        resource={{
          provider: {
            kind: "openai",
            name: "OpenAI",
            protocol: "responses",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-5.6",
            vision: true,
            apiKeySet: true,
            extra: {},
          },
          catalog: {
            models: [
              {
                id: "gpt-5.6",
                name: "GPT-5.6",
                provider: "openai",
                vision: true,
                reasoningEfforts: ["high"],
              },
            ],
          },
        }}
        cwd="/workspace"
        threadId="thread-1"
        onRefresh={refresh}
      />,
    );

    fireEvent.change(screen.getByLabelText("API Key（已保存，留空则保留）"), {
      target: { value: "new-key" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: /保存范围/ }));
    fireEvent.click(screen.getByRole("option", { name: "仅当前任务" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));

    await waitFor(() =>
      expect(desktopClient.saveProvider).toHaveBeenCalledWith({
        kind: "openai",
        model: "gpt-5.6",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "new-key",
        threadId: "thread-1",
        extra: {},
      }),
    );
  });

  it("saves a credential without exposing it in the resource list", async () => {
    render(
      <SettingsActionPanel
        route="connections"
        resource={{ secrets: [] }}
        cwd="/workspace"
        threadId="thread-1"
        onRefresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "GitHub" },
    });
    fireEvent.change(screen.getByLabelText("密钥值"), {
      target: { value: "secret-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

    await waitFor(() =>
      expect(desktopClient.saveSecret).toHaveBeenCalledWith({
        name: "GitHub",
        scope: "user",
        value: "secret-token",
        description: "",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("密钥值")).not.toBeInTheDocument(),
    );
  });

  it("restores an archived task", async () => {
    render(
      <SettingsActionPanel
        route="archived"
        resource={{
          threads: [
            {
              id: "thread-archived",
              title: "历史任务",
              cwd: "/workspace",
            },
          ],
        }}
        cwd="/workspace"
        threadId="thread-1"
        onRefresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    await waitFor(() =>
      expect(desktopClient.unarchiveThread).toHaveBeenCalledWith(
        "thread-archived",
      ),
    );
  });
});
