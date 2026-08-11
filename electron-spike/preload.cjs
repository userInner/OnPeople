const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("onpeopleElectron", {
  isElectron: true,
  invoke: (command, args = {}) =>
    ipcRenderer.invoke("onpeople:invoke", command, args),
  on: (event, handler) => {
    const channel = `onpeople:event:${event}`;
    const listener = (_electronEvent, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  metrics: () => ipcRenderer.invoke("onpeople:metrics"),
});
