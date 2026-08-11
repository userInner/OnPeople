# Electron WebContentsView Production Gate

Measured on 2026-08-11 on Apple Silicon with the packaged arm64 app. The
production Electron window loaded the complete existing React workbench. The
Rust sidecar exposed the current 154-method Desktop API over JSONL stdio, while
the Electron main-process adapter implemented the browser and native-shell
ports.

## Architecture

- React keeps one `DesktopApiClient`; it has no Electron-specific business API.
- Core/runtime requests use the versioned `DesktopRequest` and
  `DesktopResponse` envelopes over the Rust sidecar.
- The sidecar dispatches concurrent requests so a long-running task cannot
  block status, queue, steering, approval, or input requests.
- Browser and OS-shell methods retain the same Desktop API contract and are
  handled by the Electron adapter.
- The browser is a sandboxed `WebContentsView` with a persistent partition.
  Views are created on demand, hidden and audio-muted when suspended, and
  destroyed after an idle deadline. Metadata remains so a destroyed tab can be
  restored without losing its URL or login session.
- Tauri remains available through `tauri:start`, `tauri:dev`, and
  `tauri:build`. The permanent rollback branch is `tauri-production`, with tag
  `tauri-production-20260811`.

## Packaged measurements

Measured locally on Apple Silicon with `npm run electron:measure` after a
fresh `npm run electron:package` (2026-08-11). Values below include the Rust
Desktop host process and are the arm64 packaged app.

| Metric | Electron production | Gate / baseline | Result |
| --- | ---: | ---: | --- |
| ZIP archive | 270.7 MiB | Tauri ≈303 MiB | Pass |
| Installed app | 701.8 MiB | Tauri ≈731 MiB | Pass |
| Renderer ready | 232.5 ms | ≤1,500 ms | Pass |
| Idle working set | 463.6 MiB | ≤526.4 MiB | Pass |
| Browser-open working set | 574.8 MiB | ≤604.7 MiB previous Electron | Pass |
| Browser-destroyed working set | 487.4 MiB | ≥60% increment reclaimed | Pass (78.6%) |
| Desktop API discovery | 154 unique methods | 154 | Pass |
| Lifecycle | 30 cycles, 0 failures | 30 / 0 | Pass |
| Login/download/upload/popup | 4 of 4 | 4 of 4 | Pass |
| Injected renderer crash | recovered, 0 unrecovered | recovered | Pass |
| Main-window crashes / Rust restarts | 0 / 0 | 0 / 0 | Pass |

## Decision

All production gates passed. Electron is the default desktop shell. Tauri is
kept intact as a permanent rollback target and is not deleted or overwritten.
