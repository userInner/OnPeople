import {
  AppWindow,
  BookOpen,
  BrainCircuit,
  ClipboardCheck,
  FileImage,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  Globe2,
  Lightbulb,
  ListChecks,
  Monitor,
  Puzzle,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** The one SVG icon vocabulary used by metadata-driven OnPeople UI. */
export type OnPeopleIconName =
  | "app"
  | "browser"
  | "clues"
  | "computer"
  | "constraints"
  | "deliverables"
  | "document"
  | "files"
  | "image"
  | "mcp"
  | "model"
  | "pdf"
  | "plugin"
  | "presentation"
  | "research"
  | "scope"
  | "site"
  | "skills"
  | "spreadsheet"
  | "template"
  | "verification"
  | "visualize"
  | "workspace";

export const ON_PEOPLE_ICONS: Record<OnPeopleIconName, LucideIcon> = {
  app: AppWindow,
  browser: Globe2,
  clues: Lightbulb,
  computer: Monitor,
  constraints: ShieldCheck,
  deliverables: ClipboardCheck,
  document: FileText,
  files: Files,
  image: FileImage,
  mcp: Wrench,
  model: BrainCircuit,
  pdf: BookOpen,
  plugin: Puzzle,
  presentation: Presentation,
  research: Search,
  scope: ListChecks,
  site: AppWindow,
  skills: Sparkles,
  spreadsheet: FileSpreadsheet,
  template: FileText,
  verification: ClipboardCheck,
  visualize: Sparkles,
  workspace: Folder,
};

const ALIASES: Record<string, OnPeopleIconName> = {
  app: "app",
  application: "app",
  browser: "browser",
  "\u{1f310}": "browser",
  "\u{1f30d}": "browser",
  clues: "clues",
  clue: "clues",
  "\u{1f4a1}": "clues",
  computer: "computer",
  desktop: "computer",
  "\u{1f4bb}": "computer",
  "\u{1f5a5}": "computer",
  constraints: "constraints",
  boundary: "constraints",
  security: "constraints",
  "\u{1f512}": "constraints",
  "\u{1f6e1}": "constraints",
  deliverables: "deliverables",
  delivery: "deliverables",
  "\u{1f4cb}": "deliverables",
  document: "document",
  docs: "document",
  file: "document",
  "\u{1f4c4}": "document",
  "\u{1f4dd}": "document",
  "\u{1f4d1}": "document",
  files: "files",
  folder: "workspace",
  "\u{1f4c1}": "workspace",
  image: "image",
  "\u{1f5bc}": "image",
  "\u{1f3a8}": "image",
  mcp: "mcp",
  tools: "mcp",
  wrench: "mcp",
  "\u{1f9f0}": "mcp",
  "\u{1f527}": "mcp",
  model: "model",
  ai: "model",
  "\u{1f9e0}": "model",
  pdf: "pdf",
  book: "pdf",
  "\u{1f4d5}": "pdf",
  "\u{1f4da}": "pdf",
  plugin: "plugin",
  plugins: "plugin",
  extension: "plugin",
  "\u{1f9e9}": "plugin",
  "\u{1f50c}": "plugin",
  presentation: "presentation",
  slides: "presentation",
  "\u{1f39e}": "presentation",
  "\u{1f3a5}": "presentation",
  research: "research",
  search: "research",
  "\u{1f50d}": "research",
  "\u{1f50e}": "research",
  scope: "scope",
  responsibility: "scope",
  site: "site",
  web: "site",
  skills: "skills",
  skill: "skills",
  "\u{2728}": "skills",
  "\u{1f4ab}": "skills",
  spreadsheet: "spreadsheet",
  spreadsheets: "spreadsheet",
  sheet: "spreadsheet",
  "\u{1f4ca}": "spreadsheet",
  "\u{1f4c8}": "spreadsheet",
  template: "template",
  verification: "verification",
  acceptance: "verification",
  "\u{2705}": "verification",
  visualize: "visualize",
  visualization: "visualize",
  "\u{1f52d}": "visualize",
  workspace: "workspace",
};

function normalizeIconText(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLocaleLowerCase()
        .replace(/[_\s-]+/g, " ")
    : "";
}

/** Resolve a manifest icon without returning a platform emoji glyph. */
export function resolveOnPeopleIcon(
  value: unknown,
  fallback: OnPeopleIconName = "plugin",
): OnPeopleIconName {
  const normalized = normalizeIconText(value);
  if (!normalized) return fallback;
  const direct = ALIASES[normalized];
  if (direct) return direct;

  // Manifests may contain labels such as "PDF + icon" or "document icon".
  const tokens = normalized.split(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/u);
  for (const token of tokens) {
    const icon = ALIASES[token];
    if (icon) return icon;
  }
  return fallback;
}
