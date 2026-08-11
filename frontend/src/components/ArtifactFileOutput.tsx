import { Eye, File, FileArchive, FileText } from "lucide-react";
import { useState } from "react";

import { errorMessage } from "../lib/errors";
import { useWorkbenchStore } from "../store/workbenchStore";

const archiveExtensions = new Set(["zip", "tar", "gz", "7z"]);
const documentExtensions = new Set([
  "pdf",
  "txt",
  "md",
  "log",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "xml",
  "yaml",
  "yml",
  "toml",
  "rtf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);

export function ArtifactFileOutput({
  path,
  label,
}: {
  path: string;
  label?: string;
}) {
  const threadId = useWorkbenchStore((state) => state.selectedThreadId);
  const showLocalArtifact = useWorkbenchStore(
    (state) => state.showLocalArtifact,
  );
  const [error, setError] = useState<string | null>(null);
  const name = label || path.split(/[\\/]/).at(-1) || "本地文件";
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  const Icon = archiveExtensions.has(extension)
    ? FileArchive
    : documentExtensions.has(extension)
      ? FileText
      : File;

  const open = () => {
    setError(null);
    void showLocalArtifact(path, threadId).catch((cause) =>
      setError(errorMessage(cause)),
    );
  };

  return (
    <div className="local-file-output">
      <button type="button" onClick={open} aria-label={`预览文件 ${name}`}>
        <span className="local-file-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="local-file-copy">
          <strong>{name}</strong>
          <small>{extension ? extension.toUpperCase() : "FILE"}</small>
        </span>
        <Eye size={14} aria-hidden="true" />
      </button>
      {error ? (
        <div className="local-artifact-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
