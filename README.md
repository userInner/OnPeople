# OnPeople

Partially open-source cross-platform agent workbench for OpenAI, DeepSeek, MiniMax, Kimi, Grok, custom Responses-compatible services, and local models. It combines an embedded open-source Codex execution runtime, a persistent Chromium browser, Plan/Goal workflows, and native Computer Use. The macOS arm64 release is production-packaged for internal testing; the Windows x64 port has a platform-isolated runtime and packaging foundation and still requires validation on a Windows build machine.

## What works

- Release builds carry platform-specific Codex App Server and Cua Driver runtimes; testers do not install Node.js, Codex CLI, ChatGPT, or Cua Driver separately.
- Development builds can still use `CODEX_BIN`, `CUA_DRIVER_PATH`, or locally installed fallbacks.
- Does not use ChatGPT or Codex account login. Model access is configured directly in the app.
- Includes presets for OpenAI, DeepSeek, MiniMax, Kimi, and Grok/xAI, plus custom Responses API, Ollama, and LM Studio options.
- Connects OpenAI and Grok directly through Responses API. An original localhost-only adapter translates Codex Responses requests to Chat Completions for DeepSeek, MiniMax, and Kimi, including function-tool round trips.
- Enables image attachments for MiniMax, Kimi, OpenAI, and Grok presets and blocks them for DeepSeek. The selected model must itself support image understanding; image-generation-only models are not interchangeable with vision chat models.
- Adds an auditable `image_generation.image_generate` MCP tool backed by the configured provider's OpenAI-compatible `/images/generations` endpoint. It defaults to `gpt-image-2`, saves outputs under `.onpeople/generated-images`, restores previews with task history, and provides copy-image, copy-path, and Finder actions without exposing Base64 image payloads to the workbench trace.
- Stores settings under the app's private data directory and encrypts API keys separately for each provider with the operating system-backed Electron `safeStorage`.
- Runs the execution engine with an app-specific `CODEX_HOME`; it does not read the user's existing `~/.codex` account or provider configuration.
- Runs agent tasks with `workspace-write` sandboxing and `on-request` approval mode. Requests that cross the workspace or mutate native GUI state must be approved in the task trace.
- Embeds Chromium with a separate persistent profile (`persist:internal-agent-browser`).
- Adds a reusable, consent-first browser account center: users can sign in to Google inside OnPeople, keep that isolated session across restarts, inspect non-secret session counts, and clear Google-scoped or all browser data.
- Adds a browser-profile import dialog and an original macOS Chrome importer. It discovers local profiles only after the user opens the dialog, obtains Chrome's Safe Storage secret through macOS Keychain, verifies modern Cookie domain hashes, writes Cookie values directly into the isolated Electron session, and encrypts imported Profile/Account Store passwords with Electron `safeStorage`.
- Adds a user-initiated “fill saved password” browser action. Decrypted credentials move directly from the main-process vault into the selected website's login form; the workbench renderer, task logs, browser tools, and model never receive them. An authorized internal build may still replace the compatible importer through `electron_browser_owl_profile_importer`.
- Exposes browser navigation, DOM snapshots, rendered PNG visual snapshots, saved page annotations, clicks, and form filling to Codex through a localhost-only MCP bridge.
- Browser form filling supports native inputs, textareas, ARIA textboxes, and `contenteditable` rich-text editors such as social post composers; it uses native editing events and verifies the resulting text length without returning field contents.
- Adds a browser inspection rail with visible-page capture, element-targeted annotations, and a developer drawer for DOM, Console, sanitized Network outcomes, and navigation performance. Developer inspection excludes request headers, cookies, storage, and response bodies.
- Implements an omnibox-style address field that distinguishes URLs from search terms (including numbers and Chinese queries), submits on Enter, and treats Electron `ERR_ABORTED (-3)` as a replaced/redirected navigation rather than a browser failure.
- Routes website intent to the embedded browser before native Computer Use. Public HTTPS hosts open directly; local, private, IP-literal, and plain-HTTP hosts still require a manual address-bar approval.
- Pre-approves routine browser navigation, semantic/visual snapshots, annotation reads, clicks, and fills; the more sensitive developer-inspection MCP tool remains approval-controlled. The browser bridge still enforces its own host allowlist and bearer token.
- Connects the bundled `cua-driver` MCP server as `computer_use` with a bounded window-control tool allowlist.
- Exposes the App Server's native Plan collaboration mode, including streamed plan-step updates.
- Keeps one long-lived App Server process and an original OnPeople runtime coordinator. Persistent Sessions own task metadata, Turns own single-run state, and Items track in-flight commands and tool calls. The coordinator stores only a bounded lifecycle index under the app data directory; full conversation history remains owned by the isolated App Server `CODEX_HOME`.
- Normalizes App Server notifications into a renderer-safe `turn-event` channel. The UI subscribes to lifecycle events such as `turn/started`, `item/completed`, deltas, and `turn/completed` instead of parsing raw JSON-RPC envelopes or scheduling tools itself.
- Renders App Server activity as a compact, unboxed execution stream rather than chat messages. Commands, file reads and searches, MCP calls, file changes, plans, reasoning summaries, approvals, warnings, and failures use concise localized action rows with live state, collapsible details, bounded output, and client-side secret redaction; empty reasoning events are omitted and the UI does not label this activity as raw chain-of-thought.
- Supports persisted thread goals with automatic continuation, explicit unlimited or custom token budgets, live token/time usage, and pause, resume, edit, or clear controls.
- Uses a Codex-inspired desktop information architecture: task sidebar, focused conversation canvas, floating composer, and a collapsible browser/tool panel. The implementation and IA branding are original; no proprietary Codex frontend code or assets are included.
- Adds a compact quick-open menu in the tool panel for starting a side task, switching to the browser or terminal, previewing safe top-level workspace files, and opening local service URLs discovered from the current project. The persistent Agent and Computer Use connection labels are intentionally omitted from the sidebar.
- Discovers common project actions from `package.json` scripts and renders up to three compact actions in the top bar. Repositories can define shared setup and action commands in `.onpeople/actions.json`; OnPeople shows the exact command, source, and fingerprint for confirmation before sending it to the integrated terminal. Project files are never executed silently.
- Lets users collapse the task sidebar or browser panel and start a fresh task without restarting the app (active Goals must first be paused or cleared).
- Provides searchable active and archived task history with resume, archive, restore, and fork controls backed by persisted App Server threads.
- Organizes sidebar history into pinned tasks, regular tasks, and workspace-derived projects. Pin state is stored locally, and project rows filter task history without requiring a Codex account.
- Includes a direct native PTY terminal powered by `node-pty` and xterm.js, independent from the Agent runtime, with streamed output, stdin, resize, restart, clear, terminate, OSC 52 clipboard, and clickable web-link support. It uses the login shell on macOS and PowerShell 7, Windows PowerShell, or `cmd.exe` on Windows, with platform-native copy/paste shortcuts.
- Adds a Git workspace panel with a structured change ledger, per-file, per-hunk, and bulk stage/unstage controls, confirmed per-file or per-hunk discard for tracked working-tree edits, commits, upstream-aware pushes, staged and unstaged unified diffs, and Codex reviews for uncommitted changes, base branches, commits, or custom instructions. Diff rows carry old/new line numbers, inline review drafts, batch handoff to the active Agent, and one-click file/line opening in Cursor, VS Code, Zed, or the system editor. Untracked files are never deleted automatically. Pushed GitHub branches can open a prefilled compare/PR page in the embedded browser without requiring GitHub CLI.
- Adds a management center for Skills (enable/disable), Plugins (discover/install/uninstall), and active MCP server inventories and reloads.
- Discovers models from provider `/models` endpoints (plus Ollama and LM Studio), displays detected vision capability, and prevents unsupported image attachments.
- Keeps the browser and other tools in a resizable right-hand pane, with a separately resizable white terminal dock below the conversation. Panel sizes persist locally.
- Adds a P0 control center for parallel sub-agents, including per-agent role, model, reasoning effort, status, follow-up steering, stopping, result inspection, and a bounded completion summary delivered back to the parent task window.
- Creates isolated Git worktrees with dedicated `onpeople/*` branches, task handoff, binary patch snapshots, and snapshot-before-cleanup safeguards.
- Shows live context-window usage, supports manual compaction, same-turn steering, and a persisted-in-process next-turn queue.
- Provides thread-level sandbox, network, approval reviewer, and multi-agent policies with a local JSONL audit trail.
- Discovers project lifecycle Hooks, records hook runs, and creates reviewed `.codex/hooks.json` command hooks without bypassing Codex's hash-based trust gate.
- Adds a runtime diagnostics center with component health, bounded App Server events, current task/turn state, exponential-backoff restart, manual restart, and automatic restoration of the active persisted task after an unexpected runtime exit.
- Adds persistent Scheduled Tasks with interval, daily, weekly, and RFC-style RRULE schedules, pause/resume, run-now, new-background-task or existing-task continuation, reusable per-task Git Worktree isolation, and a local run ledger. Unattended runs retain the configured sandbox, disable interactive approval prompts, and report blocked operations instead of widening permissions.
- Adds a notification center with unread state and native completion/failure notifications. Notification contents and task schedules are stored only in the app's private data directory.
- Adds an optional floating OnPeople otter that reflects parallel task state, prioritizes requests for input and blocked work, opens an activity tray, jumps back to a task, remembers its position, and respects macOS reduced-motion preferences. Its appearance library includes five bundled otter skins and lets users import, select, persist, and remove their own transparent PNG/WebP skins locally.
- Adds complete project-file navigation with folders, breadcrumbs, bounded recursive search, ignored dependency/build directories, workspace-containment checks, and safe file previews in the embedded browser. Press `⌘P` on macOS or `Ctrl+P` on Windows to open it quickly.
- Lets the agent discover apps and windows, read accessibility trees and screenshots, launch apps in the background, click, type, scroll, drag, and press keys.
- Auto-approves only Computer Use perception/session tools. Native GUI actions use Codex's `writes` approval mode and surface approval requests in the task trace.
- Instructs the agent to use the required snapshot → action → snapshot verification loop and to prefer accessibility elements over raw pixels.

