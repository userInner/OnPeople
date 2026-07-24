const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  getState: () => ipcRenderer.invoke("pet:state"),
  setTray: (open) => ipcRenderer.invoke("pet:tray", Boolean(open)),
  tuckAway: () => ipcRenderer.invoke("pet:tuck"),
  openThread: (threadId = null) => ipcRenderer.invoke("pet:open-thread", threadId),
  selectSkin: (skinId) => ipcRenderer.invoke("pet:skin:select", skinId),
  importSkin: () => ipcRenderer.invoke("pet:skin:import"),
  deleteSkin: (skinId) => ipcRenderer.invoke("pet:skin:delete", skinId),
  onState: (handler) => ipcRenderer.on("pet:state", (_event, state) => handler(state)),
});
