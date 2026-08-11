# OnPeople Desktop API

The Desktop API is the stable boundary between the React application and the
Rust runtime. React components must not depend directly on a desktop shell.

```text
React -> DesktopApiClient -> shell transport -> DesktopDispatcher -> CoreRuntime
```

Tauri currently calls `DesktopDispatcher` in process through the
`desktop_request` command. A future Electron adapter can send the same
`DesktopRequest` envelope to a Rust sidecar over JSONL stdio or a local socket.

## Compatibility rules

- Every request and response carries `protocolVersion` and `requestId`.
- Stable method names use domain notation such as `runtime.snapshot` and
  `thread.list`; transport-specific names are not part of the public API.
- Rust owns request, response, error, and event DTOs and exports TypeScript
  bindings through `npm run bindings`.
- A long-running operation must return a task identifier instead of keeping a
  request open. Runtime events are already ordered; task snapshots and replay
  will be introduced before long-running commands move to this API.
- New shell-specific behavior belongs behind an adapter capability, not in
  `CoreRuntime`.

## First migrated methods

- `system.capabilities`
- `runtime.status`
- `runtime.start`
- `runtime.stop`
- `runtime.snapshot`
- `runtime.diagnostics`
- `preferences.get`
- `preferences.save`
- `thread.list`
- `scheduler.get`

Legacy Tauri commands remain registered during the transition so releases can
be rolled back without changing stored data or the existing browser host.

## Ordered events

Tauri publishes `desktop:event` using `DesktopEvent`. The adapter preserves the
sequence allocated by `CoreRuntime`; it must never allocate a second sequence
for agent or runtime events. Legacy event names remain available while React
consumers move to `DesktopApiClient.subscribe`.