## Run from source

Requirements:

- macOS arm64, or Windows 10/11 x64 for the Windows preview
- Node.js 20+
- An authorized Codex executable for development
- Cua Driver 0.10.0+ for development

```bash
npm install
npm start
```

To use another Codex binary:

```bash
CODEX_BIN=/absolute/path/to/codex npm start
```

### Project actions

OnPeople automatically offers common `package.json` scripts such as `dev`, `start`, `test`, `lint`, `build`, `check`, and `format`. To share explicit setup and actions with the repository, add `.onpeople/actions.json`:

```json
{
  "setup": {
    "default": "npm install",
    "darwin": "npm install"
  },
  "actions": [
    { "id": "dev", "label": "启动开发", "command": "npm run dev" },
    { "id": "test", "label": "运行测试", "command": "npm test" }
  ]
}
```

Commands are limited in size, displayed verbatim with a fingerprint, and require a user confirmation before being written to the project terminal. Setup is never triggered automatically merely because a repository was opened or a worktree was created.

To use another Cua Driver binary:

```bash
CUA_DRIVER_PATH=/absolute/path/to/cua-driver npm start
```

## Build a self-contained internal app

The build machine supplies separately licensed, platform-matching runtimes; testers receive only the finished app. The staging script checks explicit environment variables, then platform install locations and `PATH`.

