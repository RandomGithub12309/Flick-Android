#!/usr/bin/env node
/**
 * Hand the build to a phone.
 *
 * A laptop build plus a copied folder is the whole self-hosting story, because
 * Termux's Node cannot load the glibc-native modules Vite, Rolldown and
 * Tailwind ship — but the *output* needs none of them: Nitro traces every
 * dependency into `.output`, which is why the artifact is a couple of megabytes
 * of portable JavaScript and not a node_modules tree.
 *
 *   node scripts/phone-push.mjs            # write flick-server.tar.gz + print steps
 *   node scripts/phone-push.mjs --serve    # host it on the LAN until the phone fetches it
 *   node scripts/phone-push.mjs --adb      # also push it to a connected phone
 *
 * The archive and the installer sit side by side in it, so the phone side is one
 * line — no repository, no npm, nothing to compile.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./with-app-env.mjs";

const BUNDLE = "flick-server";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLICK_ROOT?.trim() || dirname(SCRIPT_DIR);
const SERVE_PORT = Number(process.env.FLICK_SERVE_PORT) || 8788;

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: opts.capture ? "pipe" : "inherit", ...opts });
    let out = "";
    if (opts.capture) child.stdout?.on("data", (b) => (out += b.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

/** The phone needs exactly these three things; nothing else in the repo. */
export function bundleContents(root) {
  return [
    { from: join(root, ".output"), to: ".output", required: true },
    { from: join(SCRIPT_DIR, "phone-server.mjs"), to: "phone-server.mjs", required: true },
    { from: join(SCRIPT_DIR, "phone-install.sh"), to: "phone-install.sh", required: true },
  ];
}

export function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

async function pack({ outDir = ROOT, log = console } = {}) {
  const missing = bundleContents(ROOT).filter((entry) => entry.required && !existsSync(entry.from));
  if (missing.length > 0) {
    throw new Error(
      `no ${missing.map((m) => m.to).join(", ")} to bundle. Run \`npm run build:phone\` first` +
        " — not the Vercel output that `npm run build` produces, which nothing else can serve.",
    );
  }
  const staging = join(outDir, ".flick-bundle");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, BUNDLE), { recursive: true });
  for (const entry of bundleContents(outDir)) {
    if (!existsSync(entry.from)) continue;
    await run("cp", ["-R", entry.from, join(staging, BUNDLE, entry.to)]);
  }
  const tarball = join(outDir, `${BUNDLE}.tar.gz`);
  rmSync(tarball, { force: true });
  await run("tar", ["-czf", tarball, "-C", staging, BUNDLE]);
  rmSync(staging, { recursive: true, force: true });
  const bytes = statSync(tarball).size;
  log.log(`[flick] ${tarball} — ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  return { tarball, bytes };
}

export function phoneCommands(hosts, port) {
  const fetch = `curl -fSO http://${hosts[0]}:${port}/${BUNDLE}.tar.gz`;
  return {
    oneLine: `${fetch} && tar -xzf ${BUNDLE}.tar.gz && sh ${BUNDLE}/phone-install.sh`,
    withBoot: `${fetch} && tar -xzf ${BUNDLE}.tar.gz && sh ${BUNDLE}/phone-install.sh --boot`,
    hosts,
    port,
  };
}

async function adbDevices() {
  try {
    const out = await run("adb", ["devices"], { capture: true });
    return out
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => /\tdevice$/.test(line))
      .map((line) => line.split("\t")[0]);
  } catch {
    return [];
  }
}

async function adbPush(tarball, log) {
  const devices = await adbDevices();
  if (devices.length === 0) {
    log.log("[flick] no adb device (enable USB debugging, or use --serve and curl)");
    return false;
  }
  for (const serial of devices) {
    const dest = `/sdcard/Download/${BUNDLE}.tar.gz`;
    await run("adb", ["-s", serial, "push", tarball, dest]);
    log.log(`[flick] pushed to ${serial}:${dest} — in Termux: sh ~/flick-server/phone-install.sh`);
  }
  return true;
}

function serve(tarball, { port = SERVE_PORT, onDone, log = console }) {
  const files = new Map([
    [`/${BUNDLE}.tar.gz`, { path: tarball, type: "application/gzip" }],
    [`/phone-install.sh`, { path: join(SCRIPT_DIR, "phone-install.sh"), type: "text/plain" }],
  ]);
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/") {
      const hosts = lanAddresses();
      const cmds = phoneCommands(hosts.length > 0 ? hosts : ["127.0.0.1"], port);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `Flick server bundle is being served.\n\nIn Termux on the phone:\n\n  ${cmds.oneLine}\n\n`,
      );
      return;
    }
    const file = files.get(path);
    if (!file || !existsSync(file.path)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }
    res.writeHead(200, {
      "content-type": file.type,
      "content-length": String(statSync(file.path).size),
    });
    createReadStream(file.path).pipe(res);
    res.on("close", () => {
      log.log(`[flick] served ${path}`);
      if (path === `/${BUNDLE}.tar.gz`) onDone?.();
    });
  });
  server.listen(port, "0.0.0.0");
  return server;
}

async function main() {
  const log = console;
  const args = process.argv.slice(2);
  const { tarball } = await pack({ log });

  if (args.includes("--adb")) {
    await adbPush(tarball, log).catch((err) => log.log(`[flick] adb failed: ${err.message}`));
  }

  const hosts = lanAddresses();
  const cmds = phoneCommands(hosts.length > 0 ? hosts : ["127.0.0.1"], SERVE_PORT);

  if (args.includes("--serve")) {
    if (hosts.length === 0)
      throw new Error("no LAN address to serve from — use --adb or copy the file");
    log.log(
      `[flick] serving on ${hosts.map((h) => `${h}:${SERVE_PORT}`).join(", ")} until the phone fetches it\n`,
    );
    await new Promise((resolve) => {
      const server = serve(tarball, {
        port: SERVE_PORT,
        onDone: () => {
          server.close();
          resolve();
        },
        log,
      });
    });
    log.log("[flick] fetched — now run the installer on the phone:");
  }

  log.log(`
Copy it to the phone (any route works — the file is self-contained):

  ${tarball}

Then, in Termux:

  ${args.includes("--serve") ? `cd ~/Download && curl -fSO http://${hosts[0] ?? "LAPTOP-IP"}:${SERVE_PORT}/${BUNDLE}.tar.gz && tar -xzf ${BUNDLE}.tar.gz && sh ${BUNDLE}/phone-install.sh` : cmds.oneLine}

  …or, to also start on boot:
  ${cmds.withBoot}

Needs pkg install nodejs once, in Termux (get Termux from F-Droid — the Play
Store build cannot run a server, and it is being removed from Play entirely).`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`[flick] ${err.message}`);
    process.exit(1);
  });
}
