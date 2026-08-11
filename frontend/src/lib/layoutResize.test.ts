import { describe, expect, it } from "vitest";

import {
  clamp,
  maximumSidebarWidth,
  maximumUtilityWidth,
} from "./layoutResize";

describe("layout resize constraints", () => {
  it("keeps the sidebar inside its readable desktop range", () => {
    expect(clamp(180, 220, 480)).toBe(220);
    expect(clamp(340, 220, 480)).toBe(340);
    expect(clamp(620, 220, 480)).toBe(480);
  });

  it("reserves room for the active utility pane", () => {
    expect(maximumSidebarWidth(1_400, false, "browser", 560)).toBe(480);
    expect(maximumSidebarWidth(1_000, true, "activity", 560)).toBe(220);
    expect(maximumSidebarWidth(1_500, true, "browser", 620)).toBe(380);
  });

  it("uses the current sidebar width when sizing the utility pane", () => {
    expect(maximumUtilityWidth(1_600, true, 320)).toBe(780);
    expect(maximumUtilityWidth(1_100, true, 320)).toBe(420);
    expect(maximumUtilityWidth(1_100, false, 320)).toBe(600);
  });
});
