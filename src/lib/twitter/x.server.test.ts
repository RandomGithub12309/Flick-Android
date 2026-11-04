import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  IDS_PER_REQUEST,
  MAX_IDS_PER_CALL,
  clearTwitterCaches,
  hydrateTweetIds,
} from "./x.server.ts";

/**
 * The X lane's request policy, with `fetch` stubbed — nothing here touches x.com.
 *
 * What is worth pinning about a lookup-by-id call is not the HTTP, it is the
 * three properties that keep this from becoming an expensive way to re-read the
 * same file: the cache is per tweet id (so a re-shuffle costs nothing), a tweet
 * X says nothing playable about is remembered as such (so deleted bookmarks do
 * not spend the rate limit forever), and the minute budget is charged per
 * upstream request (so one call asking for 300 ids cannot spend three times
 * what anyone else pays).
 */

type Recorded = { url: string; headers: Record<string, string> };
let calls: Recorded[] = [];

const MP4 = "https://video.twimg.com/ext_tw_video/16/pu/vid/720x1280/clip.mp4?tag=14";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stub(routes: Array<[RegExp, (url: string) => Response | Promise<Response>]>) {
  calls = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    for (const [match, respond] of routes) {
      if (match.test(url)) return await respond(url);
    }
    throw new Error(`unstubbed request: ${url}`);
  }) as typeof fetch;
}

const playable = (id: string) => ({
  id,
  text: "clip https://t.co/aa",
  created_at: "2024-05-01T12:00:00.000Z",
  author_id: "45",
  public_metrics: { like_count: 10, view_count: 900 },
  attachments: { media_keys: [`13_${id}`] },
});

const textOnly = (id: string) => ({
  id,
  text: "just words",
  created_at: "2024-05-01T12:00:00.000Z",
});

const mediaFor = (ids: string[]) =>
  ids.map((id) => ({
    media_key: `13_${id}`,
    type: "video",
    variants: [
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/x.m3u8" },
      { content_type: "video/mp4", bit_rate: 2_176_000, url: MP4 },
    ],
  }));

/** One route that answers with `posts` playable and the rest as text-only. */
function lookupRoute(posts: string[], answered: string[]): [RegExp, (url: string) => Response] {
  return [
    /\/2\/tweets/,
    (url: string) => {
      const ids = new URL(url).searchParams.get("ids")?.split(",") ?? [];
      const present = ids.filter((id) => answered.includes(id));
      return json({
        data: ids
          .map((id) => (posts.includes(id) ? playable(id) : textOnly(id)))
          .filter((t) => present.includes(String(t.id))),
        includes: {
          media: mediaFor(posts),
          users: [{ id: "45", username: "NASA", name: "NASA" }],
        },
      });
    },
  ];
}

beforeEach(() => {
  clearTwitterCaches();
});

describe("what a lookup sends", () => {
  beforeEach(() => {
    stub([lookupRoute(["100"], ["100"])]);
  });

  it("asks for the media fields the player depends on", async () => {
    await hydrateTweetIds({ ids: ["100"], bearerToken: "tok" });
    const url = new URL(calls[0]!.url);
    // Without `variants` the API returns a video with no file in it, which is a
    // slide that stalls and then skips.
    assert.match(url.searchParams.get("media.fields") ?? "", /variants/);
    assert.match(url.searchParams.get("expansions") ?? "", /attachments\.media_keys/);
    assert.match(url.searchParams.get("expansions") ?? "", /author_id/);
    assert.match(url.searchParams.get("tweet.fields") ?? "", /public_metrics/);
    assert.equal(url.searchParams.get("ids"), "100");
  });

  it("sends the token to X in the header only", async () => {
    await hydrateTweetIds({ ids: ["100"], bearerToken: "  Bearer tok  " });
    assert.equal(calls[0]?.headers.Authorization, "Bearer tok");
    assert.ok(!calls[0]?.url.includes("tok"), "the token must not ride in the query string");
  });

  it("caps one call, and chunks the rest by the endpoint's own limit", async () => {
    const ids = Array.from({ length: MAX_IDS_PER_CALL + 500 }, (_x, i) => `${1000 + i}`);
    await hydrateTweetIds({ ids, bearerToken: "tok" });
    const sent = calls
      .flatMap((call) => new URL(call.url).searchParams.get("ids")?.split(",") ?? [])
      .filter(Boolean);
    assert.equal(
      new Set(sent).size,
      MAX_IDS_PER_CALL,
      "the overflow is not this shuffle's problem",
    );
    assert.ok(
      calls.every(
        (call) =>
          (new URL(call.url).searchParams.get("ids")?.split(",").length ?? 0) <= IDS_PER_REQUEST,
      ),
    );
    assert.equal(calls.length, Math.ceil(MAX_IDS_PER_CALL / IDS_PER_REQUEST));
  });

  it("sends only ids, never the file", async () => {
    await hydrateTweetIds({
      ids: ["100", "  100 ", "not-a-tweet", "1; DROP TABLE", "200"],
      bearerToken: "tok",
    });
    assert.deepEqual(
      (new URL(calls[0]!.url).searchParams.get("ids") ?? "").split(","),
      ["100", "200"],
      "deduped, trimmed, and anything that is not an id is never forwarded",
    );
  });
});

