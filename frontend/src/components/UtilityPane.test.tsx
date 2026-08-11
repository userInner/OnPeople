import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../store/workbenchStore";
import { UtilityPane } from "./UtilityPane";

vi.mock("./tools/BrowserPane", () => ({
  BrowserPane: () => <div>Browser pane</div>,
}));
vi.mock("./tools/FilesPane", () => ({
  FilesPane: () => <div>Files pane</div>,
}));
vi.mock("./tools/GitPane", () => ({
  GitPane: () => <div>Git pane</div>,
}));
vi.mock("./tools/ManagementCenter", () => ({
  ManagementCenter: () => <div>Management pane</div>,
}));

describe("UtilityPane toolbar", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      toolView: "activity",
      utilityOpen: true,
      timeline: [],
    });
  });

  it("keeps exactly three Codex-style panel controls on the right", () => {
    render(
      <UtilityPane
        expanded={false}
        bottomPanelOpen={false}
        onToggleExpanded={vi.fn()}
        onToggleBottomPanel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "展开面板" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "切换底部面板显示" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "显示/隐藏工具舱" }),
    ).toBeVisible();
  });

  it("moves tool selection into one compact menu", () => {
    render(
      <UtilityPane
        expanded={false}
        bottomPanelOpen={false}
        onToggleExpanded={vi.fn()}
        onToggleBottomPanel={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "切换工具，当前：输出" }),
    );
    const menu = screen.getByRole("menu");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(5);
    expect(menu).toHaveAttribute("data-native-surface-occluder", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "浏览器" }));
    expect(useWorkbenchStore.getState().toolView).toBe("browser");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
