# OnPeople Desktop API

The Desktop API is the stable boundary between the React application and the
Rust runtime. React components must not depend directly on a desktop shell.

```text
React -> DesktopApiClient -> shell transport -> DesktopDispatcher -> CoreRuntime
                                                    |
                                                    +-> DesktopHost port
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
  request open. Runtime events are ordered and retained in a bounded replay
  window; task snapshots remain the authority when a client falls behind it.
- New shell-specific behavior belongs behind an adapter capability, not in
  `CoreRuntime`.

## First migrated methods

- `system.capabilities`
- `runtime.status`
- `runtime.start`
- `runtime.stop`
- `runtime.snapshot`
- `runtime.diagnostics`
- `event.replay`
- `preferences.get`
- `preferences.save`
- `thread.list`
- `scheduler.get`
- `task.start`
- `task.cancel`
- `task.snapshot`
- `task.resume`
- `task.queue`
- `task.queue.delete`
- `task.steer`
- `task.queue.steer`
- `task.approval.resolve`
- `task.input.resolve`
- `browser.state`
- `browser.restart`
- `browser.command`
- `browser.surface.bounds`
- `browser.annotation.list`
- `browser.annotation.save`
- `browser.annotation.delete`
- `browser.action`
- `plugin.install`
- `plugin.uninstall`
- `plugin.industry.activate`
- `plugin.industry.deactivate`
- `plugin.mcp.reload`
- `plugin.catalog.sync`
- `connector.oauth.start`
- `connector.oauth.complete`
- `connector.disconnect`

Legacy Tauri commands remain registered during the transition so releases can
be rolled back without changing stored data or the existing browser host.

## Ordered events

Tauri publishes `desktop:event` using `DesktopEvent`. The adapter preserves the
sequence allocated by `CoreRuntime`; it must never allocate a second sequence
for agent or runtime events. Legacy event names remain available while React
consumers move to `DesktopApiClient.subscribe`.

After reconnecting, a client calls `event.replay` with its last applied
sequence. The response is exclusive of that sequence and reports
`requiresSnapshot` when the requested range has expired. Replay batches are
bounded to 1,024 events; clients continue while `hasMore` is true. The runtime
retains at most 4,096 events within a 32 MiB serialized budget. Historical
copies above 1 MiB are replaced by an explicit truncation event; live delivery
still receives the original payload.
`nextSequence` is the raw scan cursor and must be used for the next page even
when every event in a page was filtered from the public desktop stream.
An expired range or truncated historical event sets `requiresSnapshot`. The
Tauri bridge emits `desktop:event-recovery-required`; React then reloads the
runtime snapshot, thread list, and authoritative selected-thread timeline.

`event.replay` is currently a server capability. `reconnectable` remains false
until each shell transport implements subscribe-first buffering, replay,
deduplication, and snapshot fallback end to end.

`task.start` returns a task handle immediately after Codex accepts the turn.
`task.cancel` reports `cancelling`; the ordered terminal event remains the
authority for completion. `task.snapshot` exposes the current task state and
event cursor without requiring React to infer state from loading indicators.
`task.resume` returns the authoritative recovered thread payload, persisted
timeline, task snapshot, and latest event cursor in one response.

Task interactions now share the same stable boundary. `task.queue` and
`task.queue.delete` manage follow-up messages, while `task.steer` immediately
redirects the active turn. `task.queue.steer` promotes an existing queued
message into an immediate steering request without exposing the shell command
name. Approval decisions are the typed values `accept`, `acceptForSession`, and
`decline`; user-input answers are keyed string arrays. Legacy React helpers
remain as compatibility aliases, but they call these methods rather than
Tauri-specific commands.

## Browser and extension host boundaries

Browser lifecycle, native surface bounds, CEF commands, profile import, sign-in
state, and annotations are shell-owned capabilities. `DesktopDispatcher` calls
them through the async `DesktopHost` port; it has no Tauri types or global shell
state. Tauri supplies the current adapter to `dispatch_with_host`, while a
sidecar or Electron shell can implement the same port independently. Headless
dispatch rejects browser methods with `UNSUPPORTED` instead of silently
pretending a host exists.

`browser.action` uses a generated `BrowserAction` discriminator so transport
names such as `browser_navigate` never leak into React. The payload remains a
JSON object because profile, authentication-provider, and attachment
fields differ by action. The high-frequency browser preview stream no longer
opens the legacy `stream_browser` command; the compatibility helper consumes
the shell's browser preview event until host events receive their own ordered
Desktop API stream.

Plugins, industry plugins, MCP reload, remote catalog sync, and connector OAuth
do not require a shell. Their stable methods dispatch directly to
`CoreRuntime`, with typed plugin IDs, catalog URLs, and OAuth callback fields.
Legacy Tauri commands stay registered for rollback and older renderers.
