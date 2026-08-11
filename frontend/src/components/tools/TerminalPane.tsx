import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import {
  ClipboardPaste,
  Copy,
  Eraser,
  MousePointer2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { errorMessage } from "../../lib/errors";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { IconButton } from "../IconButton";

interface TerminalPaneProps {
  command?: string | null;
  onCommandSent?: () => void;
}

interface TerminalTab {
  id: string;
  label: string;
  processId: string | null;
  exited: boolean;
  error: string | null;
}

interface TerminalSessionProps {
  tabId: string;
  cwd: string;
  active: boolean;
  command: string | null;
  onCommandSent?: () => void;
  onReady: (tabId: string, processId: string, label: string) => void;
  onExit: (tabId: string) => void;
  onError: (tabId: string, message: string | null) => void;
}

export function TerminalPane({ command, onCommandSent }: TerminalPaneProps) {
  const initialId = useId();
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [
    createTerminalTab(initialId),
  ]);
  const [activeId, setActiveId] = useState(initialId);
  const cwd = useWorkbenchStore((state) => {
    const thread = state.threadList.threads.find(
      (item) => item.id === state.selectedThreadId,
    );
    return thread?.cwd ?? thread?.projectPath ?? state.draftCwd ?? "";
  });

  const addTerminal = () => {
    const tab = createTerminalTab();
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  };

  const closeTerminal = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (tabs.length === 1) {
      const replacement = createTerminalTab();
      setTabs([replacement]);
      setActiveId(replacement.id);
      return;
    }
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (activeId === id) {
      const nextActive = next[Math.min(index, next.length - 1)];
      if (nextActive) setActiveId(nextActive.id);
    }
  };

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div className="terminal-pane">
      <div className="terminal-tabs" role="tablist" aria-label="终端标签">
        {tabs.map((tab, index) => (
          <div className="terminal-tab-item" key={tab.id}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              aria-label={tab.label || `Terminal ${index + 1}`}
              className={`terminal-tab ${tab.id === activeId ? "is-active" : ""}`}
              onClick={() => setActiveId(tab.id)}
            >
              <span>{tab.label || `Terminal ${index + 1}`}</span>
              {tab.exited ? <small>已退出</small> : null}
            </button>
            <IconButton
              icon={X}
              label={`关闭 ${tab.label || `Terminal ${index + 1}`}`}
              className="terminal-tab-close"
              onClick={() => closeTerminal(tab.id)}
            />
          </div>
        ))}
        <IconButton icon={Plus} label="新建终端" onClick={addTerminal} />
        <span className="tool-spacer" />
        <IconButton
          icon={Trash2}
          label="关闭当前终端"
          disabled={!activeTab}
          onClick={() => {
            if (activeTab) closeTerminal(activeTab.id);
          }}
        />
      </div>
      {activeTab?.error ? (
        <div className="tool-error">{activeTab.error}</div>
      ) : null}
      <div className="terminal-sessions">
        {tabs.map((tab) => (
          <TerminalSession
            key={tab.id}
            tabId={tab.id}
            cwd={cwd}
            active={tab.id === activeId}
            command={tab.id === activeId ? (command ?? null) : null}
            {...(onCommandSent ? { onCommandSent } : {})}
            onReady={(tabId, processId, label) =>
              setTabs((current) =>
                current.map((item) =>
                  item.id === tabId
                    ? { ...item, processId, label, exited: false, error: null }
                    : item,
                ),
              )
            }
            onExit={(tabId) =>
              setTabs((current) =>
                current.map((item) =>
                  item.id === tabId ? { ...item, exited: true } : item,
                ),
              )
            }
            onError={(tabId, error) =>
              setTabs((current) =>
                current.map((item) =>
                  item.id === tabId ? { ...item, error } : item,
                ),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function TerminalSession({
  tabId,
  cwd,
  active,
  command,
  onCommandSent,
  onReady,
  onExit,
  onError,
}: TerminalSessionProps) {
  const pane = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const processIdRef = useRef<string | null>(null);
  const pendingCommandRef = useRef<string | null>(null);
  const callbacks = useRef({ onCommandSent, onReady, onExit, onError });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);

  useEffect(() => {
    callbacks.current = { onCommandSent, onReady, onExit, onError };
  }, [onCommandSent, onError, onExit, onReady]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      fitRef.current?.fit();
      const processId = processIdRef.current;
      const terminal = terminalRef.current;
      if (processId && terminal) {
        void desktopClient.resizeTerminal(
          processId,
          terminal.cols,
          terminal.rows,
        );
        terminal.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!command) return;
    pendingCommandRef.current = command;
    const processId = processIdRef.current;
    if (!processId) return;
    pendingCommandRef.current = null;
    void desktopClient
      .writeTerminal(processId, terminalCommand(command))
      .then(() => callbacks.current.onCommandSent?.())
      .catch((cause) => {
        pendingCommandRef.current = command;
        callbacks.current.onError(tabId, errorMessage(cause));
      });
  }, [command, tabId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".terminal-context-menu")
      ) {
        return;
      }
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const element = host.current;
    if (!element || !cwd) return;
    const terminal = new Terminal({
      cursorBlink: true,
      allowProposedApi: false,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 10_000,
      theme: {
        background: "#ffffff",
        foreground: "#242824",
        cursor: "#242824",
        selectionBackground: "#d9ded9",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(element);
    fit.fit();
    fitRef.current = fit;
    terminalRef.current = terminal;
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      const isMac = /mac|iphone|ipad/i.test(navigator.platform);
      const commandModifier = isMac ? event.metaKey : event.ctrlKey;
      if (commandModifier && key === "c" && terminal.hasSelection()) {
        void desktopClient.copyText(terminal.getSelection());
        return false;
      }
      if (
        (isMac && event.metaKey && key === "v") ||
        (!isMac && event.ctrlKey && event.shiftKey && key === "v")
      ) {
        const processId = processIdRef.current;
        if (processId) {
          void desktopClient
            .readText()
            .then((value) => desktopClient.writeTerminal(processId, value))
            .catch((cause) =>
              callbacks.current.onError(tabId, errorMessage(cause)),
            );
        }
        return false;
      }
      if (
        (isMac && event.metaKey && key === "a") ||
        (!isMac && event.ctrlKey && event.shiftKey && key === "a")
      ) {
        terminal.selectAll();
        return false;
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && key === "l") {
        terminal.clear();
        event.stopPropagation();
        return false;
      }
      return true;
    });

    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    void (async () => {
      // Subscribe before spawning the shell. The PTY can emit its first prompt
      // immediately, so listener setup after start would create a race.
      let processId: string | null = null;
      const earlyOutput: Array<{ processId: string; data: string }> = [];
      try {
        unlistenOutput = await desktopClient.onTerminalOutput((event) => {
          if (event.processId === processId) terminal.write(event.data);
          else if (!processId) earlyOutput.push(event);
        });
        unlistenExit = await desktopClient.onTerminalExit((event) => {
          if (event.processId !== processId) return;
          processIdRef.current = null;
          terminal.writeln(
            `\r\n[process exited${event.code === null ? "" : `: ${event.code}`}]`,
          );
          callbacks.current.onExit(tabId);
        });
        const session = await desktopClient.startTerminal({
          cwd,
          cols: terminal.cols,
          rows: terminal.rows,
          windowLabel: "main",
        });
        if (disposed) {
          await desktopClient.terminateTerminal(session.processId);
          return;
        }
        processId = session.processId;
        processIdRef.current = session.processId;
        for (const event of earlyOutput) {
          if (event.processId === session.processId) terminal.write(event.data);
        }
        const label = session.shell.split(/[\\/]/).at(-1) ?? "zsh";
        callbacks.current.onReady(tabId, session.processId, label);
        terminal.onData(
          (data) =>
            void desktopClient
              .writeTerminal(session.processId, data)
              .catch((cause) =>
                callbacks.current.onError(tabId, errorMessage(cause)),
              ),
        );
        resizeObserver = new ResizeObserver(() => {
          if (!element.offsetParent) return;
          fit.fit();
          void desktopClient.resizeTerminal(
            session.processId,
            terminal.cols,
            terminal.rows,
          );
        });
        resizeObserver.observe(element);
        await desktopClient.readyTerminal(session.processId);
        const pendingCommand = pendingCommandRef.current;
        if (pendingCommand) {
          pendingCommandRef.current = null;
          try {
            await desktopClient.writeTerminal(
              session.processId,
              terminalCommand(pendingCommand),
            );
            callbacks.current.onCommandSent?.();
          } catch (cause) {
            pendingCommandRef.current = pendingCommand;
            throw cause;
          }
        }
      } catch (cause) {
        unlistenOutput?.();
        unlistenExit?.();
        callbacks.current.onError(tabId, errorMessage(cause));
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      unlistenOutput?.();
      unlistenExit?.();
      const processId = processIdRef.current;
      processIdRef.current = null;
      if (processId) {
        void desktopClient
          .setTerminalFocused(false, processId)
          .catch(() => undefined);
        void desktopClient.terminateTerminal(processId).catch(() => undefined);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, tabId]);

  return (
    <div
      className="terminal-session"
      ref={pane}
      role="tabpanel"
      hidden={!active}
    >
      <div
        className="terminal-host"
        ref={host}
        tabIndex={0}
        onFocus={() => {
          const processId = processIdRef.current;
          if (processId) void desktopClient.setTerminalFocused(true, processId);
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          const processId = processIdRef.current;
          if (processId)
            void desktopClient.setTerminalFocused(false, processId);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const processId = processIdRef.current;
          const bounds = pane.current?.getBoundingClientRect();
          if (!processId || !bounds) return;
          const hasSelection = Boolean(terminalRef.current?.hasSelection());
          setContextMenu({
            x: Math.min(event.clientX - bounds.left, bounds.width - 190),
            y: Math.min(event.clientY - bounds.top, bounds.height - 190),
            hasSelection,
          });
          void desktopClient.showTerminalContextMenu({
            processId,
            x: event.clientX,
            y: event.clientY,
            hasSelection,
          });
        }}
      />
      {contextMenu ? (
        <div
          className="terminal-context-menu"
          role="menu"
          aria-label="终端操作"
          style={{
            left: Math.max(6, contextMenu.x),
            top: Math.max(6, contextMenu.y),
          }}
        >
          <TerminalMenuButton
            icon={Copy}
            label="复制"
            disabled={!contextMenu.hasSelection}
            onClick={() => {
              const selection = terminalRef.current?.getSelection();
              if (selection) void desktopClient.copyText(selection);
              setContextMenu(null);
            }}
          />
          <TerminalMenuButton
            icon={ClipboardPaste}
            label="粘贴"
            onClick={() => {
              const processId = processIdRef.current;
              if (processId) {
                void desktopClient
                  .readText()
                  .then((value) =>
                    desktopClient.writeTerminal(processId, value),
                  )
                  .catch((cause) =>
                    callbacks.current.onError(tabId, errorMessage(cause)),
                  );
              }
              setContextMenu(null);
            }}
          />
          <TerminalMenuButton
            icon={MousePointer2}
            label="全选"
            onClick={() => {
              terminalRef.current?.selectAll();
              setContextMenu(null);
            }}
          />
          <TerminalMenuButton
            icon={Eraser}
            label="清空终端"
            onClick={() => {
              terminalRef.current?.clear();
              setContextMenu(null);
            }}
          />
          <TerminalMenuButton
            icon={Trash2}
            label="终止进程"
            danger
            onClick={() => {
              const processId = processIdRef.current;
              if (processId) void desktopClient.terminateTerminal(processId);
              setContextMenu(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function createTerminalTab(id: string = crypto.randomUUID()): TerminalTab {
  return {
    id,
    // Codex opens the first shell as zsh immediately; don't flash a generic
    // "Terminal" label while the PTY handshake is still in flight.
    label: "zsh",
    processId: null,
    exited: false,
    error: null,
  };
}

function terminalCommand(command: string): string {
  const value = command.replace(/[\r\n]+$/u, "");
  return `${value}\r`;
}

function TerminalMenuButton({
  icon: Icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? "is-danger" : ""}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={13} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
