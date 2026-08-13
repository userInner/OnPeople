import DOMPurify from "dompurify";
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
import { useEffect, useMemo, useState } from "react";

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
  const src = useMemo(() => buildSandboxedHtmlUrl(content), [content]);

  return (
    <iframe
      className="local-artifact-html"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      src={src}
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

const HTML_PREVIEW_BASE_STYLE = `
  :root { color-scheme: light; }
  html { margin: 0; }
  body {
    margin: 0;
    box-sizing: border-box;
    min-height: 100vh;
    padding: 24px;
    color: #171717;
    background: #fff;
  }
  img, video, canvas, svg { max-width: 100%; height: auto; }
  pre { max-width: 100%; overflow: auto; }
`;

const HTML_PREVIEW_CSP =
  "default-src 'none'; img-src data:; media-src data:; font-src data:; " +
  "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

// Untrusted HTML artifacts are rendered inside a fully sandboxed iframe (no
// allow-scripts, no allow-same-origin) loaded from an opaque `data:` origin, so
// scripts can never execute and the frame cannot reach the privileged desktop
// bridge, even if DOMPurify is bypassed. DOMPurify (the first, defense-in-depth
// layer) keeps the whole document so head-level <style> survives; the sandbox
// plus the document's own CSP is the second layer.
function buildSandboxedHtmlUrl(content: string): string {
  const sanitized = DOMPurify.sanitize(content, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "base",
      "meta",
      "link",
      "form",
    ],
    FORBID_ATTR: [
      "target",
      "srcdoc",
      "nonce",
      "integrity",
      "action",
      "formaction",
    ],
  });
  const injectedHead =
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">` +
    `<style>${HTML_PREVIEW_BASE_STYLE}</style>`;
  const documentHtml = sanitized.includes("<head>")
    ? sanitized.replace("<head>", `<head>${injectedHead}`)
    : `<html><head>${injectedHead}</head><body>${sanitized}</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html>${documentHtml}`,
  )}`;
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
