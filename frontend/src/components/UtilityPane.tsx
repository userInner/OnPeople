import {
  Check,
  CircleDot,
  FileCode2,
  Files,
  GitBranch,
  Globe2,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  PanelBottom,
  PanelRightClose,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useWorkbenchStore } from "../store/workbenchStore";
import type { ToolView } from "../types";
import { IconButton } from "./IconButton";
import { BrowserWorkspace } from "./browser/BrowserWorkspace";
import { FilesPane } from "./tools/FilesPane";
import { GitPane } from "./tools/GitPane";
import { LocalArtifactPreview } from "./tools/LocalArtifactPreview";
import { ManagementCenter } from "./tools/ManagementCenter";

const views: Array<{ id: ToolView; label: string; icon: typeof CircleDot }> = [
  { id: "activity", label: "输出", icon: CircleDot },
  { id: "browser", label: "浏览器", icon: Globe2 },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "files", label: "文件", icon: Files },
  { id: "manage", label: "管理", icon: LayoutDashboard },
];

interface UtilityPaneProps {
  expanded: boolean;
  bottomPanelOpen: boolean;
  onToggleExpanded: () => void;
  onToggleBottomPanel: () => void;
}

export function UtilityPane({
  expanded,
  bottomPanelOpen,
  onToggleExpanded,
  onToggleBottomPanel,
}: UtilityPaneProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const toolView = useWorkbenchStore((state) => state.toolView);
  const localArtifactPreview = useWorkbenchStore(
    (state) => state.localArtifactPreview,
  );
  const setToolView = useWorkbenchStore((state) => state.setToolView);
  const setUtilityOpen = useWorkbenchStore((state) => state.setUtilityOpen);
  const currentView = views.find((view) => view.id === toolView) ?? views[0]!;
  const CurrentViewIcon = currentView.icon;

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <aside className={`utility-pane utility-${toolView}`} aria-label="工具舱">
      <div className="utility-tabs utility-toolbar">
        <div className="utility-view-switcher" ref={menuRef}>
          <div
            className="utility-active-tab"
            role="tab"
            aria-selected="true"
            aria-label={`当前侧面板：${currentView.label}`}
          >
            <CurrentViewIcon size={14} aria-hidden="true" />
            <span>{currentView.label}</span>
            {toolView !== "activity" ? (
              <button
                type="button"
                aria-label={`关闭${currentView.label}标签`}
                onClick={() => setToolView("activity")}
              >
                <X size={12} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <IconButton
            icon={Plus}
            label="新建侧面板标签"
            active={menuOpen}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          />
          {menuOpen ? (
            <div
              className="utility-view-menu"
              role="menu"
              aria-label="新建侧面板标签"
              data-native-surface-occluder="true"
            >
              {views.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={toolView === id}
                  className={`utility-view-option ${toolView === id ? "is-active" : ""}`}
                  key={id}
                  onClick={() => {
                    setToolView(id);
                    setMenuOpen(false);
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{label}</span>
                  {toolView === id ? (
                    <Check size={14} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <span className="tool-spacer" />
        <IconButton
          icon={expanded ? Minimize2 : Maximize2}
          label={expanded ? "退出展开面板" : "展开面板"}
          active={expanded}
          onClick={onToggleExpanded}
        />
        <IconButton
          icon={PanelBottom}
          label="切换底部面板显示"
          active={bottomPanelOpen}
          onClick={onToggleBottomPanel}
        />
        <IconButton
          icon={PanelRightClose}
          label="显示/隐藏工具舱"
          onClick={() => setUtilityOpen(false)}
        />
      </div>
      <div className="utility-frame">
        <div className="utility-content" role="tabpanel">
          {toolView === "activity" ? <ActivityPane /> : null}
          {toolView === "browser" ? (
            <BrowserWorkspace onBack={() => setToolView("activity")} />
          ) : null}
          {toolView === "git" ? <GitPane /> : null}
          {toolView === "files" ? (
            localArtifactPreview ? (
              <LocalArtifactPreview key={localArtifactPreview.id} />
            ) : (
              <FilesPane />
            )
          ) : null}
          {toolView === "manage" ? <ManagementCenter /> : null}
        </div>
      </div>
    </aside>
  );
}

function ActivityPane() {
  const timeline = useWorkbenchStore((state) => state.timeline);
  const setToolView = useWorkbenchStore((state) => state.setToolView);

  const processes = timeline
    .filter((item) => item.kind === "command")
    .slice(-2)
    .reverse();
  const sources = timeline
    .filter(
      (item) => Boolean(item.generatedImagePath) || item.kind === "file-change",
    )
    .flatMap((item) => {
      if (item.generatedImagePath) return [item.generatedImagePath];
      return item.text.split("\n").filter(Boolean);
    })
    .slice(-3)
    .reverse();

  return (
    <div className="codex-output-pane">
      <section className="codex-output-section codex-output-create">
        <header>
          <h2>输出</h2>
          <button type="button" aria-label="创建输出">
            <Plus size={17} aria-hidden="true" />
          </button>
        </header>
        <button type="button" onClick={() => setToolView("files")}>
          创建文件或站点
        </button>
      </section>

      <section className="codex-output-section">
        <h2>后台进程</h2>
        {processes.length > 0 ? (
          <div className="codex-output-list">
            {processes.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("onpeople:open-terminal"),
                  )
                }
                title={item.meta || item.text || item.title}
              >
                <SquareTerminal size={14} aria-hidden="true" />
                <span>
                  {processLabel(item.meta || item.text || item.title)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p>暂无后台进程</p>
        )}
      </section>

      <section className="codex-output-section codex-output-sources">
        <header>
          <h2>来源</h2>
          <button type="button" aria-label="添加来源">
            <Plus size={17} aria-hidden="true" />
          </button>
        </header>
        {sources.length > 0 ? (
          <div className="codex-output-list">
            {sources.map((source, index) => (
              <button
                type="button"
                key={`${source}-${index}`}
                onClick={() => setToolView("files")}
                title={source}
              >
                <FileCode2 size={14} aria-hidden="true" />
                <span>{fileLabel(source)}</span>
              </button>
            ))}
            <button type="button" onClick={() => setToolView("files")}>
              <Files size={14} aria-hidden="true" />
              <span>查看全部</span>
            </button>
          </div>
        ) : (
          <p>任务使用的文件会显示在这里</p>
        )}
      </section>
    </div>
  );
}

function processLabel(value: string | undefined) {
  const firstLine = value?.trim().split("\n")[0] ?? "终端进程";
  return firstLine.length > 38 ? `${firstLine.slice(0, 38)}…` : firstLine;
}

function fileLabel(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
