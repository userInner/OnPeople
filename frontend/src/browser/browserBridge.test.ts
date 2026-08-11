import { describe, expect, it } from "vitest";

import { normalizeBrowserAddress } from "./browserBridge";

describe("normalizeBrowserAddress", () => {
  it("keeps supported URLs and expands host names", () => {
    expect(normalizeBrowserAddress("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(normalizeBrowserAddress("example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(normalizeBrowserAddress(" ")).toBe("about:blank");
  });

  it("turns plain text into a Google search", () => {
    expect(normalizeBrowserAddress("OnPeople browser")).toBe(
      "https://www.google.com/search?q=OnPeople%20browser",
    );
  });
});
