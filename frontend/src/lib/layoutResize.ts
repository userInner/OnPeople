import type { ToolView } from "../types";

export const DEFAULT_SIDEBAR_WIDTH = 275;
export const MINIMUM_SIDEBAR_WIDTH = 220;
export const MAXIMUM_SIDEBAR_WIDTH = 480;
export const MINIMUM_UTILITY_WIDTH = 420;

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function maximumSidebarWidth(
  windowWidth: number,
  utilityOpen: boolean,
  toolView: ToolView,
  utilityWidth: number,
) {
  const utilityReserve = utilityOpen
    ? toolView === "activity"
      ? 302
      : Math.max(MINIMUM_UTILITY_WIDTH, utilityWidth)
    : 0;
  return Math.max(
    MINIMUM_SIDEBAR_WIDTH,
    Math.min(MAXIMUM_SIDEBAR_WIDTH, windowWidth - utilityReserve - 500),
  );
}

export function maximumUtilityWidth(
  windowWidth: number,
  sidebarOpen: boolean,
  sidebarWidth: number,
) {
  return Math.max(
    MINIMUM_UTILITY_WIDTH,
    windowWidth - (sidebarOpen ? sidebarWidth : 0) - 500,
  );
}
