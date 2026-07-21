const runtime = document.querySelector(".runtime-status");
const runtimeLabel = document.querySelector("#runtime-label");
const timeline = document.querySelector("#timeline");
const composer = document.querySelector("#composer");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#send");
const stopButton = document.querySelector("#stop");
const browserSlot = document.querySelector("#browser-slot");
const address = document.querySelector("#address");
const permission = document.querySelector("#site-permission");
const threadLabel = document.querySelector("#thread-label");
const embeddedBrowser = document.querySelector("#embedded-browser");
const modeOptions = [...document.querySelectorAll(".mode-option")];
const goalBudgetWrap = document.querySelector("#goal-budget-wrap");
const goalBudget = document.querySelector("#goal-budget");
const goalPanel = document.querySelector("#goal-panel");
const goalStatus = document.querySelector("#goal-status");
const goalObjective = document.querySelector("#goal-objective");
const goalUsage = document.querySelector("#goal-usage");
const goalPause = document.querySelector("#goal-pause");
const appShell = document.querySelector("#app-shell");
const contentArea = document.querySelector("#content-area");
const browserToggle = document.querySelector("#browser-toggle");
const taskTitle = document.querySelector("#task-title");
const sidebarTaskState = document.querySelector("#sidebar-task-state");
const projectName = document.querySelector("#project-name");
const projectPath = document.querySelector("#project-path");
const initialTimeline = timeline.innerHTML;

let activeAgentMessage = null;
let running = false;
let selectedMode = "default";
let currentGoal = null;
const activeToolMessages = new Map();

function setRuntime(state, label) {
  runtime.className = `runtime-status ${state}`;
  runtimeLabel.textContent = label;
}

function updateProject(cwd) {
  const value = String(cwd || "").replace(/\/$/, "");
  projectPath.textContent = value || "未设置工作目录";
  projectName.textContent = value.split("/").filter(Boolean).pop() || "Workspace";
}

function updateTaskTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  const title = clean.length > 34 ? `${clean.slice(0, 34)}…` : clean;
  taskTitle.textContent = title;
  document.querySelector(".task-row-title").textContent = title;
}

function setBrowserVisible(visible) {
  contentArea.classList.toggle("browser-collapsed", !visible);
  browserToggle.classList.toggle("active", visible);
  browserToggle.setAttribute("aria-pressed", String(visible));
}

document.querySelector("#sidebar-toggle").addEventListener("click", () => appShell.classList.add("sidebar-collapsed"));
document.querySelector("#sidebar-show").addEventListener("click", () => appShell.classList.remove("sidebar-collapsed"));
browserToggle.addEventListener("click", () => setBrowserVisible(contentArea.classList.contains("browser-collapsed")));
document.querySelector("#browser-close").addEventListener("click", () => setBrowserVisible(false));

document.querySelector("#new-task").addEventListener("click", async () => {
  if (running) return;
  try {
    await window.workbench.newTask();
    timeline.innerHTML = initialTimeline;
    threadLabel.textContent = "NEW THREAD";
    taskTitle.textContent = "新任务";
    document.querySelector(".task-row-title").textContent = "未命名任务";
    sidebarTaskState.textContent = "就绪";
    renderGoal(null);
    activeAgentMessage = null;
    activeToolMessages.clear();
    promptInput.focus();
  } catch (error) {
    addEvent("error", "NEW TASK", error.message);
  }
});

function addEvent(kind, label, text = "") {
  const card = document.createElement("div");
  card.className = `event ${kind}`;
  const heading = document.createElement("span");
  heading.className = "event-label";
  heading.textContent = label;
  const content = document.createElement("span");
  content.textContent = text;
  card.append(heading, content);
  timeline.append(card);
  timeline.scrollTop = timeline.scrollHeight;
  return content;
}

function approvalSummary(request) {
  const params = request.params || {};
  const subject = params.message || params.reason || params.command || params.itemId || request.method;
  const schema = params.requestedSchema ? `\n${JSON.stringify(params.requestedSchema, null, 2)}` : "";
  return `${request.method}\n${subject}${schema}`;
}

