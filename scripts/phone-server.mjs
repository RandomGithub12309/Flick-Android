#!/usr/bin/env node
/**
 * Run Flick's built server on this device, and keep it running.
 *
 * Nothing in the app changes for this: `.output/server/index.mjs` is the same
 * bundle Vercel runs, and this script is only the part a platform would
 * otherwise own — pick a port, own a process, say honestly whether it came up.
 * Which is why the launcher's judgement calls are exported and tested: every
 * wrong answer here looks like "the app is broken" on the phone.
 *
 *   flick start [--lan]     daemon; prints the URL once it answers
 *   flick run               same server, in the foreground (Ctrl-C stops it)
 *   flick status|stop|restart|url|open|logs [n]
 *
 * On a phone this runs inside Termux (`pkg install nodejs`). It needs no
 * `node_modules`: Nitro traces every dependency into `.output`, so the deploy
 * artifact is one directory you can copy anywhere a Node exists. `FLICK_ROOT`
 * points at the directory that contains `.output` when it is not beside this
 * file.
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 8765;

/** The self-runnable server bundle — what `npm run build:phone` produces. */
export const SERVER_ENTRY = join(".output", "server", "index.mjs");

/**
 * A whole decimal number, or nothing.
 *
 * `parseInt` is the tempting read and it is too forgiving: it answers 3000 for
 * "3000.5x" and 42 for "42garbage", so a typo in `FLICK_PORT` would bind a port
 * nobody asked for, and a half-written pidfile would point `stop` at a process
 * that only resembles ours.
 */
