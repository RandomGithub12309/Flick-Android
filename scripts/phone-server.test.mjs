import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  DEFAULT_PORT,
  SERVER_ENTRY,
  baseUrl,
  decideState,
  parsePid,
  pidAlive,
  resolvePort,
  resolveRoot,
  serverEnv,
  stateDir,
  tail,
  usageHints,
} from "./phone-server.mjs";

/**
 * The launcher's whole job is answering "is my server up, and where is it", and
 * every way that can be wrong is a wrong answer rather than a crash: a port that
 * did not parse silently moves the app to a different URL, a recycled pid reads
 * as "already running", and a hung process reads as healthy. So the pure
 * decisions are pinned here; the spawning is a one-liner on top of them.
 */

describe("the launcher's arithmetic", () => {
  it("takes the port from either variable, and refuses nonsense", () => {
    assert.equal(resolvePort({}), DEFAULT_PORT);
    assert.equal(resolvePort({ PORT: "3000" }), 3000);
    assert.equal(resolvePort({ PORT: "3000", FLICK_PORT: "9000" }), 9000);
    for (const junk of ["", "  ", "abc", "0", "-1", "99999", "3000.5x", "Infinity"]) {
      assert.equal(resolvePort({ FLICK_PORT: junk }), DEFAULT_PORT, `${junk} is not a port`);
    }
  });

  it("reads a pidfile without trusting it", () => {
    assert.equal(parsePid("  4242\n"), 4242);
    for (const junk of [undefined, null, "", "not-a-pid", "0", "1", "-7", {}]) {
      assert.equal(parsePid(junk), null, `${String(junk)} must not look like a process`);
    }
  });

  it("counts a pid it cannot signal as not-ours", () => {
    assert.equal(
      pidAlive(4242, () => undefined),
      true,
    );
    assert.equal(
      pidAlive(4242, () => {
        throw Object.assign(new Error("gone"), { code: "ESRCH" });
      }),
      false,
    );
    // A recycled pid owned by someone else: killing it would hit a stranger.
    assert.equal(
      pidAlive(4242, () => {
        throw Object.assign(new Error("eperm"), { code: "EPERM" });
      }),
      false,
    );
    let calls = 0;
    assert.equal(
      pidAlive("junk", () => {
        calls += 1;
      }),
      false,
    );
    assert.equal(calls, 0, "never signals a pid it could not parse");
  });

  it("answers the four states distinctly", () => {
    const running = decideState({ alive: true, answering: true, url: "http://127.0.0.1:8765" });
    assert.equal(running.kind, "running");
    assert.match(running.line, /Serving on/);

    const hung = decideState({ alive: true, answering: false, url: "http://127.0.0.1:8765" });
    assert.equal(hung.kind, "hung");
    assert.match(hung.line, /log/, "a hung process has to point at the log, not at start");

    const foreign = decideState({ alive: false, answering: true, url: "http://127.0.0.1:8765" });
    assert.equal(foreign.kind, "foreign");
    assert.match(
      foreign.line,
      /FLICK_PORT/,
      "the fix is a different port, not a second server on this one",
    );

    const stopped = decideState({ alive: false, answering: false, url: "http://127.0.0.1:8765" });
    assert.equal(stopped.kind, "stopped");
  });

  it("never prints a bind address as a URL", () => {
    assert.equal(baseUrl("0.0.0.0", 8765), "http://127.0.0.1:8765");
    assert.equal(baseUrl("::", 8765), "http://127.0.0.1:8765");
    assert.equal(baseUrl("192.168.1.9", 8765), "http://192.168.1.9:8765");
  });

  it("says the LAN part only when the LAN is involved", () => {
    const loopback = usageHints({ host: "127.0.0.1", port: 8765 }).join("\n");
    assert.doesNotMatch(
      loopback,
      /network/,
      "nothing is exposed to the network, so nothing to warn about",
    );
    const lan = usageHints({ host: "0.0.0.0", port: 8765 }).join("\n");
    assert.match(lan, /this network/);
    assert.match(lan, /Home screen/, "installing is the step people look for");
  });

  it("keeps its state out of the repository when told to", () => {
    assert.equal(stateDir({ FLICK_HOME: "/tmp/flick-state" }), "/tmp/flick-state");
    assert.match(stateDir({}), /\.flick$/, "the default has to be somewhere a phone app can write");
  });

  it("finds the deployment in either shape it ships in", () => {
    const built = join(SERVER_ENTRY);
    // In the repository, `.output` is above scripts/; in the copy pushed to a
    // phone, the runner file sits next to it. One probe list, both correct.
    const asRepo = resolveRoot({
      scriptDir: "/app/scripts",
      exists: (p) => p === join("/app", built),
    });
    assert.equal(asRepo, "/app");
    const asBundle = resolveRoot({
      scriptDir: "/home/user/flick-server",
      exists: (p) => p === join("/home/user/flick-server", built),
    });
    assert.equal(asBundle, "/home/user/flick-server");
    // An explicit root wins over both, so a symlinked install is not a mystery.
    assert.equal(
      resolveRoot({
        env: { FLICK_ROOT: "/mnt/sd/flick" },
        scriptDir: "/app/scripts",
        exists: () => true,
      }),
      "/mnt/sd/flick",
    );
    // Nothing found: report the repo-shaped default rather than inventing a path.
    assert.equal(resolveRoot({ scriptDir: "/app/scripts", exists: () => false }), "/app");
  });

  it("shows the end of a log without showing all of it", () => {
    // Startup failure on a phone means reading the log; the launcher prints a
    // tail, so a tail that grabs the wrong end hides the error it exists to show.
    assert.equal(tail("a\nb\nc\n\n", 2), "b\nc");
    assert.equal(tail("", 5), "");
    assert.equal(tail("only\nline", 100), "only\nline");
  });

  it("puts the database in the deployment, not in a temp dir", () => {
    const env = serverEnv({
      port: 8765,
      host: "127.0.0.1",
      root: "/home/user/flick-server",
      env: {},
    });
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.PORT, "8765");
    assert.equal(env.HOST, "127.0.0.1");
    assert.equal(env.FLICK_DATA_DIR, "/home/user/flick-server/data");
    // A caller that set its own directory is not overruled.
    assert.equal(
      serverEnv({ port: 1, host: "h", root: "/r", env: { FLICK_DATA_DIR: "/volume1/flick" } })
        .FLICK_DATA_DIR,
      "/volume1/flick",
    );
  });
});