function addApproval(request) {
  const card = document.createElement("div");
  card.className = "event approval";
  const heading = document.createElement("span");
  heading.className = "event-label";
  heading.textContent = "COMPUTER USE APPROVAL";
  const content = document.createElement("span");
  content.textContent = approvalSummary(request);
  const actions = document.createElement("div");
  actions.className = "approval-actions";
  const decline = document.createElement("button");
  decline.type = "button";
  decline.className = "secondary";
  decline.textContent = "拒绝";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "批准一次";
  const resolve = async (decision) => {
    decline.disabled = true;
    approve.disabled = true;
    try {
      await window.workbench.resolveApproval(request.id, decision);
      card.classList.add(decision === "accept" ? "approved" : "declined");
      heading.textContent = decision === "accept" ? "APPROVED" : "DECLINED";
    } catch (error) {
      content.textContent += `\n${error.message}`;
    }
  };
  decline.addEventListener("click", () => resolve("decline"));
  approve.addEventListener("click", () => resolve("accept"));
  actions.append(decline, approve);
  card.append(heading, content, actions);
  timeline.append(card);
  timeline.scrollTop = timeline.scrollHeight;
}

function formatGoalUsage(goal) {
  const tokens = Number(goal.tokensUsed || 0).toLocaleString();
  const budget = goal.tokenBudget ? ` / ${Number(goal.tokenBudget).toLocaleString()}` : "";
  const seconds = Number(goal.timeUsedSeconds || 0);
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return `${tokens}${budget} tokens · ${time}`;
}

function renderGoal(goal) {
  currentGoal = goal || null;
  goalPanel.hidden = !currentGoal;
  if (!currentGoal) {
    if (!running) sidebarTaskState.textContent = "就绪";
    return;
  }
  goalStatus.textContent = String(currentGoal.status || "active").toUpperCase();
  goalObjective.textContent = currentGoal.objective || "";
  goalUsage.textContent = formatGoalUsage(currentGoal);
  goalPause.textContent = currentGoal.status === "paused" ? "恢复" : "暂停";
  goalPause.disabled = !new Set(["active", "paused", "blocked"]).has(currentGoal.status);
  if (!running) sidebarTaskState.textContent = currentGoal.status === "active" ? "目标运行中" : `目标${currentGoal.status}`;
}

function renderPlan(params) {
  let card = document.querySelector("#active-plan");
  if (!card) {
    card = document.createElement("div");
    card.id = "active-plan";
    card.className = "event tool plan-event";
    timeline.append(card);
  }
  const lines = (params.plan || []).map((item) => {
    const mark = item.status === "completed" ? "✓" : item.status === "inProgress" ? "→" : "·";
    return `${mark} ${item.step}`;
  });
  card.textContent = [params.explanation || "PLAN", ...lines].join("\n");
  timeline.scrollTop = timeline.scrollHeight;
}

function appendToolOutput(kind, params) {
  const key = `${kind}:${params.itemId || params.processId || "current"}`;
  let content = activeToolMessages.get(key);
  if (!content) {
    content = addEvent("tool", kind);
    activeToolMessages.set(key, content);
  }
  content.textContent += params.delta || "";
  if (content.textContent.length > 12_000) {
    content.textContent = `${content.textContent.slice(0, 2_000)}\n… output truncated …\n${content.textContent.slice(-8_000)}`;
  }
  timeline.scrollTop = timeline.scrollHeight;
}

function selectMode(mode) {
  if (running) return;
  selectedMode = mode;
  for (const option of modeOptions) {
    const active = option.dataset.mode === mode;
    option.classList.toggle("active", active);
    option.setAttribute("aria-pressed", String(active));
  }
  goalBudgetWrap.hidden = mode !== "goal";
  const actionLabel = mode === "goal" ? "启动目标" : mode === "plan" ? "生成计划" : "运行任务";
  sendButton.textContent = "↑";
  sendButton.setAttribute("aria-label", actionLabel);
  sendButton.title = actionLabel;
  promptInput.placeholder = mode === "goal"
    ? "描述可验证的结果、约束和完成标准。"
    : mode === "plan"
      ? "描述任务；Agent 会先调查、提问并生成实施计划。"
      : "例如：打开 localhost:3000，检查页面并修复布局问题。";
}

