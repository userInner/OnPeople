import path from "node:path";
import { fileURLToPath } from "node:url";

export function isAllowedDesktopNavigation({
  targetUrl,
  developmentUrl,
  packagedEntryPath,
}) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (developmentUrl) {
    try {
      return target.origin === new URL(developmentUrl).origin;
    } catch {
      return false;
    }
  }

  if (target.protocol !== "file:") return false;
  try {
    return (
      path.resolve(fileURLToPath(target)) === path.resolve(packagedEntryPath)
    );
  } catch {
    return false;
  }
}
