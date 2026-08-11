import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { RootApp } from "./App";
import { useWorkbenchStore } from "./store/workbenchStore";
import "./styles.css";
import "./codex-parity.css";

declare global {
  interface Window {
    onpeopleElectron?: {
      isElectron: true;
      invoke: (
        command: string,
        args?: Record<string, unknown>,
      ) => Promise<unknown>;
      on: (event: string, handler: (payload: unknown) => void) => () => void;
      browser: (
        command: string,
        payload?: Record<string, unknown>,
      ) => Promise<unknown>;
      metrics: () => Promise<Record<string, unknown>>;
    };
    __ONPEOPLE_DEV__?: {
      setWorkbenchState: typeof useWorkbenchStore.setState;
      invoke?: (
        command: string,
        args: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  }
}

if (import.meta.env.DEV) {
  window.__ONPEOPLE_DEV__ = {
    setWorkbenchState: useWorkbenchStore.setState,
  };
}

const root = document.getElementById("root");
if (!root) throw new Error("OnPeople root element is missing");

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function BootFailure({ error }: { error: unknown }) {
  return (
    <main
      role="alert"
      style={{
        display: "grid",
        minHeight: "100%",
        placeItems: "center",
        padding: 32,
        background: "#f7f7f5",
        color: "#242422",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <section style={{ width: "min(680px, 100%)" }}>
        <h1 style={{ margin: "0 0 10px", fontSize: 20 }}>OnPeople 启动失败</h1>
        <p style={{ margin: "0 0 18px", color: "#666661" }}>
          桌面界面遇到了未处理的错误。请复制下面的信息用于诊断。
        </p>
        <pre
          style={{
            overflow: "auto",
            margin: 0,
            padding: 16,
            border: "1px solid #deded9",
            borderRadius: 10,
            background: "#fff",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {errorMessage(error)}
        </pre>
      </section>
    </main>
  );
}

export class BootErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("OnPeople render failed", error, info.componentStack);
  }

  render() {
    return this.state.error ? (
      <BootFailure error={this.state.error} />
    ) : (
      this.props.children
    );
  }
}

const reactRoot = createRoot(root);

window.addEventListener("unhandledrejection", (event) => {
  console.error("OnPeople unhandled rejection", event.reason);
  const interfaceMounted = Boolean(document.querySelector(".app-shell"));
  if (!interfaceMounted) reactRoot.render(<BootFailure error={event.reason} />);
});

try {
  reactRoot.render(
    <BootErrorBoundary>
      <StrictMode>
        <RootApp />
      </StrictMode>
    </BootErrorBoundary>,
  );
} catch (error) {
  reactRoot.render(<BootFailure error={error} />);
}

window.setTimeout(() => {
  const hasWorkbench = Boolean(document.querySelector(".app-shell"));
  if (!hasWorkbench && root.childElementCount === 0) {
    document.title = "OnPeople — 界面未挂载";
    reactRoot.render(
      <BootFailure error="React 未在启动时挂载任何界面内容。" />,
    );
  }
}, 2_000);
