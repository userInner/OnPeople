import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopClient } from "../../lib/desktopClient";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { LocalArtifactPreview } from "./LocalArtifactPreview";

vi.mock("../../lib/desktopClient", () => ({
  desktopClient: {
    previewLocalArtifact: vi.fn(),
    openLocalArtifact: vi.fn(),
    copyText: vi.fn(),
    openExternalUrl: vi.fn(),
  },
}));

describe("LocalArtifactPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbenchStore.setState({
      selectedThreadId: "thread-preview",
      localArtifactPreview: {
        id: "preview-request",
        path: "/workspace/README.md",
        threadId: "thread-preview",
      },
    });
    vi.mocked(desktopClient.openLocalArtifact).mockResolvedValue({
      opened: true,
    });
    vi.mocked(desktopClient.copyText).mockResolvedValue();
  });

  it("renders Markdown in the file preview and keeps system open secondary", async () => {
    vi.mocked(desktopClient.previewLocalArtifact).mockResolvedValue({
      name: "README.md",
      path: "README.md",
      absolutePath: "/workspace/README.md",
      kind: "text",
      mimeType: "text/markdown",
      size: 28,
      content: "# OnPeople\n\n内置预览正常。",
    });

    render(<LocalArtifactPreview />);

    expect(
      await screen.findByRole("heading", { name: "OnPeople" }),
    ).toBeVisible();
    expect(screen.getByText("内置预览正常。")).toBeVisible();
    expect(desktopClient.previewLocalArtifact).toHaveBeenCalledWith(
      "/workspace/README.md",
      "thread-preview",
    );

    fireEvent.click(screen.getByRole("button", { name: "使用系统应用打开" }));
    await waitFor(() =>
      expect(desktopClient.openLocalArtifact).toHaveBeenCalledWith(
        "/workspace/README.md",
        "thread-preview",
      ),
    );
  });

  it("embeds PDFs without handing them to another application", async () => {
    useWorkbenchStore.setState({
      localArtifactPreview: {
        id: "preview-pdf",
        path: "/workspace/report.pdf",
        threadId: "thread-preview",
      },
    });
    vi.mocked(desktopClient.previewLocalArtifact).mockResolvedValue({
      name: "report.pdf",
      absolutePath: "/workspace/report.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      size: 1024,
      dataUrl: "data:application/pdf;base64,JVBERg==",
    });

    render(<LocalArtifactPreview />);

    const frame = await screen.findByTitle("report.pdf");
    expect(frame).toHaveAttribute(
      "src",
      "data:application/pdf;base64,JVBERg==",
    );
    expect(desktopClient.openLocalArtifact).not.toHaveBeenCalled();
  });

  it("renders HTML in a sandboxed, script-free data-URL frame instead of showing source", async () => {
    useWorkbenchStore.setState({
      localArtifactPreview: {
        id: "preview-html",
        path: "/workspace/hello.html",
        threadId: "thread-preview",
      },
    });
    vi.mocked(desktopClient.previewLocalArtifact).mockResolvedValue({
      name: "hello.html",
      absolutePath: "/workspace/hello.html",
      kind: "text",
      mimeType: "text/html; charset=utf-8",
      size: 84,
      content:
        "<!doctype html><html><head><style>p{color:red}</style></head><body><p>hello world</p><script>alert(1)</script></body></html>",
    });

    render(<LocalArtifactPreview />);

    const frame = await screen.findByTitle("hello.html");
    // A fully-restricted sandbox (no allow-scripts/allow-same-origin) means the
    // frame cannot execute scripts or reach the privileged desktop bridge.
    expect(frame).toHaveAttribute("sandbox", "");
    const src = frame.getAttribute("src") ?? "";
    expect(src.startsWith("data:text/html")).toBe(true);
    const decoded = decodeURIComponent(
      src.replace(/^data:text\/html;charset=utf-8,/, ""),
    );
    expect(decoded).toContain("hello world");
    expect(decoded).toContain("p{color:red}");
    expect(decoded).not.toContain("<script");
    expect(decoded).not.toContain("alert(1)");
  });

  it("formats JSON and explains unsupported Office files", async () => {
    vi.mocked(desktopClient.previewLocalArtifact).mockResolvedValue({
      name: "config.json",
      kind: "text",
      mimeType: "application/json",
      content: '{"ready":true}',
    });
    const view = render(<LocalArtifactPreview />);
    expect(await screen.findByText(/"ready": true/)).toBeVisible();

    useWorkbenchStore.setState({
      localArtifactPreview: {
        id: "preview-docx",
        path: "/workspace/spec.docx",
        threadId: "thread-preview",
      },
    });
    vi.mocked(desktopClient.previewLocalArtifact).mockResolvedValue({
      name: "spec.docx",
      kind: "binary",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 4096,
    });
    view.rerender(<LocalArtifactPreview key="preview-docx" />);

    expect(await screen.findByText("这种格式暂不支持内置预览")).toBeVisible();
  });
});
