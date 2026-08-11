import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { IconButton } from "../IconButton";

interface ElectronBrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  crash: string | null;
  restartCount: number;
}

const EMPTY_STATE: ElectronBrowserState = {
  url: "about:blank",
  title: "新标签页",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  crash: null,
  restartCount: 0,
};

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "about:blank";
  if (/^(?:https?|about):/i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/?:#]|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function browserCommand<T>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const bridge = window.onpeopleElectron;
  if (!bridge) return Promise.reject(new Error("Electron 浏览器桥接不可用"));
  return bridge.browser(command, payload) as Promise<T>;
}

export function ElectronBrowserPane() {
  const anchor = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const animationFrame = useRef<number | null>(null);
  const crashed = useRef(false);
  const [address, setAddress] = useState("");
  const [state, setState] = useState<ElectronBrowserState>(EMPTY_STATE);

  const syncBounds = useCallback(() => {
    if (animationFrame.current !== null) return;
    animationFrame.current = window.requestAnimationFrame(() => {
      animationFrame.current = null;
      const element = anchor.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const visible =
        !crashed.current &&
        rect.width > 1 &&
        rect.height > 1 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      void browserCommand<ElectronBrowserState>("bounds", {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        visible,
      });
    });
  }, []);

  useEffect(() => {
    const bridge = window.onpeopleElectron;
    if (!bridge) return;
    const unsubscribe = bridge.on("electron-browser", (payload) => {
      const next = payload as ElectronBrowserState;
      crashed.current = Boolean(next.crash);
      setState(next);
      setAddress(next.url === "about:blank" ? "" : next.url);
      syncBounds();
    });
    void browserCommand<ElectronBrowserState>("state").then((next) => {
      setState(next);
      crashed.current = Boolean(next.crash);
      setAddress(next.url === "about:blank" ? "" : next.url);
      syncBounds();
    });
    return unsubscribe;
  }, [syncBounds]);

  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const observer = new ResizeObserver(syncBounds);
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);
    syncBounds();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", syncBounds, true);
      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
      }
      void browserCommand("close");
    };
  }, [syncBounds]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        addressInput.current?.focus();
        addressInput.current?.select();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void browserCommand("reload");
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  const navigate = () => {
    const url = normalizeAddress(address);
    setAddress(url === "about:blank" ? "" : url);
    void browserCommand("navigate", { url });
  };

  return (
    <div className="browser-pane electron-browser-pane">
      <div className="browser-tab-strip">
        <div className="browser-tab-scroll" role="tablist">
          <div className="browser-tab is-active">
            <button
              className="browser-tab-main"
              type="button"
              role="tab"
              aria-selected="true"
            >
              {state.loading ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : (
                <Globe2 size={14} aria-hidden="true" />
              )}
              <span>{state.title}</span>
            </button>
            <button
              className="browser-tab-close"
              type="button"
              aria-label="关闭当前页面"
              onClick={() =>
                void browserCommand("navigate", { url: "about:blank" })
              }
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        <span
          className={`browser-control-state ${state.loading ? "is-busy" : "is-user"}`}
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {state.loading
            ? "页面加载中"
            : state.restartCount > 0
              ? `已恢复 ${state.restartCount} 次`
              : "WebContentsView"}
        </span>
      </div>
      <div className="browser-toolbar">
        <IconButton
          icon={ArrowLeft}
          label="后退"
          disabled={!state.canGoBack}
          onClick={() => void browserCommand("back")}
        />
        <IconButton
          icon={ArrowRight}
          label="前进"
          disabled={!state.canGoForward}
          onClick={() => void browserCommand("forward")}
        />
        <IconButton
          icon={RefreshCw}
          label="重新加载"
          onClick={() => void browserCommand("reload")}
        />
        <form
          className="browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            navigate();
          }}
        >
          {state.url.startsWith("https://") ? (
            <ShieldCheck size={13} aria-hidden="true" />
          ) : (
            <Globe2 size={13} aria-hidden="true" />
          )}
          <input
            ref={addressInput}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-label="浏览器地址"
            placeholder="搜索或输入网址"
          />
        </form>
        <IconButton
          icon={ExternalLink}
          label="在系统浏览器中打开"
          disabled={state.url === "about:blank"}
          onClick={() => void desktopClient.openExternalUrl(state.url)}
        />
      </div>
      <div className="browser-surface electron-browser-surface">
        <div ref={anchor} className="electron-browser-anchor" />
        {state.crash ? (
          <div className="browser-host-status browser-host-status-error">
            <strong>{state.crash}</strong>
            <span>OnPeople 正在自动恢复当前页面。</span>
            <button type="button" onClick={() => void browserCommand("reload")}>
              立即重新加载
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
