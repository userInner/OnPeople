import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../types";
import {
  executionRecoveryPresentation,
  retryCommandPrompt,
  shouldShowStallWarning,
  STALL_WARNING_MS,
} from "./executionRecovery";

function notice(overrides: Partial<TimelineItem>): TimelineItem {
  return {
    id: "notice",
    role: "error",
    kind: "notice",
    text: "",
    ...overrides,
  };
}

describe("execution recovery", () => {
  it("explains connection recovery without claiming work was lost", () => {
    expect(
      executionRecoveryPresentation(
        notice({ title: "连接已中断", text: "本次回复未完成，可以重新发送。" }),
      ),
    ).toMatchObject({
      kind: "connection",
      primaryAction: "reconnect",
      route: "WS 优先 · HTTP 备用",
    });
  });

  it("distinguishes a real transport fallback from a generic disconnect", () => {
    expect(
      executionRecoveryPresentation(
        notice({
          role: "system",
          title: "连接方式已切换",
          text: "WebSocket retry exhausted; fallback to HTTP.",
        }),
      ),
    ).toMatchObject({ kind: "transport", route: "WS → HTTP" });
  });

  it("offers checkpoint resume after a timeout", () => {
    expect(
      executionRecoveryPresentation(notice({ text: "request timed out" })),
    ).toMatchObject({
      kind: "timeout",
      primaryAction: "resume",
      primaryLabel: "从断点继续",
    });
  });

  it("keeps command retry input compact", () => {
    const prompt = retryCommandPrompt(
      notice({ exitCode: 7 }),
      "npm run test:unit",
    );
    expect(prompt).toContain("退出码 7");
    expect(prompt).toContain("npm run test:unit");
    expect(prompt).not.toContain("命令输出");
  });

  it("warns only when live work is quiet and not awaiting the user", () => {
    const base = {
      runtimeWorking: true,
      lastActivityAt: 1_000,
      now: 1_000 + STALL_WARNING_MS,
      awaitingUser: false,
    };
    expect(shouldShowStallWarning(base)).toBe(true);
    expect(shouldShowStallWarning({ ...base, awaitingUser: true })).toBe(false);
    expect(shouldShowStallWarning({ ...base, runtimeWorking: false })).toBe(
      false,
    );
  });
});
