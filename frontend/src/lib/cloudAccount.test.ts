import { describe, expect, it } from "vitest";

import { isCloudAccountState } from "./cloudAccount";

describe("isCloudAccountState", () => {
  it("accepts an authoritative account snapshot", () => {
    expect(
      isCloudAccountState({
        signedIn: true,
        serviceUrl: "https://onpeople.example",
        account: { email: "person@example.com" },
        group: null,
        models: [],
      }),
    ).toBe(true);
  });

  it("rejects partial cloud events so they cannot erase login state", () => {
    expect(isCloudAccountState({ live: { active: true } })).toBe(false);
  });
});
