const shell = document.querySelector("#pet-shell");
const character = document.querySelector("#pet-character");
const petImage = document.querySelector("#pet-image");
const activeButton = document.querySelector("#pet-active");
const statusLabel = document.querySelector("#pet-status-label");
const activeTitle = document.querySelector("#pet-active-title");
const tray = document.querySelector("#pet-tray");
const taskList = document.querySelector("#pet-task-list");
const skinLibrary = document.querySelector("#pet-skin-library");
const skinGrid = document.querySelector("#pet-skin-grid");
const skinsButton = document.querySelector("#pet-skins");
let currentState = { status: "idle", trayOpen: false, tasks: [], activeThreadId: null };
let skinMode = false;

const statusCopy = {
  idle: "休息中",
  running: "正在工作",
  "needs-input": "需要你",
  ready: "已完成",
  blocked: "遇到问题",
};

function renderTask(task) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pet-task";
  button.style.setProperty("--status-color", {
    running: "#d78953",
    "needs-input": "#d38238",
    ready: "#4b9a73",
    blocked: "#c95852",
  }[task.status] || "#a5a6a1");
  const dot = document.createElement("i");
  const title = document.createElement("strong");
  title.textContent = task.title;
  const state = document.createElement("small");
  state.textContent = statusCopy[task.status] || task.status;
  button.append(dot, title, state);
  button.addEventListener("click", () => window.petAPI.openThread(task.threadId));
  return button;
}

function renderSkin(skin) {
  const card = document.createElement("div");
  card.className = `pet-skin-card${skin.id === currentState.skinId ? " selected" : ""}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `使用皮肤：${skin.name}`);
  const image = document.createElement("img");
  image.src = skin.src;
  image.alt = "";
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = skin.name;
  const subtitle = document.createElement("small");
  subtitle.textContent = skin.subtitle;
  copy.append(name, subtitle);
  card.append(image, copy);
  const select = () => window.petAPI.selectSkin(skin.id);
  card.addEventListener("click", select);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void select();
    }
  });
  if (!skin.builtIn) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "pet-skin-delete";
    remove.textContent = "×";
    remove.title = "删除自定义皮肤";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      if (window.confirm(`删除自定义皮肤“${skin.name}”？`)) void window.petAPI.deleteSkin(skin.id);
    });
    card.append(remove);
  }
  return card;
}

function renderSkins() {
  skinGrid.replaceChildren();
  for (const skin of currentState.skins || []) skinGrid.append(renderSkin(skin));
}

function setSkinMode(value) {
  skinMode = Boolean(value);
  shell.dataset.view = skinMode ? "skins" : "activity";
  taskList.hidden = skinMode;
  skinLibrary.hidden = !skinMode;
  skinsButton.classList.toggle("active", skinMode);
  skinsButton.textContent = skinMode ? "活动" : "皮肤";
  document.querySelector("#pet-tray-kicker").textContent = skinMode ? "APPEARANCE" : "ACTIVITY";
  document.querySelector("#pet-tray-title").textContent = skinMode ? "宠物皮肤" : "任务动态";
  if (skinMode) renderSkins();
}

function render(state) {
  currentState = state || currentState;
  if (!currentState.trayOpen && skinMode) setSkinMode(false);
  shell.dataset.status = currentState.status || "idle";
  petImage.src = currentState.skin?.src || "../assets/onpeople-app-icon.png";
  petImage.alt = currentState.skin?.name || "OnPeople 水獭";
  statusLabel.textContent = statusCopy[currentState.status] || "休息中";
  activeTitle.textContent = currentState.tasks?.[0]?.title || "OnPeople";
  tray.hidden = !currentState.trayOpen;
  taskList.replaceChildren();
  if (!currentState.tasks?.length) {
    const empty = document.createElement("span");
    empty.className = "pet-empty";
    empty.textContent = "任务开始后，我会在这里守着。";
    taskList.append(empty);
  } else {
    for (const task of currentState.tasks) taskList.append(renderTask(task));
  }
  if (skinMode) renderSkins();
}

character.addEventListener("click", () => {
  setSkinMode(false);
  window.petAPI.setTray(!currentState.trayOpen);
});
activeButton.addEventListener("click", () => {
  if (currentState.activeThreadId) window.petAPI.openThread(currentState.activeThreadId);
  else window.petAPI.setTray(!currentState.trayOpen);
});
document.querySelector("#pet-tuck").addEventListener("click", () => window.petAPI.tuckAway());
skinsButton.addEventListener("click", () => setSkinMode(!skinMode));
document.querySelector("#pet-skin-import").addEventListener("click", () => window.petAPI.importSkin());
window.petAPI.onState(render);
window.petAPI.getState().then(render);
