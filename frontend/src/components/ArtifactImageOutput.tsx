import {
  Check,
  Clipboard,
  ExternalLink,
  Image as ImageIcon,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import { errorMessage } from "../lib/errors";
import { useWorkbenchStore } from "../store/workbenchStore";

export function ArtifactImageOutput({
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
  const [image, setImage] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void desktopClient
      .readGeneratedImage(path, threadId)
      .then((value) => {
        if (active) setImage(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [path, threadId]);

  const dataUrl =
    typeof image?.dataUrl === "string" ? image.dataUrl : undefined;
  const name =
    label ||
    (typeof image?.name === "string"
      ? image.name
      : (path.split(/[\\/]/).at(-1) ?? "图片"));

  return (
    <div className="generated-image-output">
      {dataUrl ? (
        <button
          className="generated-image-preview"
          type="button"
          aria-label={`打开图片 ${name}`}
          onClick={() =>
            void showLocalArtifact(path, threadId).catch((cause) =>
              setError(errorMessage(cause)),
            )
          }
        >
          <img src={dataUrl} alt={name} />
        </button>
      ) : error ? (
        <div className="generated-image-error">{error}</div>
      ) : (
        <div className="generated-image-loading">
          <LoaderCircle className="spin" size={15} />
          读取图片
        </div>
      )}
      <footer>
        <span>
          <ImageIcon size={13} aria-hidden="true" />
          <strong>{name}</strong>
        </span>
        <button
          type="button"
          disabled={!dataUrl}
          onClick={() => {
            void desktopClient
              .copyGeneratedImage(path, threadId)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              })
              .catch((cause) => setError(errorMessage(cause)));
          }}
        >
          {copied ? <Check size={13} /> : <Clipboard size={13} />}
          {copied ? "已复制" : "复制图片"}
        </button>
        <button
          type="button"
          onClick={() =>
            void desktopClient
              .revealGeneratedImage(path, threadId)
              .catch((cause) => setError(errorMessage(cause)))
          }
        >
          <ExternalLink size={13} />
          打开
        </button>
      </footer>
    </div>
  );
}
