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

contextBridge.exposeInMainWorld("onpeopleBrowser", {
  invoke: (command, payload = {}) =>
    ipcRenderer.invoke("onpeople:browser", command, payload),
  onEvent: (handler) => {
    const channel = "onpeople:event:browser:event";
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onAgentCommand: (handler) => {
    const channel = "onpeople:event:browser:agent-command";
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    ipcRenderer.send("onpeople:browser-agent-ready");
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
