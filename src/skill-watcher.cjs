const fs = require("node:fs");
const path = require("node:path");

function directoryTree(root) {
  const directories = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    directories.push(directory);
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(path.join(directory, entry.name));
    }
  }
  return directories;
}

function watchSkillRoot(root, onChange, options = {}) {
  const debounceMs = Math.max(20, Number(options.debounceMs) || 160);
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  let timer = null;
  let closed = false;
  let rescanTimer = null;
  const watchers = new Map();
  const changed = (_eventType, filename) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange({ root, filename: filename ? String(filename) : null });
    }, debounceMs);
  };

  const reportError = (error) => {
    if (!closed) onError(error);
  };
  const syncDirectoryWatchers = () => {
    if (closed) return;
    const current = new Set(directoryTree(root));
    for (const directory of current) {
      if (watchers.has(directory)) continue;
      try {
        const watcher = fs.watch(directory, (eventType, filename) => {
          const relativeDirectory = path.relative(root, directory);
          const relativeFilename = filename
            ? path.join(relativeDirectory, String(filename))
            : relativeDirectory || null;
          changed(eventType, relativeFilename);
          if (rescanTimer) clearTimeout(rescanTimer);
          rescanTimer = setTimeout(syncDirectoryWatchers, 20);
        });
        watcher.on("error", reportError);
        watchers.set(directory, watcher);
      } catch (error) {
        reportError(error);
      }
    }
    for (const [directory, watcher] of watchers) {
      if (current.has(directory)) continue;
      watcher.close();
      watchers.delete(directory);
    }
  };

  // Node's recursive Windows watcher can abort inside libuv before JavaScript
  // gets an exception. A directory tree watcher is also the Linux fallback.
  if (process.platform === "darwin") {
    try {
      const watcher = fs.watch(root, { recursive: true }, changed);
      watcher.on("error", reportError);
      watchers.set(root, watcher);
    } catch {
      syncDirectoryWatchers();
    }
  } else {
    syncDirectoryWatchers();
  }
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (rescanTimer) clearTimeout(rescanTimer);
      timer = null;
      rescanTimer = null;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

module.exports = { watchSkillRoot };
