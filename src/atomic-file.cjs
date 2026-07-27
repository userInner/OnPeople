const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function atomicWriteFile(filePath, data, options = {}) {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  const mode = options.mode ?? 0o600;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (fs.existsSync(target)) {
      fs.copyFileSync(target, `${target}.bak`);
    }
    fs.renameSync(temporary, target);
    fs.chmodSync(target, mode);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readJsonWithBackup(filePath, fallback) {
  let lastError = null;
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    } catch (error) {
      lastError = error;
    }
  }
  if (typeof fallback === "function") return fallback(lastError);
  return fallback;
}

module.exports = { atomicWriteFile, readJsonWithBackup };
