import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { BrowserWorkspace } from "./BrowserWorkspace";

describe("BrowserWorkspace", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Codex-style two-row browser chrome", () => {
    render(<BrowserWorkspace onBack={() => undefined} />);

    expect(screen.getByRole("tab", { name: /新标签页/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭 新标签页" })).toBeVisible();
    expect(screen.getByRole("button", { name: "新建标签页" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "地址和搜索" })).toBeVisible();
    expect(screen.getByText("共享浏览器")).toBeVisible();
    expect(screen.getByRole("heading", { name: "从这里开始" })).toBeVisible();
  });

  it("opens tools as a compact menu without a modal mask", () => {
    render(<BrowserWorkspace onBack={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "浏览器工具" }));

    expect(screen.getByRole("menu")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /DOM 快照/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /视觉快照/ })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: /登录与站点数据/ }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("recovers invalid persisted tab URLs instead of crashing the workbench", () => {
    localStorage.setItem(
      "onpeople.browser.tabs.v2",
      JSON.stringify([
        {
          id: "invalid-tab",
          url: "://broken-url",
          title: "",
          lastActiveAt: 1,
        },
      ]),
    );

    render(<BrowserWorkspace onBack={() => undefined} />);

    expect(screen.getByRole("tab")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "地址和搜索" })).toBeVisible();
  });

  it("does not mount a renderer webview for browser pages", () => {
    render(<BrowserWorkspace onBack={() => undefined} />);

    expect(document.querySelector("webview")).toBeNull();
    expect(document.querySelector(".browser-guest")).toBeInTheDocument();
  });
});
