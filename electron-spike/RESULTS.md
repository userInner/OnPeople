# Electron production shell

Electron loads the existing React workbench and communicates with the Rust
Desktop host through the versioned Desktop API over JSONL stdio or Unix Socket.
Tauri remains available through `tauri:start`, `tauri:dev`, and `tauri:build`
as the rollback shell.

## Built-in browser

The browser is a separate Electron host capability rather than CoreRuntime
business logic. React owns tabs, chrome, inspectors, and the resident-tab
budget. The main process owns the persistent `persist:onpeople-browser`
session, guest security policy, navigation, CDP snapshots, downloads, popups,
crash recovery, and native shell integration. Guest pages run in sandboxed
`<webview>` instances with context isolation and a narrow preload.

Only the active tab and the two most recently used tabs remain resident.
Inactive guests are audio-muted and background-throttled; older guests are
destroyed while their URL and persistent session survive. This avoids the
native-view z-order and resize failures from the removed CEF/WebContentsView
implementation.

Run `npm run electron:browser:acceptance` after `npm run electron:rust:build`
and `npm run build`. It verifies a non-zero page viewport, DOM and visual
snapshots, session cookies, upload, download, popup handling, crash recovery,
the three-tab resident budget, 30 create/navigate/destroy cycles, Rust host
stability, renderer stability, and bounded memory growth. `npm run
electron:measure` records renderer readiness, process memory, package size,
renderer crashes, and Rust host restarts.
