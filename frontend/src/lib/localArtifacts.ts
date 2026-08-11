export interface LocalArtifactReference {
  id: string;
  label: string;
  path: string;
  image: boolean;
  card: boolean;
}

export function prepareLocalArtifactMarkdown(text: string): {
  markdown: string;
  artifacts: LocalArtifactReference[];
} {
  const artifacts: LocalArtifactReference[] = [];
  const markdown = text.replace(
    /!?\[([^\]]*)\]\(\s*(?:<([^>]+)>|((?:sandbox:|file:\/\/|\/)[^)\s]+))(?:\s+["'][^"']*["'])?\s*\)/gi,
    (_match, rawLabel: string, angleUrl: string, bareUrl: string) => {
      const rawUrl = angleUrl || bareUrl;
      const path = localArtifactPath(rawUrl);
      const label = rawLabel.trim() || path.split(/[\\/]/).at(-1) || "本地文件";
      const id = `onpeople-local-artifact-${artifacts.length}`;
      const image = /\.(?:png|jpe?g|webp)$/i.test(path);
      artifacts.push({
        id,
        label,
        path,
        image,
        card:
          image ||
          /\.pdf$/i.test(path) ||
          /^(?:sandbox:|file:\/\/)/i.test(rawUrl),
      });
      return `[${label}](#${id})`;
    },
  );
  return { markdown, artifacts };
}

function localArtifactPath(value: string): string {
  const raw = value.startsWith("sandbox:")
    ? value.slice("sandbox:".length)
    : value.startsWith("file://")
      ? value.slice("file://".length)
      : value;
  try {
    return stripSourceLocation(decodeURIComponent(raw));
  } catch {
    return stripSourceLocation(raw);
  }
}

function stripSourceLocation(value: string): string {
  return value.startsWith("/") ? value.replace(/:\d+(?::\d+)?$/, "") : value;
}
