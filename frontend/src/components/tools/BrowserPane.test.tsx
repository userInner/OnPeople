import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../../lib/desktopClient";
import { constrainedBrowserSurfaceBounds } from "../../lib/browserSurfaceBounds";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { BrowserPane } from "./BrowserPane";

vi.mock("../../lib/desktopClient", () => ({
  isElectronRuntime: vi.fn(() => false),
  desktopClient: {
    activateBrowserTab: vi.fn(),
    browserCommand: vi.fn(),
    browserSurfaceBounds: vi.fn(),
    captureBrowserVisualSnapshot: vi.fn(),
    getBrowserSessionStatus: vi.fn(),
    openBrowserSignIn: vi.fn(),
    fillSavedBrowserCredential: vi.fn(),
    clearBrowserSession: vi.fn(),
    clearAllBrowserData: vi.fn(),
    listBrowserImportProfiles: vi.fn(),
    importBrowserProfile: vi.fn(),
    listBrowserAnnotations: vi.fn(),
    streamBrowser: vi.fn(),
  },
}));

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

class TestIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect() {}
}

describe("BrowserPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.mocked(desktopClient.activateBrowserTab).mockResolvedValue({});
    vi.mocked(desktopClient.browserSurfaceBounds).mockResolvedValue({});
    vi.mocked(desktopClient.captureBrowserVisualSnapshot).mockResolvedValue({});
    vi.mocked(desktopClient.getBrowserSessionStatus).mockResolvedValue({
      persistent: true,
      cookieCount: 0,
      partition: "persist:onpeople-browser",
    });
    vi.mocked(desktopClient.openBrowserSignIn).mockResolvedValue({});
    vi.mocked(desktopClient.fillSavedBrowserCredential).mockResolvedValue({});
    vi.mocked(desktopClient.clearBrowserSession).mockResolvedValue({});
    vi.mocked(desktopClient.clearAllBrowserData).mockResolvedValue({});
    vi.mocked(desktopClient.listBrowserImportProfiles).mockResolvedValue({
      profiles: [
        {
          id: "chrome-default",
          name: "Default",
          browser: "Google Chrome",
          path: "/tmp/Chrome/Default",
        },
      ],
    });
    vi.mocked(desktopClient.importBrowserProfile).mockResolvedValue({
      imported: true,
      requiresRestart: true,
    });
    vi.mocked(desktopClient.listBrowserAnnotations).mockResolvedValue([]);
    vi.mocked(desktopClient.streamBrowser).mockResolvedValue(undefined);
    useWorkbenchStore.setState({
      selectedThreadId: "thread-current",
      localArtifactPreview: null,
      browser: {
        hostReady: true,
        hostStatus: "ready",
        activeRouteId: "route-other",
        profilePath: "/tmp/browser-profile",
        tabs: [
          {
            routeId: "route-current",
            threadId: "thread-current",
            url: "https://openai.com/",
            title: "OpenAI",
            faviconUrl: null,
            loading: false,
            canGoBack: false,
            canGoForward: false,
            crashed: false,
          },
          {
            routeId: "route-other",
            threadId: "thread-other",
            url: "https://example.com/",
            title: "Other task",
            faviconUrl: null,
            loading: false,
            canGoBack: false,
            canGoForward: false,
            crashed: false,
          },
        ],
      },
    });
  });

  it("keeps tabs scoped to the current thread and restores its active tab", async () => {
    render(<BrowserPane />);

    expect(screen.getByRole("tab", { name: "OpenAI" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Other task" })).toBeNull();
    await waitFor(() =>
      expect(desktopClient.activateBrowserTab).toHaveBeenCalledWith(
        "thread-current",
        "route-current",
      ),
    );
  });

  it("shows when the user takes control of the shared page", () => {
    render(<BrowserPane />);

    expect(screen.getByText("共享浏览器")).toBeVisible();
    fireEvent.focus(screen.getByRole("application"));
    expect(screen.getByText("你在控制")).toBeVisible();
  });

  it("opens the browser tools menu from the Electron toolbar", async () => {
    render(<BrowserPane />);

    const trigger = screen.getByRole("button", { name: "更多浏览器工具" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "true"),
    );
    expect(screen.getByRole("menu")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /DOM 快照/ })).toBeEnabled();
  });

  it("opens the menu before a slow visual fallback capture completes", async () => {
    let resolveCapture: ((value: Record<string, unknown>) => void) | undefined;
    vi.mocked(desktopClient.captureBrowserVisualSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    );
    render(<BrowserPane />);

    fireEvent.click(screen.getByRole("button", { name: "更多浏览器工具" }));
    expect(screen.getByRole("menu")).toBeVisible();
    resolveCapture?.({});
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "更多浏览器工具" }),
      ).toHaveAttribute("aria-expanded", "true"),
    );
  });

  it("opens session status from the menu", async () => {
    render(<BrowserPane />);
    fireEvent.click(screen.getByRole("button", { name: "更多浏览器工具" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /登录与浏览器数据/ }));
    expect(await screen.findByText("登录与浏览器数据")).toBeVisible();
    expect(desktopClient.getBrowserSessionStatus).toHaveBeenCalledWith(
      "route-current",
    );
    expect(screen.getByText("持久化浏览器会话")).toBeVisible();
  });

  it("opens the Codex-style browser import dialog and preserves import choices", async () => {
    render(<BrowserPane />);
    fireEvent.click(screen.getByRole("button", { name: "更多浏览器工具" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /登录与浏览器数据/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "从浏览器导入" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "从浏览器导入" }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "浏览器来源" })).toHaveValue(
      "chrome-default",
    );
    expect(screen.getByRole("checkbox", { name: /Cookies/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /保存的密码/ }));
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() =>
      expect(desktopClient.importBrowserProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: "chrome-default",
          includePasswords: true,
          includeCookies: true,
          includeHistory: true,
        }),
        "route-current",
      ),
    );
  });

  it("renders the browser home instead of a native black surface for about:blank", async () => {
    useWorkbenchStore.setState((state) => ({
      browser: state.browser
        ? {
            ...state.browser,
            activeRouteId: "route-current",
            tabs: state.browser.tabs.map((tab) =>
              tab.routeId === "route-current"
                ? { ...tab, url: "about:blank", title: "" }
                : tab,
            ),
          }
        : null,
    }));

    render(<BrowserPane />);

    expect(
      screen.getByRole("textbox", { name: "搜索或输入网址" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "浏览器地址" })).toHaveValue("");
    expect(screen.getByRole("tab", { name: "新标签页" })).toBeVisible();
    expect(screen.queryByRole("application")).toBeNull();
    await waitFor(() =>
      expect(desktopClient.browserSurfaceBounds).toHaveBeenCalledWith(
        expect.objectContaining({
          routeId: "route-current",
          visible: false,
        }),
      ),
    );
  });

  it("keeps a stale native page measurement below the browser chrome", () => {
    expect(
      constrainedBrowserSurfaceBounds(
        {
          left: 920,
          top: 129,
          right: 1480,
          bottom: 930,
          width: 560,
          height: 801,
        },
        {
          left: 120,
          top: 86,
          right: 1480,
          bottom: 930,
          width: 1360,
          height: 844,
        },
        {
          left: 120,
          top: 172,
          right: 1480,
          bottom: 217,
          width: 1360,
          height: 45,
        },
      ),
    ).toEqual({ x: 120, y: 217, width: 1360, height: 713 });
  });
});