function wholeNumber(text) {
  const trimmed = String(text ?? "").trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * `PORT` is honoured because that is what every other Node server — and every
 * Termux/Vercel config — already speaks; `FLICK_PORT` wins when both are set, so
 * a second instance can be pointed somewhere else without lying to the process
 * it starts.
 */
export function resolvePort(env = process.env) {
  const port = wholeNumber(env.FLICK_PORT ?? env.PORT);
  return port !== null && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** A pidfile holding junk, a negative, or pid 1 must read as "no server". */
export function parsePid(text) {
  const firstLine = String(text ?? "").split("\n")[0];
  const pid = wholeNumber(firstLine);
  return pid !== null && pid > 1 ? pid : null;
}

/**
 * Where the deployment lives: the directory containing `.output`.
 *
 * Two shapes have to work with the same file — inside the repository (a laptop
 * booting what it just built, where `.output` is the parent of `scripts/`) and
 * standalone in `$HOME/flick-server` on the phone, where it is beside this
 * script. Probing for the marker instead of assuming a depth is what lets the
 * copy be moved around by hand.
 */
export function resolveRoot({ env = process.env, scriptDir, exists = existsSync } = {}) {
  const override = env.FLICK_ROOT?.trim();
  if (override) return override;
  if (scriptDir) {
    for (const candidate of [scriptDir, dirname(scriptDir)]) {
      if (exists(join(candidate, SERVER_ENTRY))) return candidate;
    }
  }
  return scriptDir ? dirname(scriptDir) : process.cwd();
}

/**
 * Whether `pid` is still a process *this* launcher can signal.
 *
 * `kill(pid, 0)` is the only portable probe: nothing is delivered, and a throw
 * means no process. EPERM is deliberately also false — a pid recycled by another
 * user's process is not our server, and treating it as one would have `stop`
 * SIGKILL a stranger.
 */
export function pidAlive(pid, kill = process.kill.bind(process)) {
  if (!parsePid(String(pid))) return false;
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function baseUrl(host, port) {
  // A device's own loopback is 127.0.0.1; `0.0.0.0` is a bind address, never a
  // URL anyone can open.
  const display = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${display}:${port}`;
}

/**
 * Four states, because "is it up?" has three answers and only one of them is
 * fixed by starting it. Reporting a hung process as running — or a stranger on
 * the port as ours — is how a launcher becomes the thing you have to debug.
 */
export function decideState({ alive, answering, url }) {
  if (alive && answering) return { kind: "running", line: `Serving on ${url}` };
  if (alive && !answering) {
    return {
      kind: "hung",
      line: `The process is up but nothing answers on ${url}. Read the log, then stop and start.`,
    };
  }
  if (!alive && answering) {
    return {
      kind: "foreign",
      line: `Something else already answers on ${url}, and this launcher did not start it. Use FLICK_PORT=… for a second instance, or stop whatever holds the port.`,
    };
  }
  return { kind: "stopped", line: "Not running." };
}

export function stateDir(env = process.env) {
  return env.FLICK_HOME?.trim() || join(homedir(), ".flick");
}

/**
 * Pidfile and log are per-port, deliberately.
 *
 * A second instance on another port is the documented way to run a staging copy
 * beside the real one; with one shared pidfile it would silently take over the
 * first one's state, and `stop` would then kill a server on a port nobody named.
 */
function pidFile(port = resolvePort()) {
  return join(stateDir(), `flick-server-${port}.pid`);
}

export function logFile(port = resolvePort()) {
  return join(stateDir(), `flick-server-${port}.log`);
}

export function serverEnv({ port, host, root, env = process.env }) {
  return {
    ...env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: host,
    // The embedded database is in-memory unless told otherwise, which is right
    // for a throwaway dev process and wrong for a deployment you reboot with
    // your phone. Nothing in the deck writes to it today; see src/lib/db.ts.
    FLICK_DATA_DIR: env.FLICK_DATA_DIR?.trim() || join(root, "data"),
  };
}

export function usageHints({ host, port }) {
  const lines = [baseUrl(host, port)];
  if (host === "0.0.0.0") {
    lines.push(
      "  Any device on this network can open this device's address, so pick a network you trust.",
    );
  }
  lines.push(
    "Open it in a browser and use “Add to Home screen” for a full-screen app,",
    "or point the Capacitor shell at it — see NATIVE_ANDROID.md.",
  );
  return lines;
}

async function probe(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    // Any HTTP answer means the process is serving. 500 still counts as "up"
    // for a liveness check whose whole job is telling "not listening" apart
    // from "broken".
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForAnswer(url, deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (await probe(url)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function readPid(port) {
  try {
    return parsePid(readFileSync(pidFile(port), "utf8"));
  } catch {
    return null;
  }
}

function requireBundle(root) {
  const entry = join(root, SERVER_ENTRY);
  if (!existsSync(entry)) {
    throw new Error(
      `no built server at ${entry}. Run \`npm run build:phone\` first — \`npm run build\` ` +
        "emits Vercel's per-function output, which nothing but Vercel can serve.",
    );
  }
  return entry;
}

async function status(root) {
  const port = resolvePort();
  const url = baseUrl("127.0.0.1", port);
  const state = decideState({ alive: pidAlive(readPid(port)), answering: await probe(url), url });
  return { ...state, port, url, root };
}

async function start(root, { lan = false, waitMs = 20000, log = console } = {}) {
  const entry = requireBundle(root);
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  const port = resolvePort();
  const url = baseUrl("127.0.0.1", port);

  const current = readPid(port);
  const state = decideState({ alive: pidAlive(current), answering: await probe(url), url });
  if (state.kind === "running") {
    log.log(`already running (pid ${current}) — ${url}`);
    return { ok: true, pid: current, alreadyRunning: true };
  }
  // Starting anyway here would spawn a process that dies on EADDRINUSE while the
  // port keeps answering — the one case where `start` could report success and
  // still leave you running somebody else's server.
  if (state.kind === "foreign") {
    log.error(`[flick] ${state.line}`);
    return { ok: false, pid: null };
  }

  const fd = openSync(logFile(port), "a");
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: serverEnv({ port, host: lan ? "0.0.0.0" : "127.0.0.1", root }),
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  closeSync(fd);
  if (!child.pid) {
    log.error("[flick] the server process could not be spawned — see the log");
    return { ok: false, pid: null };
  }
  writeFileSync(pidFile(port), `${child.pid}\n`);
  child.unref();

  const up = await waitForAnswer(url, waitMs);
  const alive = pidAlive(child.pid);
  // Both halves matter: a port that answers proves nothing if the process is
  // gone, and a live process proves nothing if it never bound. On a phone there
  // is no console to read, so the log's last lines come to the terminal.
  if (!up || !alive) {
    const why = !alive
      ? `the server process (pid ${child.pid}) exited during startup`
      : `nothing answered on ${url} within ${waitMs}ms`;
    const tailOf = readFileSync(logFile(port), "utf8");
    log.error(`[flick] ${why}.\n  ${tail(tailOf, 8).trim() || `(no output in ${logFile(port)})`}`);
    return { ok: false, pid: alive ? child.pid : null };
  }
  for (const line of usageHints({ host: lan ? "0.0.0.0" : "127.0.0.1", port }))
    log.log(`  ${line}`);
  log.log(`  log: ${logFile(port)}`);
  return { ok: true, pid: child.pid, url };
}

async function stop({ log = console } = {}) {
  const port = resolvePort();
  const pid = readPid(port);
  if (!pidAlive(pid)) {
    rmSync(pidFile(port), { force: true });
    log.log("not running");
    return { ok: true, stopped: null };
  }
  // The whole group, not just the pid: the server is a child of this child, and
  // SIGTERM to a wrapper alone can leave it holding the port.
  const signal = (which, sig) => {
    try {
      process.kill(which, sig);
      return true;
    } catch {
      return false;
    }
  };
  if (!signal(-pid, "SIGTERM")) signal(pid, "SIGTERM");
  const until = Date.now() + 5000;
  while (Date.now() < until && pidAlive(pid)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (pidAlive(pid)) signal(-pid, "SIGKILL");
  rmSync(pidFile(port), { force: true });
  log.log(`stopped (pid ${pid})`);
  return { ok: true, stopped: pid };
}

/** Foreground mode: same server, no pidfile, Ctrl-C stops it. */
function runForeground(root, { lan = false, log = console } = {}) {
  const entry = requireBundle(root);
  const port = resolvePort();
  const host = lan ? "0.0.0.0" : "127.0.0.1";
  log.log(`[flick] ${baseUrl(host, port)} (Ctrl-C to stop)`);
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: serverEnv({ port, host, root }),
    stdio: "inherit",
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

async function openBrowser({ log = console } = {}) {
  const url = baseUrl("127.0.0.1", resolvePort());
  // Android/Termux has its own opener; going through `xdg-open` there is the
  // classic "nothing happened" bug.
  const command =
    platform() === "android" ? "termux-open-url" : platform() === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore" });
  await new Promise((r) => {
    child.on("exit", r);
    child.on("error", r);
  });
  if (child.exitCode !== 0) log.log(`could not open a browser (${command}) — the URL is below`);
  log.log(url);
  return { ok: true, url };
}

/** The last `n` lines, dropping the trailing blank line a written log always has. */
export function tail(text, n = 40) {
  const lines = String(text ?? "").split("\n");
  while (lines.length && lines.at(-1).trim() === "") lines.pop();
  return lines.slice(-Math.max(1, n)).join("\n");
}

function logs(lines) {
  const file = logFile();
  if (!existsSync(file)) {
    console.log(`no log yet at ${file}`);
    return;
  }
  console.log(tail(readFileSync(file, "utf8"), lines));
}

export async function main(argv, root) {
  const [command = "status", ...rest] = argv;
  const lan = rest.includes("--lan");
  switch (command) {
    case "run":
      runForeground(root, { lan });
      return 0;
    case "start":
      return (await start(root, { lan })).ok ? 0 : 1;
    case "stop":
      return (await stop()).ok ? 0 : 1;
    case "restart":
      await stop();
      return (await start(root, { lan })).ok ? 0 : 1;
    case "status": {
      const s = await status(root);
      console.log(`${s.kind}: ${s.line}`);
      return s.kind === "running" ? 0 : s.kind === "stopped" ? 3 : 1;
    }
    case "url":
      console.log(baseUrl("127.0.0.1", resolvePort()));
      return 0;
    case "open":
      return (await openBrowser()).ok ? 0 : 1;
    case "logs":
      logs(wholeNumber(rest[0]) ?? 40);
      return 0;
    default:
      console.error(
        "usage: flick start [--lan] | run | stop | restart | status | url | open | logs [n]",
      );
      return 2;
  }
}

const scriptDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
const entry = process.argv[1];
const isMain =
  !!entry &&
  (() => {
    try {
      return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
      return false;
    }
  })();

if (isMain) {
  const root = resolveRoot({ scriptDir });
  main(process.argv.slice(2), root).then(
    (code) => process.exit(code ?? 0),
    (err) => {
      console.error(`[flick] ${err?.message || err}`);
      process.exit(1);
    },
  );
}
