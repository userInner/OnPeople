import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../../lib/desktopClient";
import { constrainedBrowserSurfaceBounds } from "../../lib/browserSurfaceBounds";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { BrowserPane } from "./BrowserPane";

vi.mock("../../lib/desktopClient", () => ({
  desktopClient: {
    activateBrowserTab: vi.fn(),
    browserCommand: vi.fn(),
    browserSurfaceBounds: vi.fn(),
    captureBrowserVisualSnapshot: vi.fn(),
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
