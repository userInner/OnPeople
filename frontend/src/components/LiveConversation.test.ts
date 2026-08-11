import { describe, expect, it, vi } from "vitest";

import {
  LIVE_AGENT_INSTRUCTIONS,
  describeLiveMediaError,
  microphonePermissionError,
  withTimeout,
} from "./LiveConversation";

describe("live conversation delegation speech", () => {
  it("allows only one acknowledgement and treats cancellation as terminal", () => {
    expect(LIVE_AGENT_INSTRUCTIONS).toContain("acknowledge it at most once");
    expect(LIVE_AGENT_INSTRUCTIONS).toContain("authoritative and terminal");
    expect(LIVE_AGENT_INSTRUCTIONS).toContain(
      "Never repeat placeholder progress",
    );
  });

  it("requires confirmed background-task creation before saying work started", () => {
    expect(LIVE_AGENT_INSTRUCTIONS).toContain(
      "until client context explicitly confirms",
    );
  });
});

describe("live conversation media errors", () => {
  it("explains a denied microphone permission without exposing a raw DOM error", () => {
    expect(
      describeLiveMediaError(new DOMException("denied", "NotAllowedError")),
    ).toEqual({
      status: "麦克风权限未开启",
      transcript: "请在系统设置 → 隐私与安全性 → 麦克风中允许 OnPeople。",
    });
  });

  it("distinguishes a missing input device", () => {
    expect(
      describeLiveMediaError(new DOMException("missing", "NotFoundError")),
    ).toEqual({
      status: "没有找到可用麦克风",
      transcript: "请连接麦克风，或检查当前声音输入设备。",
    });
  });

  it("keeps an actionable fallback for service and signaling failures", () => {
    expect(describeLiveMediaError(new Error("GPT-Live 暂不可用"))).toEqual({
      status: "GPT-Live 暂不可用",
      transcript: "请检查登录状态、网络和麦克风权限。",
    });
  });

  it("maps a native microphone denial to the normal permission guidance", () => {
    expect(describeLiveMediaError(microphonePermissionError("denied"))).toEqual(
      {
        status: "麦克风权限未开启",
        transcript: "请在系统设置 → 隐私与安全性 → 麦克风中允许 OnPeople。",
      },
    );
  });

  it("does not leave a WebView media request pending forever", async () => {
    vi.useFakeTimers();
    const result = withTimeout(
      new Promise<never>(() => undefined),
      100,
      "media timeout",
    );
    const rejection = expect(result).rejects.toMatchObject({
      name: "TimeoutError",
      message: "media timeout",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    vi.useRealTimers();
  });
});
