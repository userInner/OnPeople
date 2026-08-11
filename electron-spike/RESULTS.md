# Electron WebContentsView Spike Results

Measured on 2026-08-11 on Apple Silicon using the packaged arm64 app. The
renderer loaded the existing React UI, the Rust sidecar used JSONL stdio, and
one isolated `WebContentsView` navigated and reloaded `example.com` during the
stability probe.

## Architecture verified

- React uses the existing `DesktopApiClient`.
- Electron forwards the exact `DesktopRequest` envelope to the Rust sidecar.
- The sidecar delegates every request to `DesktopDispatcher`/`CoreRuntime`.
- `DesktopResponse` and live `DesktopEvent` messages share one ordered JSONL
  connection.
- stdio is the default transport; `--socket` provides the same protocol over a
  Unix Socket.
- The browser uses `WebContentsView`, not the deprecated Electron `<webview>`
  tag. It has an isolated persistent partition, sandboxing, denied permissions,
  safe navigation, native bounds synchronization, and crash recovery.

## Measurements

| Metric                           | WebContentsView spike |       Gate / baseline | Result   |
| -------------------------------- | --------------------: | --------------------: | -------- |
| ZIP archive                      |             257.7 MiB |        Tauri ≈303 MiB | Pass     |
| Installed app                    |             709.5 MiB |        Tauri ≈731 MiB | Pass     |
| App ready                        |               61.2 ms |         Informational | —        |
| Renderer ready                   |              458.6 ms |             ≤1,500 ms | Pass     |
| Electron working set after probe |             592.2 MiB |         Informational | —        |
| Rust sidecar RSS                 |              12.5 MiB |         Informational | —        |
| Total steady working set         |             604.7 MiB |            ≤526.4 MiB | **Fail** |
| Stability                        | 30 cycles, 0 failures | 30 cycles, 0 failures | Pass     |
| Browser/main crashes             |                 0 / 0 |                 0 / 0 | Pass     |
| Rust restarts                    |                     0 |                     0 | Pass     |

The total working set is 37.8% above the 438.7 MiB Tauri/CEF one-browser
baseline, exceeding the allowed 20% increase. `WebContentsView` is operationally
simpler and remained stable, but it does not meet the migration memory gate.

## Decision

Do not migrate the production desktop shell. Keep this branch as a validated
adapter and browser experiment; production remains on Tauri. Any next Electron
experiment must target Chromium process/renderer reuse or a materially lower
memory budget before reconsidering migration.
