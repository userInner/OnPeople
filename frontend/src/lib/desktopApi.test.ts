import { describe, expect, it, vi } from "vitest";

import { createDesktopApiClient, DESKTOP_PROTOCOL_VERSION } from "./desktopApi";

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
});
