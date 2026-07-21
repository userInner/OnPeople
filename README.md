# Internal Agent Workbench

Internal macOS prototype that combines the local Codex App Server with an embedded, persistent Chromium browser and native macOS Computer Use through Cua Driver.

## What works

- Starts the Codex App Server bundled with the installed ChatGPT/Codex desktop app, or the `codex` binary on `PATH`.
- Uses the existing Codex account and model configuration by default.
- Supports OpenAI, Ollama, LM Studio, and custom providers already configured in `~/.codex/config.toml`.
- Runs agent tasks with `workspace-write` sandboxing and `on-request` approval mode. Requests that cross the workspace or mutate native GUI state must be approved in the task trace.
- Embeds Chromium with a separate persistent profile (`persist:internal-agent-browser`).
- Exposes browser navigation, DOM snapshots, clicks, and form filling to Codex through a localhost-only MCP bridge.
- Requires the user to visit a host manually before the agent can navigate to it.
- Marks this app's four built-in browser MCP tools as pre-approved; the browser bridge still enforces its own host allowlist and bearer token.
- Connects the installed `cua-driver` MCP server as `computer_use` with a bounded window-control tool allowlist.
- Exposes the App Server's native Plan collaboration mode, including streamed plan-step updates.
- Supports persisted thread goals with automatic continuation, token budgets, live token/time usage, and pause, resume, edit, or clear controls.
- Uses a Codex-inspired desktop information architecture: task sidebar, focused conversation canvas, floating composer, and a collapsible browser/tool panel. The implementation and IA branding are original; no proprietary Codex frontend code or assets are included.
- Lets users collapse the task sidebar or browser panel and start a fresh task without restarting the app (active Goals must first be paused or cleared).
- Lets the agent discover apps and windows, read accessibility trees and screenshots, launch apps in the background, click, type, scroll, drag, and press keys.
- Auto-approves only Computer Use perception/session tools. Native GUI actions use Codex's `writes` approval mode and surface approval requests in the task trace.
- Instructs the agent to use the required snapshot → action → snapshot verification loop and to prefer accessibility elements over raw pixels.

## Run

Requirements:

- macOS arm64
- Node.js 20+
- An installed Codex CLI, or `/Applications/ChatGPT.app/Contents/Resources/codex`
- `cua-driver 0.10.0+` on `PATH` or at `~/.local/bin/cua-driver`
- A running Cua Driver daemon with macOS Accessibility and Screen Recording permissions

```bash
npm install
npm start
```

To use another Codex binary:

```bash
CODEX_BIN=/absolute/path/to/codex npm start
```

To use another Cua Driver binary:

```bash
CUA_DRIVER_PATH=/absolute/path/to/cua-driver npm start
```

Check Computer Use prerequisites without raising permission dialogs:

```bash
cua-driver status
cua-driver check_permissions '{"prompt":false}'
```

The default workspace is `~/Documents/Codex`. Override it with `INTERNAL_AGENT_WORKSPACE=/absolute/path` or edit the field in the app before starting a thread.

For a repeatable local browser smoke test, pass an initial URL:

```bash
npm start -- --start-url=http://127.0.0.1:3000
```

An internal end-to-end smoke prompt can also be supplied at launch:

```bash
npm start -- --start-url=http://127.0.0.1:3000 \
  --smoke-prompt="Use internal_browser to inspect the page and report its title."
```

For local models, start Ollama or LM Studio first, then select the provider and enter a model name in the app.

## Security model

- The browser bridge binds only to `127.0.0.1` and requires a random per-process bearer token.
- The bridge accepts only authenticated `POST /command` requests and never exposes cookies or storage.
- Browser web contents run with Node integration disabled, context isolation enabled, and Chromium sandboxing enabled.
- Only HTTP(S) navigation is accepted.
- `localhost`, `127.0.0.1`, and `::1` are pre-approved. Other hosts must be manually visited before agent navigation.
- The embedded browser has a separate persistent session. Do not use production administrator accounts in this prototype.
- Passwords, cookies, access tokens, and browser session storage must not be requested or exposed through browser tools.
- Computer Use is restricted to an explicit tool allowlist. Destructive driver tools such as `kill_app`, configuration mutation, recording, replay, downloads, and persistent foreground activation are not exposed.
- Full-desktop capture and desktop-scope input are not exposed. The agent is instructed to use strict window-scoped sessions.
- Read-only app/window discovery and snapshots are pre-approved; GUI mutations are configured with `writes` approval mode.
- The agent must take a fresh window snapshot before and after every native GUI action. Accessibility element actions are preferred over coordinate clicks.

## Internal provenance

- Codex App Server protocol bindings were generated from the locally installed `codex-cli 0.145.0-alpha.18` for implementation reference; generated bindings are not shipped in this project.
- Browser behavior was informed by the locally installed OpenAI Browser plugin. Its proprietary source is not copied into this project because it depends on private desktop runtime bridges and is not independently executable.
- The embedded browser MCP implementation in this project is original integration code.
- Cua Driver is invoked as an independently installed runtime through its documented MCP interface. Its source is not copied or bundled in this project.

## Current limitations

- The project is an internal development build and is not code-signed or notarized.
- Approval requests are shown in the task trace with approve-once and decline controls. Unsupported server-initiated request types fail closed.
- Browser automation uses DOM snapshots and does not yet include screenshot-based visual grounding.
- Native Computer Use depends on Cua Driver being installed, running, and granted Accessibility and Screen Recording permissions by macOS.
- The Computer Use allowlist intentionally excludes full-desktop input, force-quit, persistent foreground activation, recording/replay, and driver configuration changes.
- Changing model provider after a thread starts requires restarting the application.
- The current UI keeps one active thread per app run. Goals are persisted by Codex, but reopening a previous goal thread after restarting this prototype is not exposed in the UI yet.
