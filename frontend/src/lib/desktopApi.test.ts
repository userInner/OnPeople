import { describe, expect, it, vi } from "vitest";

import {
  createDesktopApiClient,
  DESKTOP_PROTOCOL_VERSION,
  legacyQueuedSteerResult,
  legacySteerResult,
} from "./desktopApi";

describe("DesktopApiClient", () => {
  it("sends a versioned request with a stable method name", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        methods: ["system.capabilities"],
        orderedEvents: true,
        reconnectable: false,
      },
    }));
    const client = createDesktopApiClient(transport, () => "request-1");

    const result = await client.request("system.capabilities", {});

    expect(result.protocolVersion).toBe(DESKTOP_PROTOCOL_VERSION);
    expect(transport).toHaveBeenCalledWith({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: "request-1",
      method: "system.capabilities",
      params: {},
    });
  });

  it("rejects a response belonging to another request", async () => {
    const client = createDesktopApiClient(
      async () => ({
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        requestId: "other-request",
        ok: true,
        result: null,
      }),
      () => "request-2",
    );

    await expect(client.request("runtime.start", {})).rejects.toMatchObject({
      code: "RUNTIME_PROTOCOL",
    });
  });

  it("preserves structured Rust errors", async () => {
    const client = createDesktopApiClient(
      async (request) => ({
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        error: {
          code: "RUNTIME_UNAVAILABLE",
          message: "运行时不可用",
          retryable: true,
        },
      }),
      () => "request-3",
    );

    await expect(
      client.request("runtime.diagnostics", {}),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      retryable: true,
    });
  });

  it("subscribes through the shell event adapter", async () => {
    const dispose = vi.fn();
    const eventTransport = vi.fn(async () => dispose);
    const client = createDesktopApiClient(
      async (request) => ({
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        result: null,
      }),
      () => "request-4",
      eventTransport,
    );
    const handler = vi.fn();

    const unsubscribe = await client.subscribe(handler);

    expect(eventTransport).toHaveBeenCalledWith(handler);
    unsubscribe();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("requests an exclusive bounded event replay after reconnecting", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {
        events: [],
        oldestAvailableSequence: null,
        latestSequence: 41,
        requiresSnapshot: false,
        hasMore: false,
      },
    }));
    const client = createDesktopApiClient(transport, () => "request-replay");

    await client.request("event.replay", {
      afterSequence: 41,
      limit: 256,
    });

    expect(transport).toHaveBeenCalledWith({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: "request-replay",
      method: "event.replay",
      params: { afterSequence: 41, limit: 256 },
    });
  });

  it("uses the task domain instead of a shell-specific prompt command", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {
        taskId: "turn-1",
        threadId: "thread-1",
        state: "running",
        acceptedAt: "2026-08-11T00:00:00Z",
        lastSequence: 4,
      },
    }));
    const client = createDesktopApiClient(transport, () => "request-5");

    const task = await client.request("task.start", {
      threadId: null,
      text: "hello",
      cwd: null,
      workspaceMode: "isolated",
      images: [],
      attachments: [],
      capability: null,
      mode: null,
      industryPlugin: null,
      model: null,
      reasoningEffort: null,
    });

    expect(task.taskId).toBe("turn-1");
    expect(transport.mock.calls[0]?.[0].method).toBe("task.start");
  });

  it("uses typed task interaction methods instead of legacy shell commands", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result:
        request.method === "task.queue"
          ? {
              id: "queue-1",
              threadId: "thread-1",
              text: "继续检查",
              queuedAt: "2026-08-11T00:00:00Z",
            }
          : {
              requestId: "approval-1",
              decision: "acceptForSession",
            },
    }));
    const client = createDesktopApiClient(transport, () => "request-6");

    const queued = await client.request("task.queue", {
      threadId: "thread-1",
      text: "继续检查",
    });
    const approval = await client.request("task.approval.resolve", {
      requestId: "approval-1",
      decision: "acceptForSession",
    });

    expect(queued.id).toBe("queue-1");
    expect(approval.decision).toBe("acceptForSession");
    expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
      "task.queue",
      "task.approval.resolve",
    ]);
  });

  it("routes browser and plugin capabilities through stable domain methods", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: request.method === "browser.state" ? { hostReady: true } : {},
    }));
    const client = createDesktopApiClient(transport, () => "request-domains");

    await client.request("browser.state", {});
    await client.request("browser.action", {
      action: "navigate",
      payload: { routeId: "route-1", url: "https://example.com" },
    });
    await client.request("plugin.uninstall", { pluginId: "example" });
    await client.request("connector.disconnect", { pluginId: "example" });

    expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
      "browser.state",
      "browser.action",
      "plugin.uninstall",
      "connector.disconnect",
    ]);
  });

  it("routes conversation, project, agent and worktree capabilities through stable methods", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {},
    }));
    const client = createDesktopApiClient(transport, () => "request-workbench");

    await client.request("thread.timeline", { threadId: "thread-1" });
    await client.request("project.update", {
      projectPath: "/workspace",
      action: "pin",
      value: true,
    });
    await client.request("agent.message", {
      agentId: "agent-1",
      text: "继续",
    });
    await client.request("worktree.snapshot", {
      worktreePath: "/workspace",
      output: null,
    });

    expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
      "thread.timeline",
      "project.update",
      "agent.message",
      "worktree.snapshot",
    ]);
  });

  it("routes scheduler, cloud and live controls through stable methods", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {},
    }));
    const client = createDesktopApiClient(transport, () => "request-services");

    await client.request("scheduler.mark-read", { runId: null });
    await client.request("cloud.login", {
      email: "user@example.com",
      password: "secret",
    });
    await client.request("live.close", { callId: "call-1" });

    expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
      "scheduler.mark-read",
      "cloud.login",
      "live.close",
    ]);
  });

  it("preserves legacy steering response shapes", () => {
    expect(
      legacySteerResult({
        accepted: true,
        threadId: "thread-1",
        taskId: "turn-1",
        lastSequence: 8,
        result: { turn: { id: "turn-1" } },
      }),
    ).toEqual({ turn: { id: "turn-1" } });
    expect(
      legacyQueuedSteerResult({
        accepted: true,
        steered: true,
        id: "queue-1",
        threadId: "thread-1",
        taskId: "turn-1",
        lastSequence: 9,
        result: { turn: { id: "turn-1" } },
      }),
    ).toEqual({
      steered: true,
      id: "queue-1",
      result: { turn: { id: "turn-1" } },
    });
  });

  it("routes terminal, file and git calls through stable domain methods", async () => {
    const transport = vi.fn(async (request) => ({
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result:
        request.method === "terminal.write"
          ? null
          : request.method === "file.list"
            ? []
            : {
                repository: true,
                root: "/workspace",
                branch: "main",
                upstream: null,
                ahead: 0,
                behind: 0,
                files: [],
              },
    }));
    const client = createDesktopApiClient(transport, () => "request-native");

    await client.request("terminal.write", {
      processId: "terminal-1",
      data: "pwd\n",
    });
    await client.request("file.list", { cwd: "/workspace", relative: "" });
    await client.request("git.state", { cwd: "/workspace" });

    expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
      "terminal.write",
      "file.list",
      "git.state",
    ]);
  });
});
