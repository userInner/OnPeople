import {
  Clipboard,
  ExternalLink,
  File,
  FileCode2,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { errorMessage } from "../../lib/errors";
import { useWorkbenchStore } from "../../store/workbenchStore";
import type { LocalArtifactPreview } from "../../types";
import { IconButton } from "../IconButton";
import { MarkdownMessage } from "../MarkdownMessage";

export function LocalArtifactPreview() {
  const request = useWorkbenchStore((state) => state.localArtifactPreview);
  const close = useWorkbenchStore((state) => state.closeLocalArtifact);
  const [preview, setPreview] = useState<LocalArtifactPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    let active = true;
    void desktopClient
      .previewLocalArtifact(request.path, request.threadId)
      .then((value) => {
        if (active) setPreview(value as LocalArtifactPreview);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);

  if (!request) return null;
  const path = text(preview?.absolutePath, request.path);
  const name = text(preview?.name, fileName(request.path));
  const extension = name.split(".").at(-1)?.toUpperCase() || "FILE";

  const openWithSystem = () => {
    setError(null);
    void desktopClient
      .openLocalArtifact(path, request.threadId)
      .catch((cause) => setError(errorMessage(cause)));
  };

  return (
    <div className="local-artifact-preview" aria-label={`预览文件 ${name}`}>
      <div className="local-artifact-tab-strip">
        <div className="local-artifact-tab" role="tab" aria-selected="true">
          {previewIcon(preview)}
          <span>{name}</span>
          <small>{formatFileSize(preview?.size)}</small>
          <button type="button" aria-label={`关闭 ${name}`} onClick={close}>
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="local-artifact-toolbar">
        <div className="local-artifact-address" title={path}>
          {previewIcon(preview)}
          <strong>{path}</strong>
          <span>{extension}</span>
        </div>
        <IconButton
          icon={Clipboard}
          label="复制文件路径"
          onClick={() => void desktopClient.copyText(path)}
        />
        <IconButton
          icon={ExternalLink}
          label="使用系统应用打开"
          onClick={openWithSystem}
        />
      </div>
      <div className="local-artifact-surface">
        {loading ? (
          <div className="local-artifact-status" role="status">
            <LoaderCircle className="spin" size={18} />
            <span>正在读取 {name}</span>
          </div>
        ) : error ? (
          <div className="local-artifact-status is-error" role="alert">
            <File size={24} />
            <strong>无法在 OnPeople 中预览</strong>
            <span>{error}</span>
            <button type="button" onClick={openWithSystem}>
              使用系统应用打开
            </button>
          </div>
        ) : (
          <LocalArtifactPreviewBody
            preview={preview}
            fileName={name}
            onOpenWithSystem={openWithSystem}
          />
        )}
      </div>
    </div>
  );
}

function LocalArtifactPreviewBody({
  preview,
  fileName,
  onOpenWithSystem,
}: {
  preview: LocalArtifactPreview | null;
  fileName: string;
  onOpenWithSystem: () => void;
}) {
  const content = useMemo(() => formattedText(preview), [preview]);
  if (!preview) return null;
  if (preview.kind === "image" && preview.dataUrl) {
    return (
      <div className="local-artifact-image">
        <img src={preview.dataUrl} alt={text(preview.name, "图片预览")} />
      </div>
    );
  }
  if (preview.kind === "pdf" && preview.dataUrl) {
    return (
      <iframe
        className="local-artifact-pdf"
        src={preview.dataUrl}
        title={text(preview.name, "PDF 预览")}
      />
    );
  }
  if (preview.kind === "audio" && preview.dataUrl) {
    return (
      <div className="local-artifact-media">
        <FileText size={30} />
        <strong>{text(preview.name, "音频文件")}</strong>
        <audio controls src={preview.dataUrl} />
      </div>
    );
  }
  if (preview.kind === "video" && preview.dataUrl) {
    return (
      <div className="local-artifact-video">
        <video controls src={preview.dataUrl} />
      </div>
    );
  }
  if (preview.kind === "text" && isHtmlPreview(preview, fileName)) {
    return (
      <SandboxedHtmlPreview
        content={preview.content ?? ""}
        title={text(preview.name, "HTML 预览")}
      />
    );
  }
  if (preview.kind === "text" && preview.mimeType === "text/markdown") {
    return (
      <article className="local-artifact-markdown">
        <MarkdownMessage text={preview.content ?? ""} />
      </article>
    );
  }
  if (preview.kind === "text") {
    return <pre className="local-artifact-code">{content}</pre>;
  }
  return (
    <div className="local-artifact-status">
      <File size={26} />
      <strong>这种格式暂不支持内置预览</strong>
      <span>
        {text(
          preview.message,
          `${formatFileSize(preview.size)} · ${text(preview.mimeType, "二进制文件")}`,
        )}
      </span>
      <button type="button" onClick={onOpenWithSystem}>
        使用系统应用打开
      </button>
    </div>
  );
}

function SandboxedHtmlPreview({
  content,
  title,
}: {
  content: string;
  title: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => sanitizedHtmlFragment(content), [content]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const baseStyle = document.createElement("style");
    baseStyle.textContent = `
      :host { display: block; min-height: 100%; color: #171717; background: #fff; }
      .onpeople-html-document { box-sizing: border-box; min-height: 100%; padding: 24px; }
      img, video, canvas, svg { max-width: 100%; height: auto; }
      pre { max-width: 100%; overflow: auto; }
    `;
    const page = document.createElement("article");
    page.className = "onpeople-html-document";
    page.innerHTML = html;
    root.replaceChildren(baseStyle, page);
  }, [html]);

  return (
    <div
      className="local-artifact-html"
      ref={hostRef}
      role="document"
      aria-label={title}
    />
  );
}

function formattedText(preview: LocalArtifactPreview | null): string {
  const content = preview?.content ?? "";
  if (preview?.mimeType !== "application/json" || !content.trim()) {
    return content;
  }
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function sanitizedHtmlFragment(content: string): string {
  const parsed = new DOMParser().parseFromString(content, "text/html");
  parsed
    .querySelectorAll(
      "script, iframe, frame, object, embed, applet, portal, link, base, meta",
    )
    .forEach((node) => node.remove());
  parsed.querySelectorAll("form").forEach((form) => {
    form.replaceWith(...Array.from(form.childNodes));
  });
  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        [
          "srcdoc",
          "nonce",
          "integrity",
          "target",
          "action",
          "formaction",
        ].includes(name)
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (["src", "poster", "xlink:href"].includes(name)) {
        if (!attribute.value.trim().toLowerCase().startsWith("data:")) {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      if (name === "href" && !attribute.value.trim().startsWith("#")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        const safeStyle = sanitizedCss(attribute.value);
        if (safeStyle) element.setAttribute(attribute.name, safeStyle);
        else element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName.toLowerCase() === "style") {
      element.textContent = sanitizedCss(element.textContent ?? "");
    }
  });
  const headStyles = Array.from(parsed.head.querySelectorAll("style"))
    .map((style) => style.outerHTML)
    .join("");
  return `${headStyles}${parsed.body.innerHTML}`;
}

function sanitizedCss(css: string): string {
  return css
    .replace(/@import\s+[^;]+;?/giu, "")
    .replace(/url\s*\([^)]*\)/giu, "none")
    .replace(/expression\s*\([^)]*\)/giu, "");
}

function isHtmlPreview(
  preview: LocalArtifactPreview,
  resolvedName: string,
): boolean {
  const mimeType = text(preview.mimeType)
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const fileIdentity = [
    resolvedName,
    text(preview.name),
    text(preview.path),
    text(preview.absolutePath),
  ]
    .join("\n")
    .toLowerCase();
  return (
    mimeType === "text/html" || /\.(?:html?|xhtml)(?:\n|$)/u.test(fileIdentity)
  );
}

function previewIcon(preview: LocalArtifactPreview | null) {
  if (preview?.kind === "image") return <ImageIcon size={13} />;
  if (preview?.kind === "text") return <FileCode2 size={13} />;
  return <FileText size={13} />;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || "本地文件";
}

function formatFileSize(value: number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "";
  const size = Number(value);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value ? value : fallback;
}
