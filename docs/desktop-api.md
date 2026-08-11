# OnPeople Desktop API

The Desktop API is the stable boundary between the React application and the
Rust runtime. React components must not depend directly on a desktop shell.

```text
React -> DesktopApiClient -> shell transport -> DesktopDispatcher -> CoreRuntime
                                                    |
                                                    +-> DesktopHost port
```

Electron currently sends the same `DesktopRequest` envelope to the Rust
`onpeople-desktop-host` sidecar over JSONL stdio (or an opt-in Unix socket).
Tauri remains a supported rollback adapter and calls `DesktopDispatcher`
in-process through the `desktop_request` command.

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
- `runtime.restart`
- `event.replay`
- `preferences.get`
- `preferences.save`
- `thread.list`
- `thread.timeline`, `thread.new`, `thread.fork`
- `thread.archive`, `thread.unarchive`, `thread.pin`, `thread.unread`
- `thread.rename`, `thread.auto-name`, `thread.reasoning`
- `goal.set`, `goal.update`
- `context.state`, `context.compact`, `context.recalibrate`
- `project.update`, `project.archive-tasks`, `project.quick-launcher`
- `agent.list`, `agent.profile.list`, `agent.profile.save`, `agent.profile.delete`
- `agent.message`, `agent.stop`, `agent.read`
- `worktree.snapshot`, `worktree.handoff`
- `scheduler.get`
- `scheduler.create`, `scheduler.create-from-text`, `scheduler.update`
- `scheduler.delete`, `scheduler.run`, `scheduler.mark-read`
- `cloud.account`, `cloud.login`, `cloud.registration-code.send`
- `cloud.register`, `cloud.logout`, `cloud.redeem`
- `cloud.groups`, `cloud.group.select`, `cloud.usage`
- `cloud.leaderboard.save`
- `live.status`, `live.create`, `live.close`
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
- `terminal.start`, `terminal.write`, `terminal.resize`, `terminal.terminate`
- `terminal.ready`, `terminal.focus`, `terminal.context-menu`
- `file.list`, `file.search`, `file.preview`, `file.artifact.preview`
- `file.generated-image.read`, `file.project-actions`
- `file.project-action.authorize`
- `git.state`, `git.diff`, `git.mutate`, `git.commit`, `git.push`
- `git.initialize`, `git.hunks`, `git.hunk.mutate`
- `git.pull-request.prepare`, `git.review.start`, `git.review.submit`
- `git.worktree`
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
- `provider.get`, `provider.save`
- `models.discover`, `models.validate`
- `extensions.list`, `extensions.skill.set-enabled`
- `policy.get`, `policy.save`, `config.effective`
- `usage.get`, `usage.price.save`
- `memory.list`, `memory.save`, `memory.delete`, `memory.settings.save`
- `secret.list`, `secret.save`, `secret.delete`
- `hook.list`, `hook.local.list`, `hook.create`

Legacy Tauri commands remain registered so the `tauri-production` branch can be
used as a rollback without changing stored data or the existing browser host.

## Ordered events

Electron and Tauri publish `desktop:event` using `DesktopEvent`. Each adapter preserves the
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

## Terminal, files, and Git

Terminal lifecycle requests now cross the stable API. PTY output and exit
notifications intentionally remain streaming shell transports: they are
high-volume events rather than request/response commands. The legacy React
helpers keep their previous signatures while issuing `terminal.*` requests.

File listing, search, workspace preview, local-artifact preview, generated-image
reading, and project-action authorization run in `CoreRuntime`. Every preview
canonicalizes its workspace and rejects boundary escapes. Text previews are
limited to 4 MiB, embedded media to 24 MiB, and generated images to 48 MiB.

Git status, diff, mutations, commit/push, hunk operations, PR preparation,
review submission, and worktree list/create/remove use `git.*`. Results that
come directly from the Codex review protocol remain JSON values, but their
request DTOs are strict and reject unknown fields.

## Native shell host boundary

Operating-system effects use typed `shell.*` methods and the async
`DesktopHost::shell` port. They never enter `CoreRuntime`, and headless callers
receive `UNSUPPORTED` when no native host is attached.

- lifecycle/window: `shell.deep-links.activate`, `shell.frontend.ready`,
  `shell.task-window.open`, `shell.scheduler.open`;
- permissions/navigation: `shell.microphone.request`,
  `shell.cloud-console.open`, `shell.external-url.open`, `shell.editor.open`,
  `shell.local-artifact.open`;
