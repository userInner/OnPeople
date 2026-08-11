import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../../store/workbenchStore";
import { TerminalPane } from "./TerminalPane";

vi.mock("@xterm/xterm", () => ({ Terminal: class Terminal {} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class FitAddon {} }));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class WebLinksAddon {},
}));

describe("TerminalPane", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      selectedThreadId: null,
      draftCwd: null,
      threadList: { threads: [], projects: [] },
    });
  });

  it("shows a useful empty state until a workspace is selected", () => {
    render(<TerminalPane />);

    expect(screen.getByText("选择工作空间后即可启动终端")).toBeVisible();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });
});
