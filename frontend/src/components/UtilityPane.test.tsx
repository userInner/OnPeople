import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../store/workbenchStore";
import { UtilityPane } from "./UtilityPane";

vi.mock("./tools/FilesPane", () => ({
  FilesPane: () => <div>Files pane</div>,
}));
vi.mock("./tools/GitPane", () => ({
  GitPane: () => <div>Git pane</div>,
}));
vi.mock("./tools/ManagementCenter", () => ({
  ManagementCenter: () => <div>Management pane</div>,
}));
vi.mock("./browser/BrowserWorkspace", () => ({
  BrowserWorkspace: ({ onBack }: { onBack: () => void }) => (
    <div>
      Browser pane
      <button type="button" onClick={onBack}>
        Back to output
      </button>
    </div>
  ),
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

  it("uses a Codex-style active tab and new-tab launcher", () => {
    render(
      <UtilityPane
        expanded={false}
        bottomPanelOpen={false}
        onToggleExpanded={vi.fn()}
        onToggleBottomPanel={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "当前侧面板：输出" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "新建侧面板标签" }));
    const menu = screen.getByRole("menu");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(5);
    expect(menu).toHaveAttribute("data-native-surface-occluder", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "文件" }));
    expect(useWorkbenchStore.getState().toolView).toBe("files");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the browser inside the task side panel", () => {
    useWorkbenchStore.setState({ toolView: "browser" });
    render(
      <UtilityPane
        expanded={false}
        bottomPanelOpen={false}
        onToggleExpanded={vi.fn()}
        onToggleBottomPanel={vi.fn()}
      />,
    );

    expect(screen.getByText("Browser pane")).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "当前侧面板：浏览器" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "关闭浏览器标签" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back to output" }));
    expect(useWorkbenchStore.getState().toolView).toBe("activity");
  });

  it("routes every output creation control to the file workspace", () => {
    render(
      <UtilityPane
        expanded={false}
        bottomPanelOpen={false}
        onToggleExpanded={vi.fn()}
        onToggleBottomPanel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开文件面板" }));
    expect(useWorkbenchStore.getState().toolView).toBe("files");

    fireEvent.click(screen.getByRole("button", { name: "关闭文件标签" }));
    expect(useWorkbenchStore.getState().toolView).toBe("activity");
    fireEvent.click(screen.getByRole("button", { name: "查看全部来源" }));
    expect(useWorkbenchStore.getState().toolView).toBe("files");
  });
});
