import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  statSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { projectDirectory, saveEnvironment } from "./environment.mjs";

process.chdir(projectDirectory);
const runtimeDirectory = path.join(projectDirectory, ".runtime");
const stateFile = path.join(runtimeDirectory, "server.json");
const lockFile = path.join(runtimeDirectory, "control.lock");
const logFile = path.join(runtimeDirectory, "server.log");
const workerFile = path.join(projectDirectory, "scripts/server-process.mjs");
const abort = new AbortController();
process.once("SIGINT", () => abort.abort(new Error("操作已取消")));
process.once("SIGTERM", () => abort.abort(new Error("操作已取消")));

function readState() {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    if (
      !Number.isInteger(state.port) || state.port < 1 || state.port > 65535 ||
      (state.pid !== null && (!Number.isInteger(state.pid) || state.pid <= 1)) ||
      (state.pid !== null && !/^[a-f0-9-]{36}$/.test(state.instance))
    ) throw new Error("运行记录格式错误，请检查 .runtime/server.json");
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeState(state) {
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryFile, stateFile);
}

function processCommand(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
}

function isRunning(state) {
  if (!state?.pid) return false;
  const command = processCommand(state.pid);
  return command === `photo-archive:${state.instance}` ||
    (command.includes(workerFile) && command.includes(state.instance));
}

function acquireLock() {
  try {
    const fd = openSync(lockFile, "wx", 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const lock = statSync(lockFile);
    const owner = Number(readFileSync(lockFile, "utf8"));
    const incomplete = !Number.isInteger(owner) || owner <= 1;
    if ((incomplete && Date.now() - lock.mtimeMs < 30000) ||
        (!incomplete && processCommand(owner).includes(path.join(projectDirectory, "scripts/service.mjs"))))
      throw new Error("已有启动、停止或重启操作正在执行");
    if (statSync(lockFile).ino !== lock.ino)
      throw new Error("运行锁已变化，请重新执行");
    unlinkSync(lockFile);
    return acquireLock();
  }
  return () => {
    if (existsSync(lockFile) && readFileSync(lockFile, "utf8") === String(process.pid))
      unlinkSync(lockFile);
  };
}

function run(command, args) {
  abort.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
      signal: abort.signal,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} 执行失败${signal ? `（${signal}）` : `（退出码 ${code}）`}`));
    });
  });
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => reject(new Error(
      error.code === "EADDRINUSE"
        ? `端口 ${port} 已被占用`
        : `无法监听端口 ${port}，${error.message}`,
    )));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function askPort() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const previous = process.env.PHOTO_ARCHIVE_PORT || "3000";
    while (true) {
      const answer = (await prompt.question(`部署端口 [${previous}] `, {
        signal: abort.signal,
      })).trim() || previous;
      const port = Number(answer);
      if (!/^\d+$/.test(answer) || !Number.isInteger(port) || port < 1 || port > 65535) {
        console.log("请输入 1–65535 之间的整数端口。");
        continue;
      }
      try {
        await checkPort(port);
        return port;
      } catch (error) {
        console.log(error.message);
      }
    }
  } finally {
    prompt.close();
  }
}

async function stop(state) {
  if (!isRunning(state)) {
    if (state) writeState({ ...state, pid: null, instance: null });
    console.log("服务已停止。");
    return;
  }
  process.kill(state.pid, "SIGTERM");
  for (let attempt = 0; attempt < 75 && isRunning(state); attempt++)
    await delay(200);
  if (isRunning(state)) {
    process.kill(state.pid, "SIGKILL");
    for (let attempt = 0; attempt < 25 && isRunning(state); attempt++)
      await delay(200);
  }
  if (isRunning(state)) throw new Error("服务进程仍在退出，请稍后检查状态");
  writeState({ ...state, pid: null, instance: null });
  console.log(`服务已停止，端口 ${state.port} 已释放。`);
}

async function launch(port) {
  abort.signal.throwIfAborted();
  const instance = randomUUID();
  const log = openSync(logFile, "a", 0o600);
  writeFileSync(log, `\n[${new Date().toISOString()}] 启动端口 ${port}\n`);
  const child = spawn(process.execPath, [workerFile, String(port), instance], {
    cwd: projectDirectory,
    detached: true,
    stdio: ["ignore", log, log, "ipc"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  closeSync(log);
  const state = { pid: child.pid, port, instance, startedAt: new Date().toISOString() };
  try {
    if (!child.pid) throw new Error("无法创建服务进程");
    writeState(state);
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error("服务启动超时")), 30000);
      const onAbort = () => finish(abort.signal.reason);
      abort.signal.addEventListener("abort", onAbort, { once: true });
      child.once("error", finish);
      child.once("exit", (code) => finish(new Error(`服务启动失败（退出码 ${code}），请查看 ${logFile}`)));
      child.once("message", (message) => {
        finish(message.ready ? null : new Error("服务未能就绪"));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/photos`, {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
    });
    if (!response.ok) throw new Error(`服务检查失败（HTTP ${response.status}）`);
    await response.arrayBuffer();
    if (!isRunning(state)) throw new Error("服务进程已退出");
    child.disconnect();
    child.unref();
    console.log(`服务已启动，PID ${state.pid}`);
    console.log(`网站 http://127.0.0.1:${port}`);
    console.log(`后台 http://127.0.0.1:${port}/admin`);
    console.log(`日志 ${logFile}`);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (child.connected) child.disconnect();
    await stop(state);
    throw error;
  }
}

async function main() {
  const action = process.argv[2];
  if (!["start", "stop", "status", "restart"].includes(action))
    throw new Error("用法 node scripts/service.mjs start|stop|status|restart");
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  if (action === "status") {
    const state = readState();
    if (isRunning(state)) {
      console.log(`服务运行中，PID ${state.pid}，端口 ${state.port}`);
      console.log(`网站 http://127.0.0.1:${state.port}`);
      console.log(`启动时间 ${state.startedAt}`);
    } else console.log(`服务已停止${state ? `，上次端口 ${state.port}` : ""}。`);
    console.log(`日志 ${logFile}`);
    return;
  }
  const release = acquireLock();
  try {
    const state = readState();
    if (action === "stop") return await stop(state);
    if (action === "start" && isRunning(state)) {
      console.log(`服务已在端口 ${state.port} 运行，更新代码请执行 ./restart.sh`);
      return;
    }
    const savedPort = state?.port || Number(process.env.PHOTO_ARCHIVE_PORT);
    if (action === "restart" && (!Number.isInteger(savedPort) || savedPort < 1 || savedPort > 65535))
      throw new Error("尚未保存部署端口，请先运行 ./start.sh");
    await run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/create-admin.ts", "--ensure", "--save-env"]);
    const port = action === "start" ? await askPort() : savedPort;
    saveEnvironment({ PHOTO_ARCHIVE_PORT: String(port) });
    if (action === "restart") await stop(state);
    await checkPort(port);
    writeState({ pid: null, instance: null, port, startedAt: null });
    console.log("正在构建生产版本…");
    // 清除旧开发路由生成的类型，避免已删除页面阻断生产构建。
    await rm(path.join(projectDirectory, ".next/dev/types"), { recursive: true, force: true });
    try {
      await run("npm", ["run", "build"]);
    } catch (error) {
      throw new Error(`生产构建失败，服务已停止。修复后执行 ./restart.sh 重试。\n${error.message}`);
    }
    await launch(port);
  } finally {
    release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "运行失败");
  process.exitCode = 1;
});