describe("what a lookup costs", () => {
  it("refuses to send anything without a token, and names the fix", async () => {
    stub([[/\/2\/tweets/, () => json({ data: [] })]]);
    await assert.rejects(
      () => hydrateTweetIds({ ids: ["100"], bearerToken: "" }),
      /Bearer token.*media URLs/s,
    );
    assert.equal(calls.length, 0, "no token means no request, not a request that 401s");
  });

  it("serves a second shuffle out of the same file with no request at all", async () => {
    stub([lookupRoute(["100", "101"], ["100", "101"])]);
    const first = await hydrateTweetIds({ ids: ["100", "101"], bearerToken: "tok" });
    const requestsAfterFirst = calls.length;
    const second = await hydrateTweetIds({ ids: ["100", "101"], bearerToken: "tok" });
    assert.equal(
      calls.length,
      requestsAfterFirst,
      "the cache is per tweet id, so a re-shuffle is free",
    );
    assert.deepEqual(
      second.posts.map((post) => post.id),
      first.posts.map((post) => post.id),
    );
    assert.equal(second.stats.requested, 0);
  });

  it("remembers a tweet that came back with nothing playable", async () => {
    stub([lookupRoute(["100"], ["100", "101"])]);
    await hydrateTweetIds({ ids: ["100", "101"], bearerToken: "tok" });
    const after = calls.length;
    const again = await hydrateTweetIds({ ids: ["101"], bearerToken: "tok" });
    assert.equal(calls.length, after, "a text-only tweet must not be re-asked for on every swipe");
    assert.equal(again.posts.length, 0);
  });

  it("does not cache an id X never mentioned, because that is not an answer", async () => {
    stub([lookupRoute(["100"], ["100"])]);
    await hydrateTweetIds({ ids: ["100", "999"], bearerToken: "tok" });
    const after = calls.length;
    await hydrateTweetIds({ ids: ["999"], bearerToken: "tok" });
    assert.equal(calls.length, after + 1, "a transient upstream miss should be retried");
  });

  it("counts ids X ignored as missing, so a short deck is explained", async () => {
    stub([lookupRoute(["100"], ["100", "101", "102"])]);
    const result = await hydrateTweetIds({ ids: ["100", "101", "999"], bearerToken: "tok" });
    assert.equal(result.stats.requested, 3);
    assert.equal(result.stats.resolved, 1);
    assert.equal(
      result.stats.missing,
      1,
      "999 went unanswered; 101 was answered with a text post, which is not a miss",
    );
  });

  it("stops early when the minute budget runs out, without failing the lane", async () => {
    stub([lookupRoute(["100"], ["100"])]);
    let requests = 0;
    let last: Awaited<ReturnType<typeof hydrateTweetIds>> | null = null;
    // Each call uses its own ids, so nothing is served from cache and every
    // call really does want one request.
    for (let i = 0; i < 32; i++) {
      last = await hydrateTweetIds({ ids: [`${200 + i * 1000}`], bearerToken: "tok" });
      requests = calls.length;
    }
    assert.ok(requests <= 30, `only ${requests} requests reached X`);
    assert.match(last?.warning ?? "", /lot of people/);
    assert.ok(last, "the call resolves instead of throwing, so the deck survives");
  });

  it("shares one in-flight lookup between two callers", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stub([
      [
        /\/2\/tweets/,
        async () => {
          await gate;
          return json({
            data: [playable("100")],
            includes: { media: mediaFor(["100"]), users: [{ id: "45", username: "NASA" }] },
          });
        },
      ],
    ]);
    const both = Promise.all([
      hydrateTweetIds({ ids: ["100"], bearerToken: "tok" }),
      hydrateTweetIds({ ids: ["100"], bearerToken: "tok" }),
    ]);
    release();
    const [a, b] = await both;
    assert.equal(calls.length, 1, "two people shuffling at once is one pair of requests");
    assert.equal(a.posts.length, b.posts.length);
  });
});

describe("what X says back", () => {
  const errors: [number, RegExp][] = [
    [401, /rejected that Bearer token/],
    [402, /plan cannot read posts/],
    [403, /without read access/],
    [429, /rate limit reached/],
    [400, /could not read those ids/],
    [500, /X API 500/],
  ];

  for (const [status, pattern] of errors) {
    it(`turns a ${status} into something a person can act on`, async () => {
      stub([[/\/2\/tweets/, () => json({ title: "Problem", detail: "nope" }, status)]]);
      await assert.rejects(() => hydrateTweetIds({ ids: ["100"], bearerToken: "tok" }), pattern);
    });
  }

  it("keeps what it already had when a later request fails", async () => {
    let fail = false;
    stub([
      [
        /\/2\/tweets/,
        () => {
          if (fail) throw new Error("socket hang up");
          return json({
            data: [playable("100")],
            includes: { media: mediaFor(["100"]), users: [{ id: "45", username: "NASA" }] },
          });
        },
      ],
    ]);
    await hydrateTweetIds({ ids: ["100"], bearerToken: "tok" });
    fail = true;
    const partial = await hydrateTweetIds({ ids: ["100", "200"], bearerToken: "tok" });
    assert.equal(partial.posts.length, 1, "the cached tweet is still a real post");
    assert.match(partial.warning ?? "", /socket hang up/);
    // With nothing cached, the same failure has to surface: a deck with no
    // posts and no explanation reads as a broken app.
    clearTwitterCaches();
    fail = true;
    await assert.rejects(
      () => hydrateTweetIds({ ids: ["200"], bearerToken: "tok" }),
      /socket hang up/,
    );
  });

  it("badges a post by its author, not by whoever asked", async () => {
    stub([lookupRoute(["100"], ["100"])]);
    const result = await hydrateTweetIds({ ids: ["100"], bearerToken: "tok" });
    assert.equal(
      result.posts[0]?.account,
      "nasa",
      "badged by the poster, not by a configured handle",
    );
    assert.equal(result.posts[0]?.video?.url, MP4, "the manifest is skipped for the mp4");
  });
});
