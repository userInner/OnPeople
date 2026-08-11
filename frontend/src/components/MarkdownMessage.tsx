import DOMPurify from "dompurify";
import { marked } from "marked";
import { type MouseEvent, useMemo, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import { errorMessage } from "../lib/errors";
import { prepareLocalArtifactMarkdown } from "../lib/localArtifacts";
import { useWorkbenchStore } from "../store/workbenchStore";
import { ArtifactFileOutput } from "./ArtifactFileOutput";
import { ArtifactImageOutput } from "./ArtifactImageOutput";

export function MarkdownMessage({ text }: { text: string }) {
  const threadId = useWorkbenchStore((state) => state.selectedThreadId);
  const showLocalArtifact = useWorkbenchStore(
    (state) => state.showLocalArtifact,
  );
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const prepared = useMemo(() => prepareLocalArtifactMarkdown(text), [text]);
  const html = useMemo(() => {
    const rendered = marked.parse(prepared.markdown, {
      async: false,
      breaks: true,
      gfm: true,
    }) as string;
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["form", "input", "button", "iframe", "object", "embed"],
      FORBID_ATTR: ["style", "onerror", "onclick"],
    });
  }, [prepared.markdown]);

  const openLocalArtifact = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    const artifact = prepared.artifacts.find(
      (entry) => `#${entry.id}` === href,
    );
    if (artifact) {
      event.preventDefault();
      setArtifactError(null);
      void showLocalArtifact(artifact.path, threadId).catch((cause) =>
        setArtifactError(errorMessage(cause)),
      );
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      setArtifactError(null);
      void desktopClient
        .openExternalUrl(href)
        .catch((cause) => setArtifactError(errorMessage(cause)));
    }
  };

  return (
    <>
      <div
        className="markdown-message"
        onClick={openLocalArtifact}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {prepared.artifacts.some((artifact) => artifact.card) ? (
        <div className="local-artifact-gallery">
          {prepared.artifacts
            .filter((artifact) => artifact.card)
            .map((artifact) =>
              artifact.image ? (
                <ArtifactImageOutput
                  key={`${artifact.id}-${artifact.path}`}
                  path={artifact.path}
                  label={artifact.label}
                />
              ) : (
                <ArtifactFileOutput
                  key={`${artifact.id}-${artifact.path}`}
                  path={artifact.path}
                  label={artifact.label}
                />
              ),
            )}
        </div>
      ) : null}
      {artifactError ? (
        <div className="local-artifact-error" role="alert">
          {artifactError}
        </div>
      ) : null}
    </>
  );
}
