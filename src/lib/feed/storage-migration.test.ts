import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { purgeRemovedLanes } from "./storage-migration.ts";

/**
 * A removed feature is only half deleted when its data is still in storage:
 * zustand merges the whole stored object over the initial state, so the old
 * bookmarks blob — capped at 1.2 MB per device — comes back on every load and
 * nothing reads it. These pin the purge rather than the migration wiring, because
 * the wiring is zustand's job and this is the part that can be quietly wrong.
 */

const session = {
  username: "someone",
  accessToken: "a",
  refreshToken: null,
  expiresAt: 1,
  clientId: "c",
};

describe("the storage purge", () => {
  it("drops what no code reads and keeps what does", () => {
    const purged = purgeRemovedLanes({
      ageOk: true,
      muted: true,
      session,
      redditRedirectUri: "flick://oauth",
      twitter: { bearerToken: "t", bookmarks: { entries: new Array(4000).fill("x") } },
      includeTwitter: true,
      includeReddit: false,
      twitterShare: 0.5,
    });
    assert.deepEqual(
      Object.keys(purged).sort(),
      ["ageOk", "muted", "redditRedirectUri", "session"],
      "the import and its toggles go; the Reddit session stays signed in",
    );
    assert.equal(purged.session, session, "kept by reference — no re-parse of the token blob");
  });

  it("keeps falsy flags", () => {
    const purged = purgeRemovedLanes({ ageOk: false, muted: false, twitter: {} });
    assert.equal(purged.ageOk, false, "losing it would re-ask the age gate on every launch");
    assert.equal(purged.muted, false);
  });

  it("survives an unreadable or absent blob", () => {
    // A quota-killed write can leave anything in localStorage, and a migration
    // that throws on it would brick startup for a device that only needs a reset.
    for (const junk of [undefined, null, "half-written", 42, [], true]) {
      assert.deepEqual(purgeRemovedLanes(junk), {});
    }
  });

  it("does not mutate what zustand handed it", () => {
    const stored = { ageOk: true, twitter: { bearerToken: "t" } };
    purgeRemovedLanes(stored);
    assert.deepEqual(Object.keys(stored), ["ageOk", "twitter"]);
  });
});
