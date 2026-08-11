# Electron production shell

Electron loads the existing React workbench and communicates with the Rust
Desktop host through the versioned Desktop API over JSONL stdio or Unix Socket.
The production shell contains no embedded browser surface, Chromium tab
controller, profile importer, or browser automation adapter. HTTP and HTTPS
links open in the user's system browser.

The current production contract exposes 146 unique Desktop methods. Tauri
remains available through `tauri:start`, `tauri:dev`, and `tauri:build` as
the rollback shell. `npm run electron:measure` records renderer readiness,
process memory, package size, renderer crashes, and Rust host restarts.
