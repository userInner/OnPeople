const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workbench", {
  agentStatus: () => ipcRenderer.invoke("agent:status"),
  sendPrompt: (payload) => ipcRenderer.invoke("agent:send", payload),
  setGoal: (payload) => ipcRenderer.invoke("agent:goal:set", payload),
  updateGoal: (action, value) => ipcRenderer.invoke("agent:goal:update", action, value),
  newTask: () => ipcRenderer.invoke("agent:new-task"),
  interrupt: () => ipcRenderer.invoke("agent:interrupt"),
  resolveApproval: (requestId, decision) => ipcRenderer.invoke("agent:approval", requestId, decision),
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  attachBrowser: (webContentsId) => ipcRenderer.invoke("browser:attach", webContentsId),
  onAgentEvent: (handler) => ipcRenderer.on("agent:event", (_event, value) => handler(value)),
  onBrowserState: (handler) => ipcRenderer.on("browser:state", (_event, value) => handler(value)),
});
