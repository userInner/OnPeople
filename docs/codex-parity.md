# Codex desktop parity contract

This document is the product acceptance contract for the OnPeople desktop UI.
The implementation is independent, but the visible hierarchy, interaction
model, task semantics, and recovery behavior should be familiar to a Codex
desktop user.

## Principles

1. Keep the task as the center of the application. Browser, terminal, review,
   files, and details open beside or below the task instead of replacing it.
2. Show a compact, truthful execution trace first. Raw protocol payloads are
   available only in an explicit technical-details disclosure.
3. Preserve user position and input. Streaming updates never reorder messages,
   steal scrolling, clear the composer, or hide durable history.
4. Every long-running action has a visible state, elapsed time, cancellation,
   recovery, and a durable receipt.
5. Native capabilities are reached through the stable Desktop API. Tauri stays
   a supported fallback shell while Electron is evaluated and shipped.

## Surface matrix

| Surface | Codex-compatible behavior | OnPeople implementation | Acceptance |
| --- | --- | --- | --- |
| App shell | Collapsible project rail, thread header, task canvas, optional side and bottom panels | `App`, `Sidebar`, `UtilityPane` | Layout survives resize/restart and every control has an accessible name |
| Thread navigation | Durable project/thread grouping, history navigation, pin/archive/rename/fork actions | `Sidebar`, `TaskMenu` | No blank flash; selected thread and scroll position remain stable |
| Composer | Agent/plan/goal modes, model and effort, local/cloud/run location, access policy, attachments and queued steering | `Composer` | Keyboard-first; submit/queue/cancel states never conflict |
| Task status | One compact running/completed header with elapsed time and current phase | `Timeline`, turn timing store | Timer is monotonic; completion freezes the final duration |
| Activity trace | Reasoning, commands, tools, files, approvals, input and errors use semantic rows with expandable receipts | `Timeline` | No raw MCP envelope in the default view; Unicode and exit metadata are preserved |
| Side panel | Task-scoped tabs for browser, review/diff, files/details and output | `UtilityPane` | Opening a browser tool keeps the conversation visible and selects the Browser tab |
| Bottom panel | Persistent terminal with resize, reopen and process continuity | `TerminalPane` | Output/exit events survive panel hide/show and task switching |
| Browser | Main-process Chromium view, tabs, navigation, login/session, upload/download, popups, inspection, crash recovery | `BrowserWorkspace`, `ElectronBrowserController`, `WebContentsView` | Agent and user share one native route/session; React never mounts a second `<webview>` and no opaque connection spinner is shown |
| Files and diff | Clickable local artifacts, text/image/PDF/media preview, per-file diff and summary | `FilesPane`, `LocalArtifactPreview`, `GitPane` | Local links open in-app first; binary fallback is explicit |
| Git and review | Status, hunks, commit/push, PR preparation and review submission | `GitPane`, Desktop API | Mutations require clear scope and report the resulting repository state |
| Approval and input | Inline approval/request cards anchored at the correct chronological position | `Timeline`, task interaction API | Resolution is idempotent and remains correct after reconnect |
| Recovery | Event replay, snapshot fallback, reconnect, crash and timeout recovery | Core runtime event history, desktop bridge | No sequence gaps; second recovery signals are not dropped |
| Settings and extensions | Models, policy, plugins, MCP, hooks, account, usage and environment settings | `SettingsCenter`, `ManagementCenter` | Changes are typed, validated, and reflected without app restart where possible |

## Delivery gates

- Each tranche includes unit/contract tests and a production frontend build.
- Desktop behavior is verified in the packaged application, not only jsdom.
- Browser and task lifecycle changes run a 30-cycle create/use/close/recover test.
- Performance is recorded for cold start, idle memory, active task memory, and
  browser-open memory before deciding whether Electron replaces Tauri.
- The Tauri branch and last known-good tag are never deleted or overwritten.
