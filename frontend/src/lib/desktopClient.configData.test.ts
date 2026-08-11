import { afterEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "./desktopClient";

describe("desktopClient config and data compatibility", () => {
  afterEach(() => {
    delete window.__ONPEOPLE_DEV__;
  });

  it("routes legacy helpers through stable Desktop API methods", async () => {
    const methods: string[] = [];
    const params: unknown[] = [];
    const invoke = vi.fn(async (command: string, args: unknown) => {
      expect(command).toBe("desktop_request");
      const request = (
        args as {
          request: { requestId: string; method: string; params: unknown };
        }
      ).request;
      methods.push(request.method);
      params.push(request.params);
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result: {},
      };
    });
    window.__ONPEOPLE_DEV__ = {
      setWorkbenchState: vi.fn() as never,
      invoke,
    };

    await desktopClient.getProvider("onpeople");
    await desktopClient.getProviderSettings("openai");
    await desktopClient.saveProvider({
      kind: "openai",
      model: "gpt-test",
      baseUrl: "https://example.test/v1",
    });
    await desktopClient.discoverModels();
    await desktopClient.validateModel("openai", "gpt-test");
    await desktopClient.listExtensions("/workspace");
    await desktopClient.setSkillEnabled("/workspace/SKILL.md", true);
    await desktopClient.getPolicy();
    await desktopClient.savePolicy("global", {
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      reviewer: "user",
      network: true,
      multiAgent: true,
      maxConcurrentAgents: 4,
    });
    await desktopClient.getEffectiveConfig({ cwd: "/workspace" });
    await desktopClient.getUsageLedger();
    await desktopClient.saveUsagePrice("input", 0.1);
    await desktopClient.listMemories("/workspace", "thread-1");
    await desktopClient.saveMemory({
      scope: "project",
      cwd: "/workspace",
      content: "remember",
    });
    await desktopClient.deleteMemory("memory-1");
    await desktopClient.saveMemorySettings({ enabled: true });
    await desktopClient.listSecrets();
    await desktopClient.saveSecret({ name: "token", value: "secret" });
    await desktopClient.deleteSecret("secret-1");
    await desktopClient.listHooks("/workspace");
    await desktopClient.listLocalHooks("/workspace");
    await desktopClient.createHook({
      cwd: "/workspace",
      id: "verify",
      event: "turn.completed",
      command: "npm test",
      enabled: true,
    });

    expect(methods).toEqual([
      "provider.get",
      "provider.get",
      "provider.save",
      "models.discover",
      "models.validate",
      "extensions.list",
      "extensions.skill.set-enabled",
      "policy.get",
      "policy.save",
      "config.effective",
      "usage.get",
      "usage.price.save",
      "memory.list",
      "memory.save",
      "memory.delete",
      "memory.settings.save",
      "secret.list",
      "secret.save",
      "secret.delete",
      "hook.list",
      "hook.local.list",
      "hook.create",
    ]);
    expect(params.at(-1)).toEqual({
      cwd: "/workspace",
      id: "verify",
      event: "turn.completed",
      command: "npm test",
      enabled: true,
    });
  });

  it("preserves optional hook id and JSON event/command values", async () => {
    const invoke = vi.fn(async (command: string, args: unknown) => {
      expect(command).toBe("desktop_request");
      const request = (
        args as {
          request: { requestId: string; method: string; params: unknown };
        }
      ).request;
      expect(request.method).toBe("hook.create");
      expect(request.params).toEqual({
        cwd: "/workspace",
        id: null,
        event: { kind: "turn.completed", attempt: 2 },
        command: ["npm", "test"],
        enabled: null,
      });
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result: {
          id: "hook",
          event: { kind: "turn.completed", attempt: 2 },
          command: ["npm", "test"],
          enabled: true,
        },
      };
    });
    window.__ONPEOPLE_DEV__ = {
      setWorkbenchState: vi.fn() as never,
      invoke,
    };

    await expect(
      desktopClient.createHook({
        cwd: "/workspace",
        event: { kind: "turn.completed", attempt: 2 },
        command: ["npm", "test"],
      }),
    ).resolves.toEqual({
      id: "hook",
      event: { kind: "turn.completed", attempt: 2 },
      command: ["npm", "test"],
      enabled: true,
    });
  });
});