The preferred open-source build input is a Codex CLI binary built from or distributed by the public `openai/codex` project.

Override those authorized sources when needed:

```bash
CODEX_BUNDLE_SOURCE=/absolute/path/to/codex \
CUA_DRIVER_APP_SOURCE=/absolute/path/to/CuaDriver.app \
npm run package:mac
```

The resulting macOS archive is at:

```text
release/OnPeople-<version>-arm64.zip
```

Build the single-file Windows x64 installer on Windows after installing dependencies:

```powershell
$env:CODEX_BUNDLE_SOURCE = "C:\path\to\codex.exe"
$env:CUA_DRIVER_BINARY_SOURCE = "C:\path\to\cua-driver.exe"
npm run package:win
```

The Windows build recompiles `node-pty` for Electron, stages `codex.exe` and `cua-driver.exe`, builds an unpacked application for package verification, and then creates an NSIS installer:

```text
release/windows/OnPeople-Setup-<version>-win-x64.exe
```

The tester downloads and runs only that installer. It installs OnPeople for the current user, creates Start Menu and desktop shortcuts, registers `onpeople://`, provides an uninstaller, and keeps user data during uninstall unless it is removed explicitly. The installed application contains Electron, `codex.exe`, `cua-driver.exe`, and `node-pty`; no external runtime download is required.

For diagnostic use, a portable ZIP remains available:

```powershell
npm run package:win:portable
```

The build stages runtimes under `.embedded-runtime/`, which is gitignored. Packaged apps prefer these embedded copies and start the matching Cua Driver daemon. A SHA-256 provenance manifest records the target platform, architecture, component source, target path, and digest.

### Browser-profile importer

The public implementation supports Google Chrome on macOS. It follows Chromium's published macOS OSCrypt format: PBKDF2-HMAC-SHA1 with the Chrome Safe Storage Keychain secret, and validates the SHA-256 host prefix used by Cookie database schema version 24 and newer. Passwords are re-encrypted into an OnPeople-owned local vault using Electron `safeStorage`; they are not copied into Chromium's private password-manager database.

