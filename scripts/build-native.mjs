#!/usr/bin/env node
/**
 * Build the app that ships inside the Android APK.
 *
 * The web build deploys to Vercel, where TanStack Start's server functions run
 * for real. The packaged app has no deployment to call, so this builds the
 * static client bundle instead (NATIVE_BUILD=1 → Start in SPA mode, no Nitro)
 * and assembles it into `native/www` — the directory Capacitor's `webDir`
 * points at and the WebView loads as `https://localhost/`.
 *
 * Two things need fixing up on the way, neither of which the normal build hits:
 *
 *   1. Start writes its SPA shell as `_shell.html` and lets a server hand it
 *      out for any path. There is no server here, so it becomes `index.html`.
 *   2. The platform's head branding (`grokPwaPlugin`) reaches HTML two ways —
 *      Vite's `transformIndexHtml` on the dev/preview server, and
 *      `server/middleware/grok-pwa.ts` on a deployed server. A static bundle
 *      goes through neither, because Start writes the shell itself rather than
 *      building it as an HTML entry, so the tags have to be injected here with
 *      the same shared function the platform chrome uses. Not stripping them is
 *      the point: the "Created with Grok" pill has to ship with the app.
 *
 * Usage: `npm run build:native`, then `npx cap sync android`.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { injectGrokPwaHead } from "./grok-pwa-shared.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientOut = join(root, "dist", "client");
const webDir = join(root, "native", "www");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NATIVE_BUILD: "1" },
  });
  if (result.status !== 0) {
    console.error(`\n[native] ${command} ${args.join(" ")} failed`);
    process.exit(result.status ?? 1);
  }
}

console.log("[native] building the static bundle…");
run(process.execPath, ["./node_modules/vite/bin/vite.js", "build"]);

if (!existsSync(clientOut)) {
  console.error(`[native] expected client output at ${clientOut}, found nothing`);
  process.exit(1);
}
const shell = join(clientOut, "_shell.html");
if (!existsSync(shell)) {
  console.error(`[native] expected the Start SPA shell at ${shell}, found nothing`);
  process.exit(1);
}

console.log("[native] assembling native/www…");
rmSync(webDir, { recursive: true, force: true });
mkdirSync(webDir, { recursive: true });
cpSync(clientOut, webDir, { recursive: true });

// 1. The shell is the app's entry point now that there is no server to route.
const html = readFileSync(shell, "utf8");
rmSync(join(webDir, "_shell.html"));

// 2. Same head chrome the web build serves, applied to the static shell.
const branded = injectGrokPwaHead(html, { cwd: root });
writeFileSync(join(webDir, "index.html"), branded, "utf8");

const carried = branded.includes("/grok-app-builder/extensions.js");
if (!carried) {
  // Loud, not silent: a stripped pill is a platform rule, not a style choice.
  console.warn(
    "[native] WARNING: the platform head script is missing from index.html — " +
      "check scripts/grok-pwa-shared.mjs before shipping this build.",
  );
}

console.log("[native] done — native/www is ready. Next: npx cap sync android");
