import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../lib/desktopClient";
import { prepareLocalArtifactMarkdown } from "../lib/localArtifacts";
import { useWorkbenchStore } from "../store/workbenchStore";
import { MarkdownMessage } from "./MarkdownMessage";

afterEach(() => vi.restoreAllMocks());

describe("MarkdownMessage local screenshots", () => {
  beforeEach(() => {
    useWorkbenchStore.setState((state) => ({
      localArtifactPreview: null,
      toolView: "activity",
      preferences: { ...state.preferences, defaultFileOpener: "smart" },
    }));
  });

  it("rewrites sandbox links into safe local artifact references", () => {
    const prepared = prepareLocalArtifactMarkdown(
      "截图：[screenshot](sandbox:/tmp/mac-screenshot.png)",
    );

    expect(prepared.markdown).toContain(
      "[screenshot](#onpeople-local-artifact-0)",
    );
    expect(prepared.artifacts).toEqual([
      {
        id: "onpeople-local-artifact-0",
        label: "screenshot",
        path: "/tmp/mac-screenshot.png",
        image: true,
        card: true,
      },
    ]);
  });

  it("recognizes clickable absolute file links without adding noisy code cards", () => {
    const prepared = prepareLocalArtifactMarkdown(
      "[server.ts](/Users/demo/project/src/server.ts:42)",
    );

    expect(prepared.markdown).toBe("[server.ts](#onpeople-local-artifact-0)");
    expect(prepared.artifacts[0]).toMatchObject({
      path: "/Users/demo/project/src/server.ts",
      image: false,
      card: false,
    });
  });

  it("previews the screenshot in the file pane", async () => {
    useWorkbenchStore.setState({ selectedThreadId: "thread-local-image" });
    vi.spyOn(desktopClient, "readGeneratedImage").mockResolvedValue({
      name: "mac-screenshot.png",
      dataUrl: "data:image/png;base64,AAAA",
    });
    render(
      <MarkdownMessage text="截图：[screenshot](sandbox:/tmp/mac-screenshot.png)" />,
    );

    expect(
      await screen.findByRole("img", { name: "screenshot" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "screenshot" }));

    expect(useWorkbenchStore.getState().localArtifactPreview).toMatchObject({
      path: "/tmp/mac-screenshot.png",
      threadId: "thread-local-image",
    });
    expect(useWorkbenchStore.getState().toolView).toBe("files");
  });

  it("renders PDFs as file cards and routes them to the file pane", () => {
    useWorkbenchStore.setState({ selectedThreadId: "thread-local-pdf" });

    render(
      <MarkdownMessage text="报告：[验收报告](sandbox:/tmp/report.pdf)" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预览文件 验收报告" }));
    expect(useWorkbenchStore.getState().localArtifactPreview).toMatchObject({
      path: "/tmp/report.pdf",
      threadId: "thread-local-pdf",
    });
  });

  it("keeps the system application preference as an explicit fallback", async () => {
    useWorkbenchStore.setState((state) => ({
      selectedThreadId: "thread-system-file",
      preferences: { ...state.preferences, defaultFileOpener: "system" },
    }));
    const openLocal = vi
      .spyOn(desktopClient, "openLocalArtifact")
      .mockResolvedValue({ opened: true });

    render(<MarkdownMessage text="[hello.md](/workspace/hello.md)" />);
    fireEvent.click(screen.getByRole("link", { name: "hello.md" }));

    await waitFor(() =>
      expect(openLocal).toHaveBeenCalledWith(
        "/workspace/hello.md",
        "thread-system-file",
      ),
    );
    expect(useWorkbenchStore.getState().localArtifactPreview).toBeNull();
  });

  it("opens HTTP links in the external browser", async () => {
    const openExternal = vi
      .spyOn(desktopClient, "openExternalUrl")
      .mockResolvedValue({ opened: true });

    render(<MarkdownMessage text="[OpenAI](https://openai.com/docs)" />);
    fireEvent.click(screen.getByRole("link", { name: "OpenAI" }));

    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith("https://openai.com/docs"),
    );
  });
});
