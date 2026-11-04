#!/usr/bin/env node
/**
 * Restores the Linux native bindings this vendored `node_modules` is missing.
 *
 * `node_modules` is committed here, and it was vendored on Windows: the tree
 * carries `@tailwindcss/oxide-win32-x64-msvc` and no Linux counterpart, plus no
 * `@rolldown/binding-linux-*` at all. Vite 8 builds on rolldown and Tailwind v4
 * on oxide/lightningcss, so on Linux both the dev server and the build die at
 * import with "Cannot find native binding" — a failure that looks like a broken
 * app and is really a missing optional dependency. npm skips optional deps for
 * the wrong platform at install time, so nothing repairs it on its own, and
 * `node_modules` is not part of the workspace snapshot: every revive starts
 * from the Windows-only tree again.
 *
 * Hence this script, called from `startup.sh` before it boots. The rules it
 * holds itself to:
 *
 * - **No-ops when the files are already there**, so a normal boot pays nothing.
 * - **Never fails the boot.** Any error — no network, registry down, a version
 *   that has since been unpublished — is reported on stderr and the process
 *   exits 0. A missing binding is fixable afterwards; a sandbox that never
 *   comes up is not.
 * - **Pins each binding to the version already in the tree.** A `.node` built
 *   for a different release than its JS half is a symbol mismatch, which is a
 *   worse failure than the one being fixed.
 * - Copies only the files that are loaded. The whole tarball is unpacked to a
 *   temp dir and `package.json` + the binary are read out of it, so nothing
 *   depends on being able to rename across filesystems.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org";
const FETCH_TIMEOUT_MS = 60_000;

/**
 * `dest` is a package directory that must exist for `require` to resolve it;
 * `into` is a package that loads its binding from inside itself, by file name,
 * with no package.json of the binding involved. There are two copies of that
 * package here, pinned to different versions, so both are handled separately.
 */
const SPECS = [
  {
    pkg: "@rolldown/binding-linux-x64-gnu",
    versionFrom: "node_modules/rolldown/package.json",
    dest: "node_modules/@rolldown/binding-linux-x64-gnu",
    marker: "rolldown-binding.linux-x64-gnu.node",
  },
  {
    pkg: "@tailwindcss/oxide-linux-x64-gnu",
    versionFrom: "node_modules/@tailwindcss/oxide/package.json",
    dest: "node_modules/@tailwindcss/oxide-linux-x64-gnu",
    marker: "tailwindcss-oxide.linux-x64-gnu.node",
  },
  {
    pkg: "lightningcss-linux-x64-gnu",
    versionFrom: "node_modules/lightningcss/package.json",
    into: "node_modules/lightningcss",
    marker: "lightningcss.linux-x64-gnu.node",
  },
  {
    pkg: "lightningcss-linux-x64-gnu",
    versionFrom: "node_modules/@tailwindcss/node/node_modules/lightningcss/package.json",
    into: "node_modules/@tailwindcss/node/node_modules/lightningcss",
    marker: "lightningcss.linux-x64-gnu.node",
  },
];

function log(message) {
  process.stderr.write(`[bindings] ${message}\n`);
}

function readVersion(relativePath) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")).version || null;
  } catch {
    // The parent package is itself absent — a fresh install, not a restore.
    return null;
  }
}

function tarballUrl(pkg, version) {
  const bare = pkg.includes("/") ? pkg.split("/")[1] : pkg;
  return `${REGISTRY}/${pkg}/-/${bare}-${version}.tgz`;
}

async function restore(spec, version) {
  const targetDir = join(ROOT, spec.dest ?? spec.into);
  const res = await fetch(tarballUrl(spec.pkg, version), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${spec.pkg}@${version}`);

  const dir = mkdtempSync(join(tmpdir(), "flick-bindings-"));
  try {
    const tgz = join(dir, "pkg.tgz");
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1"], { stdio: "pipe" });

    const wanted = spec.dest ? ["package.json", spec.marker] : [spec.marker];
    for (const file of wanted) {
      const src = join(dir, file);
      if (!existsSync(src)) throw new Error(`${file} missing from ${spec.pkg} tarball`);
      mkdirSync(targetDir, { recursive: true });
      copyFileSync(src, join(targetDir, file));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") return;
  let restored = 0;
  let failed = 0;

  for (const spec of SPECS) {
    const markerPath = join(ROOT, spec.dest ?? spec.into, spec.marker);
    if (existsSync(markerPath)) continue;
    const version = readVersion(spec.versionFrom);
    if (!version) continue;
    try {
      await restore(spec, version);
      restored += 1;
      log(`restored ${spec.pkg}@${version}`);
    } catch (err) {
      failed += 1;
      // Loud enough to find in the boot log, quiet enough to boot anyway.
      log(`could not restore ${spec.pkg}@${version}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (restored > 0) log(`${restored} binding(s) restored for this platform`);
  if (failed > 0) log(`${failed} still missing — vite may fail with "Cannot find native binding"`);
}

await main().catch((err) => {
  log(`giving up: ${err instanceof Error ? err.message : err}`);
});
