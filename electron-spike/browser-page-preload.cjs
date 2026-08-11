const { ipcRenderer } = require("electron");

const PAGE_EVENT_CHANNEL = "onpeople:browser-page-event";

function send(type, payload = {}) {
  ipcRenderer.send(PAGE_EVENT_CHANNEL, {
    type,
    url: location.href,
    title: document.title,
    ...payload,
  });
}

window.addEventListener(
  "auxclick",
  (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopPropagation();
    send("mouse-navigation", { direction: event.button === 3 ? "back" : "forward" });
  },
  true,
);

window.addEventListener("focus", () => send("focus"));
window.addEventListener("blur", () => send("blur"));
window.addEventListener("online", () => send("network", { online: true }));
window.addEventListener("offline", () => send("network", { online: false }));

document.addEventListener("selectionchange", () => {
  const text = document.getSelection()?.toString().trim();
  if (text) send("selection", { text: text.slice(0, 2_000) });
});
