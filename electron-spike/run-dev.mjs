import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "..");
const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync(process.execPath, [
  path.join(moduleRoot, "prepare-dev-app.mjs"),
]);
const executable = stdout.trim();
const child = spawn(executable, [path.join(moduleRoot, "main.mjs")], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
