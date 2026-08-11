import { describe, expect, it } from "vitest";

import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("reads structured Tauri errors", () => {
    expect(
      errorMessage({
        code: "RUNTIME_UNAVAILABLE",
        message: "OnPeople 桌面服务尚未就绪",
        retryable: true,
      }),
    ).toBe("OnPeople 桌面服务尚未就绪");
  });

  it("keeps native Error messages", () => {
    expect(errorMessage(new Error("连接失败"))).toBe("连接失败");
  });

  it("never exposes object coercion placeholders", () => {
    expect(errorMessage({ code: "UNKNOWN" })).toBe('{"code":"UNKNOWN"}');
    expect(errorMessage({})).toBe("操作失败");
  });
});
