type BrowserRect = Pick<
  DOMRectReadOnly,
  "left" | "top" | "right" | "bottom" | "width" | "height"
>;

export function constrainedBrowserSurfaceBounds(
  surfaceRect: BrowserRect,
  paneRect: BrowserRect,
  toolbarRect: BrowserRect,
) {
  // The browser page is a native surface placed above the React WebView. Clamp
  // it to the live browser chrome so a stale surface measurement can never
  // cover tabs or navigation while the utility pane is expanding/collapsing.
  const left = Math.max(paneRect.left, toolbarRect.left);
  const right = Math.min(paneRect.right, toolbarRect.right);
  const top = Math.max(surfaceRect.top, toolbarRect.bottom);
  const bottom = Math.min(surfaceRect.bottom, paneRect.bottom);
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
}
