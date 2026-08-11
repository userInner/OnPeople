import { describe, expect, it } from "vitest";

import { parseDeepLinkActions } from "./deepLinks";

describe("parseDeepLinkActions", () => {
  it("handles native plugin payloads and second-instance argv", () => {
    expect(
      parseDeepLinkActions({
        argv: [
          "/Applications/OnPeople.app/Contents/MacOS/onpeople-tauri",
          "onpeople://task/thread-7",
          "onpeople://settings/browser",
        ],
      }),
    ).toEqual([
      { kind: "task", threadId: "thread-7" },
      { kind: "settings", route: "browser" },
    ]);
    expect(
      parseDeepLinkActions('["onpeople://new?cwd=%2Fworkspace%2Fdemo"]'),
    ).toEqual([{ kind: "new-task", cwd: "/workspace/demo" }]);
  });

  it("parses connector OAuth callbacks without exposing extra query data", () => {
    expect(
      parseDeepLinkActions(
        "onpeople://oauth/callback?state=state123&code=code456&ignored=secret",
      ),
    ).toEqual([
      {
        kind: "connector-oauth",
        state: "state123",
        code: "code456",
      },
    ]);
    expect(
      parseDeepLinkActions(
        "onpeople://oauth/callback?state=state123&error=access_denied",
      ),
    ).toEqual([
      {
        kind: "connector-oauth",
        state: "state123",
        error: "access_denied",
      },
    ]);
  });
});
