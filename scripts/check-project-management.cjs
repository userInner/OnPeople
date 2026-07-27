const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src/main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "src/preload.cjs"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src/renderer.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "src/index.html"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageMac = fs.readFileSync(path.join(root, "scripts", "package-mac.cjs"), "utf8");

for (const channel of ["projects:update", "projects:reveal", "projects:archive-tasks"]) assert.ok(main.includes(channel), `missing ${channel}`);
for (const method of ["updateProject", "revealProject", "archiveProjectTasks"]) assert.ok(preload.includes(method), `missing ${method}`);
for (const label of ["置顶项目", "在 Finder 中显示", "重命名项目", "归档任务", "移除"]) assert.ok(renderer.includes(label), `missing ${label}`);
assert.ok(renderer.includes("closeProjectMenus"));
assert.ok(styles.includes(".project-menu-item"));
assert.ok(
  renderer.includes("const pinnedThreads = showingArchived ? [] : threads.filter((thread) => thread.pinned)"),
  "project filters must not hide global pinned tasks",
);
assert.ok(
  renderer.includes("const regularThreads = showingArchived ? threads : threads.filter((thread) => !thread.pinned)"),
  "selecting a project must keep the global recent task list scrollable",
);
assert.ok(
  !renderer.includes("const visible = selectedProjectPath ? threads.filter"),
  "project selection must not collapse the task list to one project",
);
assert.ok(styles.includes("overscroll-behavior: contain"), "the combined task/project sidebar must remain independently scrollable");
assert.ok(main.includes("let refreshPending = !appServer?.ready"), "startup task listing must fall back to local state before App Server is ready");
assert.ok(main.includes('recordRuntimeEvent("warning", "实时任务列表暂不可用"'), "live thread-list failures must be diagnosable without breaking the sidebar");
assert.ok(renderer.includes("任务暂时无法载入，连接恢复后会自动刷新。"), "the sidebar must not expose raw IPC errors");
const resumeBody = renderer.match(/async function resumeThread\(threadId\) \{([\s\S]*?)\n\}/)?.[1] || "";
assert.ok(resumeBody.includes("++threadSwitchSequence"), "task switching must use last-selection-wins sequencing");
assert.ok(resumeBody.includes("sequence !== threadSwitchSequence"), "stale task responses must not replace the latest selection");
assert.ok(resumeBody.includes("pendingThreadId = threadId"), "a clicked task must show immediate pending selection feedback");
assert.ok(renderer.includes('row.setAttribute("role", "button")'), "task rows must expose actionable button semantics");
assert.ok(renderer.includes("currentThreadId = status.windowThreadId || null"), "startup must use the window-scoped task binding");
assert.ok(!renderer.includes("currentThreadId = status.threadId || null"), "a globally running task must not make a window click a false no-op");
assert.ok(!resumeBody.includes("if (running) return"), "a running task must not block switching to another task");
assert.ok(!resumeBody.includes("taskList.classList.add(\"loading\")"), "task loading must not disable the task list");
assert.ok(!styles.includes(".task-list.loading"), "task list must remain interactive while another task loads");
assert.ok(main.includes('appServer.request("thread/read", { threadId: id, includeTurns: true }'), "task switching must read the restored thread history");
assert.ok(main.includes("readLocalThreadSnapshot(id)"), "task switching must have an immediate persisted-session path");
assert.ok(main.includes("visibleRolloutUserText"), "persisted session rendering must filter internal context wrappers");
assert.ok(main.includes("const liveTurnId = activeTurnIdsByThread.get(id) || null"), "persisted unfinished turns must not be promoted to live running turns");
assert.ok(!main.includes("if (local.running && local.turnId) activeTurnIdsByThread.set(id, local.turnId)"), "stale rollout state must not lock the composer");
assert.ok(main.includes('appServer.request("turn/steer"'), "the composer must steer an active turn");
assert.ok(main.includes("await ensureRuntimeThread(requestedThreadId"), "continued messages and goals must restore persisted threads into the live App Server");
assert.ok(main.includes("runtimeThreadLoadPromises"), "concurrent restore requests must share one in-flight runtime load");
assert.ok(main.includes('appServer.request("thread/resume"'), "persisted threads must be resumed before runtime mutations");
assert.ok(main.includes("deferGoalContinuation: true"), "restoring a thread must not synchronously continue its persistent Goal");
assert.ok(main.includes("THREAD_RESTORE_TIMEOUT_MS"), "thread restoration must have a bounded timeout");
assert.ok(main.includes("threadLifecycleById"), "restoring, idle, running, and failed must be separate lifecycle states");
assert.ok(main.includes("deferPromptUntilThreadReady"), "messages submitted during restoration must be queued for confirmed delivery");
assert.ok(main.includes("runtimeThreadReadyWaiters"), "runtime restore must have an event-driven readiness path");
assert.ok(main.includes("signalRuntimeThreadReady(messageThreadId"), "thread status/token events must release queued messages");
assert.ok(main.includes("Promise.race([") && main.includes('type: "ready"'), "queued messages must not wait for the final thread/resume response after readiness events");
assert.ok(main.includes("CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED"), "API-key-only OnPeople must disable the unused Codex remote-control auth loop");
assert.ok(main.includes("model_auto_compact_token_limit"), "long sessions must enable Codex Core auto compaction");
assert.ok(renderer.includes("const wasRunning = running"), "composer submission must preserve its pre-submit running state");
assert.ok(renderer.includes('promptInput.placeholder = value ? "补充指令；发送后会加入当前运行任务…"'), "running tasks must expose follow-up input");
assert.ok(!renderer.includes("promptInput.disabled = value"), "running tasks must not disable the composer");
assert.ok(renderer.includes("setUserMessageDelivery"), "optimistic user messages must expose pending, sent, queued, and failed delivery states");
assert.ok(main.includes("resolveNewThreadWorkspace(payload)"), "new tasks must materialize their workspace before thread/start");
assert.ok(main.includes('workspaceMode: "isolated"'), "a blank new task must default to an isolated workspace");
assert.ok(!main.includes('return { created: true, cwd: DEFAULT_CWD };'), "new tasks must not inherit the global default directory");
assert.ok(renderer.includes('let selectedWorkspaceMode = "isolated"'), "the composer must keep draft workspace mode separate from active tasks");
assert.ok(renderer.includes("workspaceMode: selectedWorkspaceMode"), "the first submission must send the selected workspace mode");
assert.ok(html.includes('id="composer-workspace-menu"'), "the composer must expose a custom workspace picker");
assert.ok(html.includes('id="composer-workspace-search"'), "the workspace picker must expose workspace search");
assert.ok(html.includes('id="composer-workspace-recents"'), "the workspace picker must expose recent workspaces");
assert.ok(!renderer.includes("composerWorkspace.disabled = Boolean(currentThreadId)"), "existing tasks must keep the workspace picker interactive");
assert.ok(renderer.includes('await startFreshTask({ workspaceMode: "local"'), "selecting a workspace from an existing task must create a new task draft");
assert.ok(styles.includes(".composer-workspace-menu"), "the custom workspace picker must be styled");
assert.ok(renderer.includes("event.type === \"thread-lifecycle\""), "the UI must subscribe to lifecycle events instead of inferring restore state");
assert.ok(renderer.includes('row.addEventListener("contextmenu"'), "task rows must expose a native right-click menu");
for (const label of ["置顶任务", "重命名任务", "归档任务", "标记为未读", "在 Finder 中显示", "复制工作目录", "复制会话 ID", "复制深度链接", "在新窗口中打开"]) {
  assert.ok(renderer.includes(label), `task context menu is missing ${label}`);
}
assert.ok(main.includes('ipcMain.handle("threads:rename"'), "task rename must be handled by the main process");
assert.ok(main.includes('ipcMain.handle("threads:unread"'), "task unread state must persist in the main process");
const openEditorBody = main.match(/async function openEditorLocation\(payload = \{\}\) \{([\s\S]*?)\n\}/)?.[1] || "";
assert.ok(openEditorBody.includes("resolveOpenableWorkspaceFile"), "file links must resolve inside the workspace without requiring Git");
assert.ok(!openEditorBody.includes("gitRoot("), "opening a file must not require a Git repository");
assert.ok(openEditorBody.includes("shouldUseSystemPreview"), "images and documents must open with the system preview");
assert.ok(renderer.includes('timeline.classList.add("instant-scroll")'), "thread switching must disable visible scroll animation");
assert.ok(renderer.includes("if (!renderingThreadHistory) scrollTimelineToBottom"), "history construction must not scroll once per item");
assert.ok(!renderer.includes("window.prompt("), "Electron renderer must not use the unsupported window.prompt API");
assert.ok(renderer.includes("function requestText("), "rename and goal editing must use the in-app text dialog");
assert.ok(html.includes('id="text-input-dialog"'), "the in-app text dialog must be present");
assert.ok(styles.includes(".text-input-dialog"), "the in-app text dialog must be styled");
assert.ok(renderer.includes("cursorInactiveStyle: \"outline\""), "the terminal must keep a visible inactive cursor");
assert.ok(renderer.includes("cursorWidth: 2"), "the active terminal caret must remain legible on the white canvas");
assert.ok(renderer.includes("attachCustomKeyEventHandler"), "the terminal must own copy shortcut routing");
assert.ok(renderer.includes("instance.hasSelection()"), "terminal copy must require a real selection");
assert.ok(renderer.includes("window.workbench.copyText(selection)"), "terminal selections must reach the native clipboard");
assert.ok(renderer.includes("window.workbench.readText()"), "terminal paste must use the native clipboard bridge");
assert.ok(renderer.includes("rightClickSelectsWord: true"), "terminal right click must select the word under the pointer");
assert.ok(renderer.includes("macOptionIsMeta: isMacOS"), "terminal must preserve macOS Option-as-Meta behavior without applying it to Windows");
assert.ok(renderer.includes("showTerminalContextMenu"), "terminal must expose a native context menu");
assert.ok(preload.includes('ipcRenderer.invoke("terminal:context-menu"'), "terminal context menu must be bridged through preload");
assert.ok(main.includes('ipcMain.handle("terminal:context-menu"'), "the main process must create the terminal context menu");
assert.ok(html.includes('id="terminal-copy-status"'), "terminal copy feedback must be announced");
assert.ok(styles.includes(".terminal-copy-status.visible"), "terminal copy feedback must have a visible state");
assert.ok(packageJson.scripts["package:mac"].includes("scripts/package-mac.cjs"), "macOS packaging must use the reproducible package driver");
assert.ok(packageJson.scripts["package:win"].includes("scripts/package-win-installer.cjs"), "Windows packaging must use the NSIS package driver");
assert.ok(packageJson.scripts["package:win:portable"].includes("scripts/package-win.cjs"), "Windows portable packaging must remain available for diagnostics");
assert.ok(packageMac.includes("sign-mac.cjs"), "macOS packages must be signed after assembly");
assert.ok(packageMac.includes("check-packaged-app.cjs"), "macOS packages must verify production dependencies");
assert.ok(packageMac.includes("^/(dist[^/]*|release[^/]*"), "macOS packaging must exclude only root build trees");
console.log("project management checks passed");