The importer requires Chrome to be completely closed so SQLite can provide a consistent read. Keychain may show a macOS consent prompt. The target partition is fixed to `persist:internal-agent-browser`; raw profile paths, native error details, passwords, Cookie values, and tokens are never returned to workbench renderer JavaScript, logs, browser MCP tools, or the model. Other platforms fail closed. If an authorized custom Electron runtime supplies `electron_browser_owl_profile_importer`, OnPeople prefers that native implementation through the same sanitized interface.

Testers do not need Node.js, npm, Codex CLI, ChatGPT, or Cua Driver. They still need:

- Apple Silicon Mac running macOS 13 or newer for the current tested release
- Windows 10/11 x64 for Windows preview builds produced and verified on Windows
- An API key for the selected hosted provider, or an available Ollama/LM Studio endpoint. No Codex account is required.
- macOS Accessibility and Screen Recording consent for Cua Driver when Computer Use is enabled

## Model providers

| Provider | Default API/model | Protocol used by OnPeople | Image input |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` / `gpt-5.6-terra` | Responses API | Yes |
| DeepSeek | `https://api.deepseek.com` / `deepseek-v4-pro` | Embedded Chat Completions adapter | No |
| MiniMax | `https://api.minimaxi.com/v1` / `MiniMax-M2.7` | Embedded Chat Completions adapter | Enabled; choose a vision-capable model for understanding attachments |
| Kimi | `https://api.moonshot.cn/v1` / `kimi-k2.6` | Embedded Chat Completions adapter | Yes |
| Grok / xAI | `https://api.x.ai/v1` / `grok-4.5` | Responses API | Yes |
| Sub2API | `https://sub2api.aibro.vip/v1` / `gpt-5.6-sol` | Responses API | Yes |

Base URLs and model IDs remain editable because enterprise gateways, regional endpoints, and model availability can differ.
The Sub2API preset includes `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` as initial selectable models.
Provider and model settings can be changed while a task is open. OnPeople restarts the embedded agent runtime with the new credentials and resumes the same task and history. Switching is blocked only while a response is actively running.

### Image generation

Choose **＋ → Image generation**, describe the image, and send the task. OnPeople asks the agent to call the bundled `image_generate` tool, which uses the active hosted provider's API key and Base URL. The default image model is `gpt-image-2`; an agent can pass another model name when an OpenAI-compatible gateway uses a different image-model identifier. Requests for 2–4 variations use one provider request with `count`, while independent image calls are limited to two at a time. Transient network failures, HTTP 429, and HTTP 5xx responses use bounded retries with a stable idempotency key.

Generated files remain inside the active project at `.onpeople/generated-images`. The conversation renders a native preview card and offers **Copy image**, **Copy path**, and **Finder** actions. Providers that do not implement `/images/generations`, local-only providers, missing keys, moderation blocks, and rate limits fail with an actionable tool error instead of silently falling back to a different service.

## Agent behavior contract

Every provider receives the same public, provider-neutral behavior contract from `src/agent-instructions.cjs`. It defines OnPeople as an action-oriented local coding teammate, including implementation versus read-only boundaries, repository guidance, verification, progress reporting, safe computer use, and a non-generic identity. The contract is intentionally kept in source control so teams can audit, fork, and adapt it without depending on an undisclosed system prompt.

This is an original OnPeople specification informed by publicly documented coding-agent practices. It does not copy or claim to reproduce any private model instructions, weights, or provider-internal prompt.

## Permission presets

The top bar exposes three auditable Codex-compatible permission presets. **Ask for approval** uses `workspace-write`, interactive `on-request` approvals, and the user as reviewer. **Approve for me** keeps the same sandbox and approval policy but routes eligible requests to `auto_review`. **Full access** uses `danger-full-access` with approval policy `never`; the UI requires explicit confirmation and keeps a visible red status indicator. Fine-grained controls and local JSONL audit records remain available in Control → Policy.

System consent is enforced by macOS and cannot be pre-granted by this app. For managed Macs, administrators may deploy the appropriate PPPC profile. Before wider distribution, sign and notarize the outer application with the organization’s Apple Developer identity.

Check Computer Use prerequisites without raising permission dialogs:

```bash
cua-driver status
cua-driver check_permissions '{"prompt":false}'
```

The default workspace is `~/Documents/OnPeople`. Override it with `INTERNAL_AGENT_WORKSPACE=/absolute/path` or edit the field in the app before starting a thread.

For a repeatable local browser smoke test, pass an initial URL:

```bash
npm start -- --start-url=http://127.0.0.1:3000
```

An internal end-to-end smoke prompt can also be supplied at launch:

```bash
npm start -- --start-url=http://127.0.0.1:3000 \
  --smoke-prompt="Use internal_browser to inspect the page and report its title."
```

For local models, start Ollama or LM Studio, then select the provider and enter a model name in the app. These model servers are optional external services, not application runtime dependencies.

## Security model

- The browser bridge binds only to `127.0.0.1` and requires a random per-process bearer token.
- The Chat Completions adapter also binds only to `127.0.0.1`. Hosted-provider API keys stay in the Electron main process and are never exposed to renderer JavaScript.
- The bridge accepts only authenticated `POST /command` requests and never exposes cookies or storage.
- Developer inspection returns sanitized request URLs, methods, statuses, MIME types, Console messages, DOM counts, and navigation timing only. It never returns request/response headers, cookies, browser storage, authentication tokens, request bodies, or response bodies.
- Task-trace details redact bearer credentials, API keys, cookies, password/secret fields, and token-like JSON fields before rendering, and truncate oversized command or tool output while preserving the beginning and end for diagnosis.
- Browser web contents run with Node integration disabled, context isolation enabled, and Chromium sandboxing enabled.
- Only HTTP(S) navigation is accepted.
- `localhost`, `127.0.0.1`, and `::1` are pre-approved. Public HTTPS domain names can be opened directly from an explicit agent task; local, private, IP-literal, and plain-HTTP hosts require manual address-bar approval.
- The embedded browser has a separate persistent session. Do not use production administrator accounts in this prototype.
- Passwords, cookies, access tokens, and browser session storage must not be requested or exposed through browser tools.
- Browser-profile import is user-initiated and main-process-only. The renderer receives opaque profile IDs, display metadata, status, and aggregate counts; it never receives source profile paths or credential values.
- Computer Use is restricted to an explicit tool allowlist. Destructive driver tools such as `kill_app`, configuration mutation, recording, replay, downloads, and persistent foreground activation are not exposed.
- Full-desktop capture and desktop-scope input are not exposed. The agent is instructed to use strict window-scoped sessions.
- Read-only app/window discovery and snapshots are pre-approved; GUI mutations are configured with `writes` approval mode.
- The agent must take a fresh window snapshot before and after every native GUI action. Accessibility element actions are preferred over coordinate clicks.

## Internal provenance

- Codex App Server protocol bindings were generated from `codex-cli 0.145.0-alpha.27` for implementation reference; generated bindings are not shipped in this project.
- The profile-import dialog and adapter contract were informed by the locally installed OpenAI desktop application. No proprietary importer code or binary is copied into this repository. The compatible macOS implementation is original code based on Chromium's published database schema and OSCrypt sources.
- The embedded browser MCP implementation in this project is original integration code.
- Cua Driver is invoked through its documented MCP interface. Its binary is not committed to the source repository; authorized internal release builds embed its original signed app bundle.

## Current limitations

- The project is an internal development build and is not code-signed or notarized.
- Windows x64 now has platform-specific Runtime discovery, PowerShell/cmd PTY support, native window defaults, editor discovery, staging, icon, package verification, an NSIS installer build, and an optional portable ZIP build. It has not yet completed a real Windows build-machine and Computer Use E2E validation.
- Approval requests are shown in the task trace with approve-once and decline controls. Unsupported server-initiated request types fail closed.
- Visual snapshots capture the currently visible embedded-browser viewport. Full-page stitching, automated uploads, multi-tab browsing, layout-style adjustment previews, and persistent performance traces are not yet supported.
- Browser-profile import currently supports Google Chrome on macOS. Chrome Beta/Canary, Chromium-family browsers, Windows App-Bound Encryption, Linux keyrings, partitioned cookies, passkeys, and Chromium-native password-manager integration are not yet supported.
- Native Computer Use depends on the embedded Cua Driver. macOS requires Accessibility and Screen Recording consent; Windows requires the target app to remain visible on the active desktop.
- The Computer Use allowlist intentionally excludes full-desktop input, force-quit, persistent foreground activation, recording/replay, and driver configuration changes.
- Changing model provider after a thread starts requires creating a new task. Saving a new API Key safely restarts only the embedded execution service.
- Chat Completions compatibility covers text/image messages and function tools. Provider-specific hosted tools or proprietary response fields are not translated.
- Task history is stored in the isolated application `CODEX_HOME`; it is independent from any user Codex or ChatGPT account history.
- Scheduled Tasks run while OnPeople is open. Missed executions are picked up on the next scheduler tick after launch; this build does not install a privileged background daemon or wake a sleeping Mac. Dedicated scheduled Worktrees are retained after task deletion so their changes are never destroyed implicitly.