for (const option of modeOptions) option.addEventListener("click", () => selectMode(option.dataset.mode));

goalPause.addEventListener("click", async () => {
  try {
    const action = currentGoal?.status === "paused" ? "resume" : "pause";
    const result = await window.workbench.updateGoal(action);
    renderGoal(result.goal);
  } catch (error) {
    addEvent("error", "GOAL", error.message);
  }
});

document.querySelector("#goal-edit").addEventListener("click", async () => {
  const objective = window.prompt("编辑目标", currentGoal?.objective || "");
  if (objective === null) return;
  try {
    const result = await window.workbench.updateGoal("edit", objective);
    renderGoal(result.goal);
  } catch (error) {
    addEvent("error", "GOAL", error.message);
  }
});

document.querySelector("#goal-clear").addEventListener("click", async () => {
  if (!window.confirm("清除当前目标？目标的自动续跑将停止。")) return;
  try {
    await window.workbench.updateGoal("clear");
    renderGoal(null);
  } catch (error) {
    addEvent("error", "GOAL", error.message);
  }
});

embeddedBrowser.addEventListener("dom-ready", async () => {
  try {
    await window.workbench.attachBrowser(embeddedBrowser.getWebContentsId());
  } catch (error) {
    addEvent("error", "BROWSER", error.message);
  }
}, { once: true });

document.querySelector("#address-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!address.value.trim()) return;
  try {
    await window.workbench.navigate(address.value.trim());
  } catch (error) {
    addEvent("error", "BROWSER", error.message);
  }
});
address.addEventListener("focus", () => address.select());
document.querySelector("#back").addEventListener("click", () => window.workbench.back());
document.querySelector("#forward").addEventListener("click", () => window.workbench.forward());
document.querySelector("#reload").addEventListener("click", () => window.workbench.reload());

window.workbench.onBrowserState((state) => {
  if (!address.matches(":focus")) address.value = state.url?.startsWith("data:") ? "" : (state.url || "");
  permission.className = `site-permission ${state.approved ? "approved" : ""}`;
  permission.querySelector("span").textContent = state.approved ? `${state.host} 已批准` : "域名未批准";
  document.querySelector("#back").disabled = !state.canGoBack;
  document.querySelector("#forward").disabled = !state.canGoForward;
});

function setRunning(value) {
  running = value;
  sendButton.disabled = value;
  stopButton.disabled = !value;
  promptInput.disabled = value;
  for (const option of modeOptions) option.disabled = value;
  document.querySelector("#new-task").disabled = value;
  sidebarTaskState.textContent = value ? "正在运行" : (currentGoal?.status === "active" ? "目标运行中" : "就绪");
}
setRunning(false);

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || running) return;
  updateTaskTitle(prompt);
  addEvent("user", "YOU", prompt);
  promptInput.value = "";
  activeAgentMessage = null;
  setRunning(true);
  try {
    const common = {
      cwd: document.querySelector("#cwd").value.trim(),
      modelProvider: document.querySelector("#provider").value,
      model: document.querySelector("#model").value.trim(),
    };
    const result = selectedMode === "goal"
      ? await window.workbench.setGoal({ ...common, objective: prompt, tokenBudget: goalBudget.value })
      : await window.workbench.sendPrompt({ ...common, prompt, mode: selectedMode });
    threadLabel.textContent = result.threadId.slice(0, 13).toUpperCase();
    if (result.goal) renderGoal(result.goal);
  } catch (error) {
    addEvent("error", "AGENT", error.message);
    setRunning(false);
  }
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.metaKey) composer.requestSubmit();
});
stopButton.addEventListener("click", async () => {
  await window.workbench.interrupt();
  setRunning(false);
});

