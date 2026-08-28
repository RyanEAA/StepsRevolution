import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

function start(label, args) {
  const child = spawn(npmCommand, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      console.error(`${label} stopped with signal ${signal}.`);
    } else if (code !== 0) {
      console.error(`${label} exited with code ${code}.`);
    }
    shutdown(code ?? 0);
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 100).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Starting Dance Vision client and multiplayer server...");
start("Multiplayer server", ["run", "server:dev"]);
start("Vite client", ["run", "client:dev"]);
