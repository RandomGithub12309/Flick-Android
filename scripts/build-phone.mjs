#!/usr/bin/env node
/**
 * Build the deployment shape a phone can run itself.
 *
 * `npm run build` emits Vercel's per-function output, which only Vercel's
 * routing can serve. This runs the same Vite build with `FLICK_TARGET=node`, so
 * Nitro emits `.output/` — one directory containing the SSR renderer, the server
 * functions and the static client, started by `node .output/server/index.mjs`.
 * That is the whole point of the phone-as-server setup: nothing about the app
 * changes, only the process that owns the port.
 *
 * `db:migrate` is deliberately skipped: with no `DATABASE_URL` the app applies
 * `migrations/*.sql` against its own embedded PGLite at startup (src/lib/db.ts),
 * and there is no external database to migrate on a device.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

const VITE_BIN = "node_modules/vite/bin/vite.js";
const WRAPPER = "scripts/with-app-env.mjs";

function run(root, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`build was killed by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export async function buildPhone({ root = projectRoot(), log = console } = {}) {
  const code = await run(
    root,
    [join(root, WRAPPER), process.execPath, join(root, VITE_BIN), "build"],
    {
      ...process.env,
      FLICK_TARGET: "node",
    },
  );
  if (code !== 0) {
    log.error(`[build:phone] vite build exited ${code}`);
    return { ok: false, code };
  }
  const entry = join(root, ".output", "server", "index.mjs");
  if (!existsSync(entry)) {
    log.error(
      "[build:phone] the build finished but .output/server/index.mjs is missing — " +
        "it means the nitro preset was not node-server. `npm run build` (Vercel output) " +
        "does not produce a self-runnable server; use this script instead.",
    );
    return { ok: false, code: 1 };
  }
  log.log(`[build:phone] .output/ is ready — start it with \`npm run phone\`.`);
  return { ok: true, code: 0, entry };
}

if (isMainModule(import.meta.url)) {
  buildPhone().then((result) => process.exit(result.ok ? 0 : 1));
}