- native files: `shell.generated-image.reveal`,
  `shell.generated-image.copy`, `shell.images.pick`,
  `shell.attachments.pick`, `shell.image.paste`, `shell.thread.reveal`,
  `shell.project.reveal`, `shell.download-directory.pick`;
- updates: `shell.app-update.state`, `shell.app-update.check`,
  `shell.app-update.download`, `shell.app-update.install`, and
  `shell.app-update.open-download`.

Requests and results have generated Rust/TypeScript DTOs. The Tauri adapter
implements these effects with its existing native dialogs, updater, clipboard,
window, and reveal helpers. The Electron adapter implements the same host port
in its main process. Legacy Tauri commands remain registered so an older
renderer can roll back without changing `CoreRuntime`.

Worktree snapshot/handoff workflows and native menu/event delivery remain
legacy adapter responsibilities. Terminal, agent, and live data continue to
arrive through event listeners; the unused renderer-side `streamTerminal`,
`streamAgent`, and `streamLive` channel wrappers were removed.

## Conversation, projects, agents, and worktrees

Goal changes, thread lifecycle and metadata, timeline reads, context
maintenance, reasoning settings, and runtime restart now use stable domain
methods. Their compatibility helpers retain the previous argument and result
shapes, but no longer call Tauri command names directly.

Project metadata, bulk task archival, and quick-launcher composition are owned
by `CoreRuntime`. The quick launcher combines project actions with a bounded
file search without requiring the desktop shell. Agent discovery, profile
CRUD, messaging, stopping, and reading likewise dispatch through the runtime;
profile mutations reload the Codex agent configuration inside one runtime
facade. The four obsolete `spawn/create/dispatch/remove` agent wrappers were
removed from React because Tauri already rejected them and no consumer used
them.

Worktree snapshot and handoff are filesystem/runtime operations rather than
native UI effects. They now live behind `CoreRuntime` and are available to any
Desktop API transport. Legacy Tauri commands stay registered as rollback
aliases and delegate to the same facades. Snapshot output is either the runtime
default `.onpeople.snapshot.patch` or a single relative `.patch` filename in
the canonical worktree root. Absolute paths, traversal, nested/symlink parents,
and symlink targets are rejected before Git runs; a create-new temporary file
is atomically renamed into place.

## Scheduler, cloud, and Live controls

Scheduler list/create/update/delete/run/notification operations now use typed
Desktop API requests. Task execution, including run bookkeeping and prompt
submission, is owned by one `CoreRuntime` facade; both stable requests and the
legacy scheduler loop call that same implementation.

Cloud account, authentication, registration, redemption, groups, usage, and
leaderboard preferences dispatch directly to `CoreRuntime`. Opening the cloud
console remains a native-host responsibility because it launches the system
browser; it is intentionally not represented as a headless request.

Live status and session create/close are stable request/response methods. Live
sideband status and event delivery remain the existing high-frequency event
transport and are not forced through request/response. The unused legacy
`streamLive` React wrapper was removed; Tauri retains its handler for rollback
until event-transport cleanup is complete.

## Browser and extension host boundaries

Browser lifecycle, native surface bounds, browser commands, profile import,
sign-in state, and annotations are shell-owned capabilities. `DesktopDispatcher`
calls them through the async `DesktopHost` port; it has no Tauri types or global
shell state. Electron supplies the WebContentsView adapter, while Tauri supplies
the CEF adapter through `dispatch_with_host`. Headless dispatch rejects browser
methods with `UNSUPPORTED` instead of silently pretending a host exists.

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

## Configuration and data ownership

Provider settings, model discovery, extensions, policy, effective
configuration, usage, memory, secret metadata, and hooks are CoreRuntime-owned
domains. The dispatcher only parses typed request DTOs and serializes typed
results; it never reads metadata or storage directly.

The facades for `policy.get`, `config.effective`, `usage.price.save`,
`memory.save`, `memory.delete`, `secret.save`, and `secret.delete` also own the
composition previously performed in the Tauri command router. Legacy commands
delegate to those same facades, so rollback and stable Desktop API callers
observe the same persisted state. Secret values never appear in list or delete
responses; only `SecretMetadata` crosses the protocol boundary.

`get_provider` and `get_provider_settings` intentionally converge on
`provider.get`. Global and project hooks remain separate methods because they
resolve different storage roots, but they share one generated request and
result contract. `hook.create` keeps legacy compatibility: `id` is optional and
defaults to `hook`, while event and command remain lossless JSON values rather
than being coerced to strings. Dynamic extension manifests and memory settings
stay typed as bounded JSON fields inside otherwise strict DTOs; unknown
top-level request fields are rejected.
