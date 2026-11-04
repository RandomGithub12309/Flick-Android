import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bundleContents, lanAddresses, phoneCommands } from "./phone-push.mjs";

/**
 * The bundle is the contract between a build machine and a phone that has no
 * repository, no npm and no toolchain. Forgetting one file from it does not fail
 * the pack — it fails silently on the device, in a language the person reading it
 * did not write. So: what must be in there, and that it is actually in there.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));

describe("the phone bundle", () => {
  it("carries exactly the three things the device needs", () => {
    const entries = bundleContents("/repo");
    assert.deepEqual(
      entries.map((entry) => entry.to),
      [".output", "phone-server.mjs", "phone-install.sh"],
    );
    for (const entry of entries) {
      assert.ok(entry.required, `${entry.to} must be present, not optional`);
    }
  });

  it("ships the two scripts from this directory, where they live", () => {
    // .output is a build artifact and legitimately absent on a fresh clone, so
    // only the files that come straight from the repo can be asserted to exist.
    // A missing one here is a rename that would ship an installer which dies on
    // the phone three steps in.
    const root = join(scriptDir, "..");
    const scripts = bundleContents(root)
      .filter((item) => item.to !== ".output")
      .map((item) => item.from);
    assert.deepEqual(scripts, [
      join(scriptDir, "phone-server.mjs"),
      join(scriptDir, "phone-install.sh"),
    ]);
    for (const path of scripts) assert.ok(existsSync(path), `${path} is missing from scripts/`);
  });

  it("names an addressable LAN host only", () => {
    for (const address of lanAddresses()) {
      assert.match(address, /^\d+\.\d+\.\d+\.\d+$/, `${address} is not an IPv4 address to curl`);
    }
  });

  it("prints a command that finishes the job on the phone", () => {
    const cmds = phoneCommands(["192.168.1.20"], 8788);
    assert.match(cmds.oneLine, /curl -fSO http:\/\/192\.168\.1\.20:8788\/flick-server\.tar\.gz/);
    assert.match(cmds.oneLine, /tar -xzf flick-server\.tar\.gz/);
    assert.match(cmds.oneLine, /sh flick-server\/phone-install\.sh$/);
    assert.match(
      cmds.withBoot,
      /--boot$/,
      "the autostart opt-in has to be reachable from the printed line",
    );
    assert.doesNotMatch(cmds.oneLine, /npm|git clone/, "there is no toolchain on the phone");
  });
});
