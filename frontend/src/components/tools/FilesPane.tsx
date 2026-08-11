import {
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileCode2,
  Folder,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { errorMessage } from "../../lib/errors";
import { useWorkbenchStore } from "../../store/workbenchStore";
import type { FileEntry } from "../../types";
import { IconButton } from "../IconButton";

interface WorkspaceFilePreview extends Record<string, unknown> {
  name?: string;
  path?: string;
  absolutePath?: string;
  kind?: "text" | "image" | "pdf" | "binary";
  mimeType?: string;
  size?: number | bigint;
  content?: string;
  dataUrl?: string;
  message?: string;
}

export function FilesPane() {
  const cwd = useWorkbenchStore((state) => {
    const thread = state.threadList.threads.find(
      (item) => item.id === state.selectedThreadId,
    );
    return thread?.cwd ?? thread?.projectPath ?? state.draftCwd ?? "";
  });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [relative, setRelative] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextRelative: string, searchQuery: string) => {
      if (!cwd) {
        setEntries([]);
        return;
      }
      setLoading(true);
      try {
        const next = searchQuery.trim()
          ? (await desktopClient.searchProjectFiles(cwd, searchQuery.trim()))
              .entries
          : await desktopClient.listProjectFiles(cwd, nextRelative);
        setEntries(next);
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [cwd],
  );

  useEffect(() => {
    setRelative("");
    setQuery("");
    setPreview(null);
  }, [cwd]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(relative, query),
      query.trim() ? 160 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [load, query, relative]);

  const navigate = (path: string) => {
    setRelative(path);
    setQuery("");
    setPreview(null);
  };

  const openFile = async (path: string) => {
    setPreviewLoading(true);
    setError(null);
    try {
      setPreview(
        (await desktopClient.openWorkspaceFile(
          cwd,
          path,
        )) as WorkspaceFilePreview,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPreviewLoading(false);
    }
  };

  const projectName = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "项目";

  return (
    <div className="files-pane">
      <label className="tool-search">
        <Search size={14} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索文件"
          aria-label="搜索文件"
        />
      </label>
      <div className="file-breadcrumbs">
        <button type="button" onClick={() => navigate("")}>
          {projectName}
        </button>
        {relative
          .split(/[\\/]/)
          .filter(Boolean)
          .map((part, index, parts) => (
            <span key={`${part}-${index}`}>
              <ChevronRight size={12} />
              <button
                type="button"
                onClick={() => navigate(parts.slice(0, index + 1).join("/"))}
              >
                {part}
              </button>
            </span>
          ))}
        {query.trim() ? (
          <span>
            <ChevronRight size={12} />
            搜索“{query.trim()}”
          </span>
        ) : null}
      </div>
      {error ? <div className="tool-error">{error}</div> : null}
      <div className={`files-workspace ${preview ? "has-preview" : ""}`}>
        <div className="file-list">
          {loading ? (
            <div className="tool-loading">
              <LoaderCircle className="spin" size={15} />
              读取项目文件
            </div>
          ) : null}
          {!loading && entries.length === 0 ? (
            <p className="files-empty">
              {cwd ? "当前目录没有匹配的文件。" : "请先选择项目目录。"}
            </p>
          ) : null}
          {entries.map((entry) => (
            <button
              type="button"
              key={entry.path}
              className={preview?.path === entry.path ? "is-active" : ""}
              onClick={() =>
                entry.kind === "directory"
                  ? navigate(entry.path)
                  : void openFile(entry.path)
              }
              onDoubleClick={() => {
                if (entry.kind === "file") {
                  void desktopClient.openEditor({ cwd, path: entry.path });
                }
              }}
              title={
                entry.kind === "directory"
                  ? `打开 ${entry.path}`
                  : `预览 ${entry.path}；双击使用外部应用打开`
              }
            >
              {entry.kind === "directory" ? (
                <Folder size={15} />
              ) : entry.name.match(
                  /\.(?:ts|tsx|js|jsx|rs|go|py|css|html)$/i,
                ) ? (
                <FileCode2 size={15} />
              ) : (
                <File size={15} />
              )}
              <span>{entry.name}</span>
              <small>{formatFileSize(entry.size)}</small>
            </button>
          ))}
        </div>
        {preview || previewLoading ? (
          <aside className="file-preview" aria-label="文件预览">
            <header>
              <span>
                <strong>{text(preview?.name, "文件预览")}</strong>
                <small>{text(preview?.path)}</small>
              </span>
              <IconButton
                icon={Copy}
                label="复制文件路径"
                disabled={!preview}
                onClick={() => {
                  const path = text(preview?.absolutePath, text(preview?.path));
                  if (path) void desktopClient.copyText(path);
                }}
              />
              <IconButton
                icon={ExternalLink}
                label="使用外部应用打开"
                disabled={!preview?.path}
                onClick={() =>
                  preview?.path &&
                  void desktopClient.openEditor({ cwd, path: preview.path })
                }
              />
              <IconButton
                icon={X}
                label="关闭文件预览"
                onClick={() => setPreview(null)}
              />
            </header>
            <FilePreviewBody preview={preview} loading={previewLoading} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function FilePreviewBody({
  preview,
  loading,
}: {
  preview: WorkspaceFilePreview | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="tool-loading">
        <LoaderCircle className="spin" size={15} />
        读取文件
      </div>
    );
  }
  if (!preview) return null;
  if (preview.kind === "image" && preview.dataUrl) {
    return <img src={preview.dataUrl} alt={text(preview.name, "图片预览")} />;
  }
  if (preview.kind === "pdf" && preview.dataUrl) {
    return (
      <iframe src={preview.dataUrl} title={text(preview.name, "PDF 预览")} />
    );
  }
  if (preview.kind === "text") {
    return <pre>{preview.content ?? ""}</pre>;
  }
  return (
    <div className="file-preview-empty">
      <File size={22} />
      <strong>{text(preview.mimeType, "二进制文件")}</strong>
      <span>
        {text(
          preview.message,
          `${formatFileSize(preview.size)} · 请使用外部应用打开`,
        )}
      </span>
    </div>
  );
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
