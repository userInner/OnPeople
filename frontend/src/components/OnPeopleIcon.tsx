import type { LucideProps } from "lucide-react";

import {
  ON_PEOPLE_ICONS,
  resolveOnPeopleIcon,
  type OnPeopleIconName,
} from "../lib/onPeopleIcons";

/**
 * Render a consistent rounded-outline SVG icon for all metadata-driven UI.
 * Unknown or emoji manifest values are normalized to a safe SVG fallback.
 */
export function OnPeopleIcon({
  name,
  fallback = "plugin",
  strokeWidth = 1.8,
  ...props
}: Omit<LucideProps, "name"> & {
  name: unknown;
  fallback?: OnPeopleIconName;
}) {
  const Icon = ON_PEOPLE_ICONS[resolveOnPeopleIcon(name, fallback)];
  return (
    <Icon
      {...props}
      strokeWidth={strokeWidth}
      aria-hidden={props["aria-hidden"] ?? true}
    />
  );
}
