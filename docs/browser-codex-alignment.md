# Browser host alignment

This note records the browser behavior we can verify from the local Codex
desktop bundle and the public browser contract. It is an interoperability
target, not a copy of proprietary Codex source.

## Observed Codex boundaries

- The browser page is a native Electron page with a preload/host IPC boundary.
- Browser lifetime is persistent and independent from the visible sidebar or
  preview surface. A missing preview frame is not a disconnected browser.
- Browser automation has separate DOM/locator, visual, and low-level CUA/CDP
  surfaces. Each operation has an authoritative state check and a bounded
  timeout.
- Tabs and browser bindings are persistent handles. Navigation, inspection,
  downloads, file choosers, authentication, and crash recovery are modeled as
  explicit capabilities rather than a single polling loop.

## OnPeople mapping

`electron-spike/browser-controller.mjs` now keeps a persistent route record,
serializes operations per route, exposes `creating/loading/ready/suspended/
crashed/unknown` phases, and cancels timed-out navigation. The native
`WebContentsView` remains the source of truth for the page surface; React no
longer treats a preview frame as the connection signal. `browser.domSnapshot`
also returns an interaction-oriented visible-node snapshot while retaining the
legacy HTML field.

`frontend/src/components/tools/BrowserPane.tsx` uses those lifecycle states and
temporarily hides the native surface while a React inspection panel is open.
That prevents Electron child-view z-order from covering the panel controls.

The session panel now also discovers local Chrome/Chromium/Edge Profiles and
offers a Codex-style import dialog for passwords, cookies, and history. Imports
are copied without following symlinks or cache directories, staged outside the
active partition, and merged before the next OnPeople launch so the live
partition is never modified while it is in use.

The next parity slice is to expose typed locator/DOM-CUA operations, then
download/filechooser/auth capabilities over the same host boundary. Those are
not claimed to be complete until they have contract tests and a real GUI
acceptance run.
