import { describe, expect, it } from "vitest";

import { resolveOnPeopleIcon } from "./onPeopleIcons";

describe("OnPeople SVG icon resolver", () => {
  it("maps emoji manifest values to the matching outline icon", () => {
    expect(resolveOnPeopleIcon("\u{1f4c4}")).toBe("document");
    expect(resolveOnPeopleIcon("PDF \u{1f4d5}")).toBe("pdf");
    expect(resolveOnPeopleIcon("\u{1f310} web")).toBe("browser");
    expect(resolveOnPeopleIcon("\u{1f9e9}")).toBe("plugin");
  });

  it("keeps unknown metadata on the safe plugin fallback", () => {
    expect(resolveOnPeopleIcon("some-platform-icon")).toBe("plugin");
    expect(resolveOnPeopleIcon(null, "model")).toBe("model");
  });
});
