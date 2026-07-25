const fs = require("node:fs");

function watchSkillRoot(root, onChange, options = {}) {
  const debounceMs = Math.max(20, Number(options.debounceMs) || 160);
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  let timer = null;
  let closed = false;
  const changed = (_eventType, filename) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange({ root, filename: filename ? String(filename) : null });
    }, debounceMs);
  };
  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, changed);
  } catch {
    watcher = fs.watch(root, changed);
  }
  watcher.on("error", onError);
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      watcher.close();
    },
  };
}

module.exports = { watchSkillRoot };