window.workbench.onAgentEvent((event) => {
  if (event.type === "smoke-started") {
    updateTaskTitle(event.prompt);
    addEvent("user", "SMOKE TEST", event.prompt);
    setRunning(true);
    return;
  }
  if (event.type === "smoke-thread") {
    threadLabel.textContent = event.threadId.slice(0, 13).toUpperCase();
    return;
  }
  if (event.type === "ready") {
    setRuntime("ready", "Agent 已连接");
    return;
  }
  if (event.type === "thread-ready") {
    threadLabel.textContent = event.threadId.slice(0, 13).toUpperCase();
    return;
  }
  if (event.type === "goal-state") {
    renderGoal(event.goal);
    return;
  }
  if (event.type === "fatal" || event.type === "server-exit") {
    setRuntime("error", event.message || "Agent 已断开");
    addEvent("error", "RUNTIME", event.message || `App Server exited: ${event.code ?? "unknown"}`);
    setRunning(false);
    return;
  }
  if (event.type === "server-log") {
    console.debug("Codex App Server:", event.text);
    return;
  }
  if (event.type === "approval-required") {
    addApproval(event.request);
    return;
  }
  if (event.type === "unsupported-server-request") {
    addEvent("error", "UNSUPPORTED REQUEST", event.request.method);
    return;
  }
  if (event.type !== "notification") return;
  const message = event.message;
  if (message.method === "turn/started") {
    setRunning(true);
  } else if (message.method === "thread/goal/updated") {
    renderGoal(message.params.goal);
  } else if (message.method === "thread/goal/cleared") {
    renderGoal(null);
  } else if (message.method === "turn/plan/updated") {
    renderPlan(message.params);
  } else if (message.method === "item/agentMessage/delta") {
    if (!activeAgentMessage) activeAgentMessage = addEvent("agent", "AGENT");
    activeAgentMessage.textContent += message.params.delta;
    timeline.scrollTop = timeline.scrollHeight;
  } else if (message.method === "item/commandExecution/outputDelta") {
    appendToolOutput("COMMAND", message.params);
  } else if (message.method === "item/mcpToolCall/progress") {
    appendToolOutput("MCP", { ...message.params, delta: `${JSON.stringify(message.params, null, 2)}\n` });
  } else if (message.method === "error" || message.method === "warning") {
    addEvent(message.method === "error" ? "error" : "tool", message.method.toUpperCase(), message.params.message || JSON.stringify(message.params));
  } else if (message.method === "turn/completed") {
    const turn = message.params?.turn;
    if (turn?.status === "failed") {
      addEvent("error", "TURN FAILED", turn.error?.message || JSON.stringify(turn.error || {}));
    }
    for (const card of timeline.querySelectorAll(".event.approval:not(.approved):not(.declined)")) {
      card.classList.add("expired");
      const label = card.querySelector(".event-label");
      if (label) label.textContent = "COMPLETED";
      for (const button of card.querySelectorAll("button")) button.disabled = true;
    }
    setRunning(false);
    activeAgentMessage = null;
    activeToolMessages.clear();
  }
});

window.workbench.agentStatus().then((status) => {
  if (!document.querySelector("#cwd").value) document.querySelector("#cwd").value = status.defaultCwd || "";
  updateProject(document.querySelector("#cwd").value);
  if (status.ready) setRuntime("ready", "Agent 已连接");
  if (status.threadId) threadLabel.textContent = status.threadId.slice(0, 13).toUpperCase();
  renderGoal(status.goal);
  const computerUse = document.querySelector("#computer-use-status");
  if (computerUse) {
    computerUse.lastChild.textContent = status.computerUse?.message || "Computer Use 不可用";
    computerUse.classList.toggle("unavailable", !status.computerUse?.running);
  }
}).catch((error) => setRuntime("error", error.message));

document.querySelector("#cwd").addEventListener("change", (event) => updateProject(event.target.value));

selectMode("default");
